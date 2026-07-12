"""Praxis Verity Protocol v1 Python client.

Provides:
- Canonical JSON serialization (byte-identical to TypeScript canonicalize)
- Ed25519 key generation, signing, and verification
- Versioned client with handshake, promotion, and receipt verification
- Schema validation helpers
"""

from .canonical import canonicalize
from .crypto import generate_keypair, sign, verify_signature, key_id
from .client import VersionedPraxisClient, ClientOptions, PromotionRequest, PromotionResult
from .schema import validate

__all__ = [
    "canonicalize",
    "generate_keypair",
    "sign",
    "verify_signature",
    "key_id",
    "VersionedPraxisClient",
    "ClientOptions",
    "PromotionRequest",
    "PromotionResult",
    "validate",
]
