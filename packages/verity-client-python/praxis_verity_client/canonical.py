"""Canonical JSON serialization — byte-identical to TypeScript canonicalize.

The canonical form:
1. Recursively sorts object keys alphabetically.
2. Removes whitespace.
3. Uses UTF-8 encoding.
4. No trailing newline.

This is NOT a general JSON serializer. It produces deterministic output
suitable for cryptographic signing and merkle tree leaf computation.
"""

from __future__ import annotations
import json
from typing import Any


def canonicalize(obj: Any) -> bytes:
    """Serialize *obj* to canonical JSON bytes (sorted keys, no whitespace)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
