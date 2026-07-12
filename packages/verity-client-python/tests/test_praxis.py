"""Tests for praxis_verity_client — Python SDK for praxis-protocol/v1.

Covers: canonical serialization, crypto, schema validation, client handshake,
promotion flow, and cross-runtime determinism (byte-equivalent canonical output).
"""

import hashlib
import json
import time
import pytest
from praxis_verity_client.canonical import canonicalize
from praxis_verity_client.crypto import (
    generate_keypair,
    sign,
    verify_signature,
    key_id,
)
from praxis_verity_client.schema import validate
from praxis_verity_client.client import (
    VersionedPraxisClient,
    ClientOptions,
    PromotionRequest,
)


# ── Canonical serialization ──

class TestCanonicalize:
    def test_sorted_keys(self):
        result = canonicalize({"z": 1, "a": 2})
        assert result == b'{"a":2,"z":1}'

    def test_no_whitespace(self):
        result = canonicalize({"key": [1, 2, 3]})
        assert result == b'{"key":[1,2,3]}'

    def test_nested_sorted(self):
        result = canonicalize({"b": {"d": 1, "c": 2}, "a": 3})
        assert result == b'{"a":3,"b":{"c":2,"d":1}}'

    def test_utf8(self):
        result = canonicalize({"name": "日本語"})
        assert "日本語".encode("utf-8") in result

    def test_deterministic(self):
        obj = {"x": [1, {"y": True, "z": None}]}
        a = canonicalize(obj)
        b = canonicalize(obj)
        assert a == b
        assert isinstance(a, bytes)

    def test_matches_typescript_output(self):
        """Verify byte-equivalence with the TypeScript canonicalize for known inputs."""
        obj = {"baseHash": "a" * 64, "candidateId": "c-1"}
        py_bytes = canonicalize(obj)
        ts_json = '{"baseHash":"' + "a" * 64 + '","candidateId":"c-1"}'
        assert py_bytes == ts_json.encode("utf-8")


# ── Crypto ──

class TestCrypto:
    def test_generate_keypair_returns_hex_strings(self):
        kp = generate_keypair()
        assert len(kp.private_key_hex) == 64
        assert len(kp.public_key_hex) == 64
        int(kp.private_key_hex, 16)
        int(kp.public_key_hex, 16)

    def test_sign_and_verify(self):
        kp = generate_keypair()
        data = {"hello": "world"}
        sig = sign(data, kp.private_key_hex)
        assert len(sig) == 128  # 64 bytes hex
        assert verify_signature(data, sig, kp.public_key_hex) is True

    def test_verify_rejects_tampered_data(self):
        kp = generate_keypair()
        sig = sign({"a": 1}, kp.private_key_hex)
        assert verify_signature({"a": 2}, sig, kp.public_key_hex) is False

    def test_verify_rejects_wrong_key(self):
        kp1 = generate_keypair()
        kp2 = generate_keypair()
        sig = sign({"a": 1}, kp1.private_key_hex)
        assert verify_signature({"a": 1}, sig, kp2.public_key_hex) is False

    def test_key_id_is_16_char_hex(self):
        kp = generate_keypair()
        kid = key_id(kp.public_key_hex)
        assert len(kid) == 16
        int(kid, 16)

    def test_key_id_deterministic(self):
        kp = generate_keypair()
        assert key_id(kp.public_key_hex) == key_id(kp.public_key_hex)


# ── Schema validation ──

class TestSchema:
    def test_valid_candidate_manifest(self):
        m = {
            "schemaVersion": "praxis-protocol/v1",
            "candidateId": "c-1",
            "policyId": "p-1",
            "baseHash": "a" * 64,
            "intent": "test",
            "submittedBy": {"identityId": "A", "keyId": "b" * 16},
            "submittedAt": "2026-07-11T00:00:00Z",
        }
        r = validate("candidate-manifest-v1", m)
        assert r.ok is True

    def test_missing_schema_version_rejects(self):
        m = {"candidateId": "c-1"}
        r = validate("candidate-manifest-v1", m)
        assert r.ok is False
        assert any("schemaVersion" in i for i in r.issues)

    def test_bad_base_hash_rejects(self):
        m = {
            "schemaVersion": "praxis-protocol/v1",
            "candidateId": "c-1",
            "policyId": "p-1",
            "baseHash": "not-hex",
            "intent": "x",
            "submittedBy": {"identityId": "A", "keyId": "b" * 16},
            "submittedAt": "2026-07-11T00:00:00Z",
        }
        r = validate("candidate-manifest-v1", m)
        assert r.ok is False
        assert any("baseHash" in i for i in r.issues)

    def test_valid_envelope(self):
        e = {
            "protocolVersion": "praxis-protocol/v1",
            "envelopeKind": "verify.request",
            "sender": {"identityId": "A", "keyId": "b" * 16},
            "capabilities": ["verify.cold"],
            "issuedAt": "2026-07-11T00:00:00Z",
            "nonce": "nonce-sufficient-length",
            "payload": {},
        }
        r = validate("protocol-v1", e)
        assert r.ok is True

    def test_wrong_envelope_version_rejects(self):
        e = {
            "protocolVersion": "praxis-protocol/v0.99",
            "envelopeKind": "verify.request",
            "sender": {"identityId": "A", "keyId": "b"},
            "capabilities": ["verify.cold"],
            "issuedAt": "2026-07-11T00:00:00Z",
            "nonce": "nonce-12345678",
            "payload": {},
        }
        r = validate("protocol-v1", e)
        assert r.ok is False

    def test_valid_evidence_bundle(self):
        b = {
            "schemaVersion": "praxis-protocol/v1",
            "candidateId": "c-1",
            "merkleRoot": "a" * 64,
            "attestation": {"runnerDigest": "sha256:" + "b" * 64, "toolchain": {"language": "ts", "compiler": "tsc", "version": "5.9"}},
            "records": [],
        }
        r = validate("evidence-bundle-v1", b)
        assert r.ok is True

    def test_bad_merkle_root_rejects(self):
        b = {
            "schemaVersion": "praxis-protocol/v1",
            "candidateId": "c-1",
            "merkleRoot": "not-hex",
            "attestation": {"runnerDigest": "sha256:" + "a" * 64},
            "records": [],
        }
        r = validate("evidence-bundle-v1", b)
        assert r.ok is False

    def test_valid_verification_policy(self):
        p = {
            "schemaVersion": "praxis-protocol/v1",
            "policyId": "p-1",
            "blastRadius": "repo",
            "effectClasses": {
                "reversible": {"allowed": True, "requiresCompensationPlan": False},
                "compensable": {"allowed": True, "requiresCompensationPlan": True},
                "irreversible": {"allowed": True, "requiresCompensationPlan": True},
            },
            "authority": {"requiredIdentityId": "A", "humanApprovalRequired": True},
        }
        r = validate("verification-policy-v1", p)
        assert r.ok is True

    def test_invalid_blast_radius_rejects(self):
        p = {
            "schemaVersion": "praxis-protocol/v1",
            "policyId": "p-1",
            "blastRadius": "galaxy",
            "effectClasses": {
                "reversible": {"allowed": True, "requiresCompensationPlan": False},
                "compensable": {"allowed": True, "requiresCompensationPlan": True},
                "irreversible": {"allowed": True, "requiresCompensationPlan": True},
            },
            "authority": {"requiredIdentityId": "A", "humanApprovalRequired": True},
        }
        r = validate("verification-policy-v1", p)
        assert r.ok is False

    def test_unknown_schema_rejects(self):
        r = validate("nonexistent-schema", {})
        assert r.ok is False


