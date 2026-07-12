"""Minimal schema validation for praxis-protocol/v1 types.

Validates the same contracts as @praxis/protocol validate():
- protocol-v1 (envelope)
- candidate-manifest-v1
- evidence-bundle-v1
- verification-policy-v1
- verification-receipt-v1

Rules enforced: type, enum/const, required, additionalProperties,
minLength, pattern.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

HEX64 = "^[a-f0-9]{64}$"
PROTOCOL_VERSION = "praxis-protocol/v1"

REQUIRED_ENVELOPE = {"protocolVersion", "envelopeKind", "sender", "capabilities", "payload", "issuedAt", "nonce"}
ENVELOPE_KINDS = {
    "capability.handshake", "verify.request", "verify.response",
    "promote.request", "promote.response", "receipt.audit",
    "kill.signal", "shadow.report",
}
CAPABILITIES = {
    "verify.cold", "verify.daemon", "promote.authority",
    "receipt.issue", "receipt.consume", "kill.authority",
    "shadow.observe", "policy.hepheastus.v0.6",
}
BLAST_RADII = {"sandbox", "repo", "workspace", "staging", "production"}

REQUIRED_MANIFEST = {"schemaVersion", "candidateId", "policyId", "baseHash", "intent", "submittedBy", "submittedAt"}
REQUIRED_BUNDLE = {"schemaVersion", "candidateId", "merkleRoot", "attestation", "records"}
REQUIRED_POLICY = {"schemaVersion", "policyId", "blastRadius", "effectClasses", "authority"}
REQUIRED_RECEIPT = {
    "schemaVersion", "receiptId", "candidateId", "policyId", "baseHash",
    "merkleRoot", "gateResults", "issuedAt", "expiresAt", "singleUseKeyId",
    "issuer", "signature",
}


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    issues: list[str] = field(default_factory=list)


def _check(obj: Any, expected_type: str, name: str) -> str | None:
    if expected_type == "object" and not isinstance(obj, dict):
        return f"{name}: expected object, got {type(obj).__name__}"
    if expected_type == "string" and not isinstance(obj, str):
        return f"{name}: expected string, got {type(obj).__name__}"
    if expected_type == "array" and not isinstance(obj, list):
        return f"{name}: expected array, got {type(obj).__name__}"
    return None


def _check_required(obj: dict, required: set, name: str) -> list[str]:
    issues = []
    for key in required:
        if key not in obj:
            issues.append(f"{name}: missing required field '{key}'")
    return issues


def _check_additional(obj: dict, allowed: set, name: str) -> list[str]:
    extra = set(obj.keys()) - allowed
    if extra:
        return [f"{name}: additional properties not allowed: {extra}"]
    return []


def _check_const(obj: dict, key: str, expected: str, name: str) -> list[str]:
    if key in obj and obj[key] != expected:
        return [f"{name}.{key}: expected '{expected}', got '{obj[key]}'"]
    return []


def _check_enum(obj: dict, key: str, values: set, name: str) -> list[str]:
    if key in obj and obj[key] not in values:
        return [f"{name}.{key}: value '{obj[key]}' not in allowed values"]
    return []


def _check_hex64(obj: dict, key: str, name: str) -> list[str]:
    import re
    if key in obj and not re.match(HEX64, str(obj[key])):
        return [f"{name}.{key}: must be 64-char lowercase hex"]
    return []


def validate(schema: str, obj: Any) -> ValidationResult:
    """Validate *obj* against the named protocol schema."""
    import re

    if schema == "protocol-v1":
        err = _check(obj, "object", "envelope")
        if err:
            return ValidationResult(ok=False, issues=err)
        issues: list[str] = []
        issues += _check_required(obj, REQUIRED_ENVELOPE, "envelope")
        issues += _check_additional(obj, REQUIRED_ENVELOPE | {"expiresAt"}, "envelope")
        issues += _check_const(obj, "protocolVersion", PROTOCOL_VERSION, "envelope")
        issues += _check_enum(obj, "envelopeKind", ENVELOPE_KINDS, "envelope")
        if "sender" in obj:
            s = obj["sender"]
            if isinstance(s, dict):
                issues += _check_additional(s, {"identityId", "keyId"}, "envelope.sender")
                if not s.get("identityId"):
                    issues.append("envelope.sender.identityId: required, minLength 1")
                if not s.get("keyId"):
                    issues.append("envelope.sender.keyId: required, minLength 1")
        if "capabilities" in obj:
            for cap in obj["capabilities"]:
                if cap not in CAPABILITIES:
                    issues.append(f"envelope.capabilities: unknown capability '{cap}'")
        if "nonce" in obj and isinstance(obj["nonce"], str) and len(obj["nonce"]) < 8:
            issues.append("envelope.nonce: minLength 8")
        return ValidationResult(ok=len(issues) == 0, issues=issues)

    if schema == "candidate-manifest-v1":
        err = _check(obj, "object", "manifest")
        if err:
            return ValidationResult(ok=False, issues=err)
        issues = []
        issues += _check_required(obj, REQUIRED_MANIFEST, "manifest")
        issues += _check_const(obj, "schemaVersion", PROTOCOL_VERSION, "manifest")
        issues += _check_hex64(obj, "baseHash", "manifest")
        if "submittedBy" in obj and isinstance(obj["submittedBy"], dict):
            issues += _check_additional(obj["submittedBy"], {"identityId", "keyId"}, "manifest.submittedBy")
        return ValidationResult(ok=len(issues) == 0, issues=issues)

    if schema == "evidence-bundle-v1":
        err = _check(obj, "object", "bundle")
        if err:
            return ValidationResult(ok=False, issues=err)
        issues = []
        issues += _check_required(obj, REQUIRED_BUNDLE, "bundle")
        issues += _check_const(obj, "schemaVersion", PROTOCOL_VERSION, "bundle")
        issues += _check_hex64(obj, "merkleRoot", "bundle")
        if "attestation" in obj and isinstance(obj["attestation"], dict):
            att = obj["attestation"]
            if "runnerDigest" in att and not re.match(r"^[a-z0-9]+:[a-f0-9]{64}$", str(att["runnerDigest"])):
                issues.append("bundle.attestation.runnerDigest: must match algo:hex64")
        return ValidationResult(ok=len(issues) == 0, issues=issues)

    if schema == "verification-policy-v1":
        err = _check(obj, "object", "policy")
        if err:
            return ValidationResult(ok=False, issues=err)
        issues = []
        issues += _check_required(obj, REQUIRED_POLICY, "policy")
        issues += _check_additional(obj, REQUIRED_POLICY | {"scope", "commands"}, "policy")
        issues += _check_const(obj, "schemaVersion", PROTOCOL_VERSION, "policy")
        issues += _check_enum(obj, "blastRadius", BLAST_RADII, "policy")
        return ValidationResult(ok=len(issues) == 0, issues=issues)

    if schema == "verification-receipt-v1":
        err = _check(obj, "object", "receipt")
        if err:
            return ValidationResult(ok=False, issues=err)
        issues = []
        issues += _check_required(obj, REQUIRED_RECEIPT, "receipt")
        issues += _check_const(obj, "schemaVersion", PROTOCOL_VERSION, "receipt")
        issues += _check_hex64(obj, "baseHash", "receipt")
        issues += _check_hex64(obj, "merkleRoot", "receipt")
        if "signature" in obj and isinstance(obj["signature"], dict):
            sig = obj["signature"]
            if sig.get("algorithm") != "ed25519":
                issues.append("receipt.signature.algorithm: must be 'ed25519'")
            if "value" in sig and not re.match(r"^[a-f0-9]{128}$", str(sig["value"])):
                issues.append("receipt.signature.value: must be 128-char hex (64 bytes)")
        return ValidationResult(ok=len(issues) == 0, issues=issues)

    return ValidationResult(ok=False, issues=[f"unknown schema: {schema}"])
