// @praxis/protocol — praxis-protocol/v1 canonical serialization.
//
// This is a deterministic JSON serializer sufficient for short structured
// payloads (policies, manifests, evidence bundles, receipts). It is NOT a
// full RFC 8785 implementation: it is a JCS-flavored canonicalization with
// strict UTF-8 handling, deterministic object key ordering, stable number
// formatting, and a domain separation prefix.
//
// Properties:
//   * Keys are sorted by their UTF-16 code-unit sequence (lexicographic).
//   * `undefined` values in objects are dropped (objects) or kept as `null` (arrays).
//   * Numbers are formatted via JSON.stringify's number-toString which matches ECMA.
//   * Strings are escaped per ECMA JSON; surrogate pairs are preserved.
//   * Two equivalent objects produce byte-equal output.

import { createHash, createHmac } from 'node:crypto';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue }
  // Permissive escape hatch: TypeScript cannot prove that a typed
  // interface is JSON-serializable, but at runtime everything is.
  // We use this in callers that know their input is safe to serialize.
  | object;

/**
 * Canonical bytes for a JSON value. The optional `domain` is mixed into the
 * SHA-256 hash as a domain separation tag, preventing one context's hash from
 * being confused with another's.
 */
export function canonicalize(value: JsonValue): Buffer {
  return Buffer.from(toCanonicalString(value), 'utf-8');
}

export function toCanonicalString(value: JsonValue): string {
  return serialize(value);
}

function serialize(v: JsonValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new TypeError('Non-finite numbers are not allowed in canonical form');
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map(serialize).join(',') + ']';
  }
  if (typeof v === 'object') {
    const obj = v as { [k: string]: JsonValue };
    const keys = Object.keys(obj).sort(); // UTF-16 lexicographic
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) continue; // drop undefined keys
      parts.push(JSON.stringify(k) + ':' + serialize(val));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError(`Unsupported value type: ${typeof v}`);
}

/** Domain-separated SHA-256 hash. */
export function domainHash(domain: string, value: JsonValue): Buffer {
  const h = createHash('sha256');
  h.update(domain, 'utf-8');
  h.update('\0', 'utf-8');
  h.update(canonicalize(value));
  return h.digest();
}

/** Hex helper (lowercase). */
export function toHex(buf: Buffer): string {
  return buf.toString('hex');
}

export function domainHashHex(domain: string, value: JsonValue): string {
  return toHex(domainHash(domain, value));
}

/** HMAC-SHA-256 for primitive uses (single-use-key, key-derivation). */
export function hmacSha256(key: Buffer | string, data: Buffer | string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
