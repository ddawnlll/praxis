"""Versioned Praxis client — Python equivalent of @praxis/verity-client.

Provides:
- Capability handshake envelope construction
- Promotion request construction
- Server-side promotion evaluation (receipt verification + single-use enforcement)
"""

from __future__ import annotations
import secrets
from dataclasses import dataclass, field
from typing import Any

from .canonical import canonicalize
from .crypto import generate_keypair, sign, verify_signature, key_id, KeyPair
from .schema import validate


@dataclass
class ClientOptions:
    identity_id: str
    praxis_public_key_hex: str
    key_id_override: str | None = None
    capabilities: list[str] = field(default_factory=lambda: ["verify.cold"])


@dataclass
class PromotionRequest:
    candidate_id: str
    base_hash: str
    receipt: dict[str, Any]
    reason: str


@dataclass
class PromotionResult:
    decision: str  # 'APPLIED' | 'REJECTED' | 'HOLD'
    reason_code: str
    promotion_id: str


class VersionedPraxisClient:
    """Python equivalent of the TypeScript VersionedPraxisClient."""

    def __init__(self, opts: ClientOptions) -> None:
        self._opts = opts
        self._key_id = opts.key_id_override or key_id(opts.praxis_public_key_hex)
        self._consumed_receipts: set[str] = set()

    def handshake(self, now: str | None = None) -> dict[str, Any]:
        """Build a capability handshake envelope."""
        now = now or _iso_now()
        return {
            "protocolVersion": "praxis-protocol/v1",
            "envelopeKind": "capability.handshake",
            "sender": {"identityId": self._opts.identity_id, "keyId": self._key_id},
            "capabilities": self._opts.capabilities,
            "issuedAt": now,
            "expiresAt": None,
            "nonce": _nonce(),
            "payload": {"requestedAt": now},
        }

    def build_promote_request(self, req: PromotionRequest, now: str | None = None) -> dict[str, Any]:
        """Build a promote.request envelope."""
        now = now or _iso_now()
        return {
            "protocolVersion": "praxis-protocol/v1",
            "envelopeKind": "promote.request",
            "sender": {"identityId": self._opts.identity_id, "keyId": self._key_id},
            "capabilities": ["promote.authority", "receipt.consume"],
            "issuedAt": now,
            "expiresAt": None,
            "nonce": _nonce(),
            "payload": {
                "candidateId": req.candidate_id,
                "baseHash": req.base_hash,
                "reason": req.reason,
                "receipt": req.receipt,
            },
        }

    def evaluate_promote(self, env: dict[str, Any]) -> PromotionResult:
        """Server-side: evaluate a promotion envelope."""
        if env.get("protocolVersion") != "praxis-protocol/v1":
            return PromotionResult("REJECTED", "PC_PROTOCOL_VERSION", "")
        if env.get("envelopeKind") != "promote.request":
            return PromotionResult("REJECTED", "PC_NOT_PROMOTE", "")
        if "promote.authority" not in env.get("capabilities", []):
            return PromotionResult("REJECTED", "PC_NO_PROMOTE_CAP", "")
        payload = env.get("payload", {})
        receipt = payload.get("receipt")
        candidate_id = payload.get("candidateId")
        base_hash = payload.get("baseHash")
        if not receipt or not candidate_id or not base_hash:
            return PromotionResult("REJECTED", "PC_MISSING_FIELDS", "")

        r = validate("verification-receipt-v1", receipt)
        if not r.ok:
            return PromotionResult("REJECTED", "PC_RECEIPT_SCHEMA", "")
        if receipt.get("candidateId") != candidate_id:
            return PromotionResult("REJECTED", "PC_CANDIDATE_MISMATCH", "")
        if receipt.get("baseHash") != base_hash:
            return PromotionResult("REJECTED", "PC_BASE_MISMATCH", "")
        if receipt.get("consumedAt") is not None:
            return PromotionResult("REJECTED", "PC_CONSUMED", "")
        receipt_id = receipt.get("receiptId", "")
        if receipt_id in self._consumed_receipts:
            return PromotionResult("REJECTED", "PC_REPLAY", "")

        signature = receipt.get("signature", {})
        body = {k: v for k, v in receipt.items() if k != "signature"}
        body["consumedAt"] = None
        if not verify_signature(body, signature.get("value", ""), self._opts.praxis_public_key_hex):
            return PromotionResult("REJECTED", "PC_SIGNATURE_INVALID", "")

        import time
        expires_at = receipt.get("expiresAt", "")
        if expires_at and _parse_iso(expires_at) <= time.time() * 1000:
            return PromotionResult("REJECTED", "PC_EXPIRED", "")

        self._consumed_receipts.add(receipt_id)
        return PromotionResult("APPLIED", "PC_OK", f"promo-{receipt_id}")

    @property
    def consumed_count(self) -> int:
        return len(self._consumed_receipts)


def _nonce() -> str:
    return secrets.token_hex(8)


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(s: str) -> float:
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.timestamp() * 1000
    except Exception:
        return 0