# ── Client ──

class TestClient:
    def _make_client(self):
        kp = generate_keypair()
        return VersionedPraxisClient(
            ClientOptions(
                identity_id="agent-1",
                praxis_public_key_hex=kp.public_key_hex,
                capabilities=["verify.cold"],
            )
        ), kp

    def test_handshake_envelope_shape(self):
        client, _ = self._make_client()
        env = client.handshake(now="2026-07-11T00:00:00Z")
        assert env["protocolVersion"] == "praxis-protocol/v1"
        assert env["envelopeKind"] == "capability.handshake"
        assert "verify.cold" in env["capabilities"]
        assert env["sender"]["identityId"] == "agent-1"
        assert len(env["nonce"]) == 16

    def test_promote_request_envelope_shape(self):
        client, _ = self._make_client()
        req = PromotionRequest(
            candidate_id="c-1",
            base_hash="a" * 64,
            receipt={"dummy": True},
            reason="test promotion",
        )
        env = client.build_promote_request(req, now="2026-07-11T00:00:00Z")
        assert env["envelopeKind"] == "promote.request"
        assert "promote.authority" in env["capabilities"]
        assert env["payload"]["candidateId"] == "c-1"

    def test_evaluate_promote_rejects_wrong_version(self):
        client, _ = self._make_client()
        env = {"protocolVersion": "wrong", "envelopeKind": "promote.request", "capabilities": ["promote.authority"], "payload": {}}
        result = client.evaluate_promote(env)
        assert result.decision == "REJECTED"
        assert result.reason_code == "PC_PROTOCOL_VERSION"

    def test_evaluate_promote_rejects_not_promote(self):
        client, _ = self._make_client()
        env = {"protocolVersion": "praxis-protocol/v1", "envelopeKind": "verify.request", "capabilities": ["promote.authority"], "payload": {}}
        result = client.evaluate_promote(env)
        assert result.decision == "REJECTED"
        assert result.reason_code == "PC_NOT_PROMOTE"

    def test_evaluate_promote_rejects_missing_fields(self):
        client, _ = self._make_client()
        env = {"protocolVersion": "praxis-protocol/v1", "envelopeKind": "promote.request", "capabilities": ["promote.authority"], "payload": {"candidateId": "c-1"}}
        result = client.evaluate_promote(env)
        assert result.decision == "REJECTED"
        assert result.reason_code == "PC_MISSING_FIELDS"

    def test_promotion_determinism(self):
        """Same inputs → same verdict."""
        client1, _ = self._make_client()
        client2, _ = self._make_client()
        env = {
            "protocolVersion": "praxis-protocol/v1",
            "envelopeKind": "promote.request",
            "capabilities": ["promote.authority"],
            "payload": {"candidateId": "c-1", "baseHash": "a" * 64, "receipt": {"schemaVersion": "praxis-protocol/v1", "receiptId": "r-1", "candidateId": "c-1", "policyId": "p-1", "baseHash": "a" * 64, "merkleRoot": "b" * 64, "gateResults": [], "issuedAt": "2026-07-11T00:00:00Z", "expiresAt": "2099-01-01T00:00:00Z", "singleUseKeyId": "x", "issuer": {"identityId": "A"}, "signature": {"algorithm": "ed25519", "value": "c" * 128, "signedPayloadDigest": "d" * 64}, "consumedAt": None}},
        }
        r1 = client1.evaluate_promote(env)
        r2 = client2.evaluate_promote(env)
        # Both should fail signature verification (c*128 is not a real sig)
        assert r1.decision == r2.decision
        assert r1.reason_code == r2.reason_code
