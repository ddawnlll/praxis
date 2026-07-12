"""Ed25519 cryptographic primitives for praxis-protocol/v1.

Key format:
  - Public key: 32 bytes, hex-encoded (64 chars)
  - Private key: 32 bytes seed, hex-encoded (64 chars)
  - Signature: 64 bytes, hex-encoded (128 chars)
  - key_id: SHA-256(canonicalize({"publicKey": <hex>})), first 16 hex chars
"""

from __future__ import annotations
import hashlib
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization

from .canonical import canonicalize


@dataclass(frozen=True)
class KeyPair:
    private_key_hex: str
    public_key_hex: str


def generate_keypair() -> KeyPair:
    """Generate a fresh Ed25519 key pair."""
    private = Ed25519PrivateKey.generate()
    priv_bytes = private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_bytes = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return KeyPair(
        private_key_hex=priv_bytes.hex(),
        public_key_hex=pub_bytes.hex(),
    )


def _load_private_key(hex_str: str) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(bytes.fromhex(hex_str))


def _load_public_key(hex_str: str) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(bytes.fromhex(hex_str))


def sign(data: dict | list, private_key_hex: str) -> str:
    """Sign the canonical form of *data* with the given private key. Returns hex signature."""
    msg = canonicalize(data)
    private = _load_private_key(private_key_hex)
    sig = private.sign(msg)
    return sig.hex()


def verify_signature(data: dict | list, signature_hex: str, public_key_hex: str) -> bool:
    """Verify that *signature_hex* is a valid Ed25519 signature over canonicalized *data*."""
    msg = canonicalize(data)
    public = _load_public_key(public_key_hex)
    try:
        public.verify(bytes.fromhex(signature_hex), msg)
        return True
    except Exception:
        return False


def key_id(public_key_hex: str) -> str:
    """Compute the key id from a public key hex string.

    key_id = SHA-256(canonicalize({"publicKey": <hex>})), first 16 hex chars.
    """
    canonical = canonicalize({"publicKey": public_key_hex})
    digest = hashlib.sha256(canonical).hexdigest()
    return digest[:16]
