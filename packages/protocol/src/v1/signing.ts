// @praxis/protocol — Ed25519 signing and verification.
//
// Uses Node's built-in crypto (key objects via crypto.generateKeyPairSync).
// No external dependencies. The Ed25519 algorithm is the only supported
// signature algorithm for v1; we throw on any other.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  KeyObject,
} from 'node:crypto';
import { canonicalize, type JsonValue } from './canonicalize';
import type { Identity } from './types';

export const SIGNING_ALGORITHM = 'ed25519';
export const SIGNATURE_DOMAIN = 'praxis-protocol/v1.signature';
export const KEY_ID_DOMAIN = 'praxis-protocol/v1.key-id';

export interface KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicKeyHex: string;
  privateKeyHex: string;
}

/** Generate a fresh Ed25519 key pair. */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex');
  return {
    publicKey,
    privateKey,
    publicKeyHex: pub,
    privateKeyHex: priv,
  };
}

/** Load a key pair from hex-encoded DER bytes. */
export function loadKeyPair(publicKeyHex: string, privateKeyHex: string): KeyPair {
  return {
    publicKey: createPublicKey({ key: Buffer.from(publicKeyHex, 'hex'), format: 'der', type: 'spki' }),
    privateKey: createPrivateKey({ key: Buffer.from(privateKeyHex, 'hex'), format: 'der', type: 'pkcs8' }),
    publicKeyHex,
    privateKeyHex,
  };
}

/** Load only a public key (for verifiers). */
export function loadPublicKey(publicKeyHex: string): KeyObject {
  return createPublicKey({ key: Buffer.from(publicKeyHex, 'hex'), format: 'der', type: 'spki' });
}

export interface SignResult {
  signature: Buffer; // 64 raw bytes
  signedPayloadDigest: Buffer; // 32 raw bytes (sha-256 of canonical payload)
  signedPayload: Buffer; // domain-separated bytes that were actually signed
}

export function sign(value: JsonValue, keyPair: KeyPair): SignResult {
  const canonical = canonicalize(value);
  // Domain separation: prefix the signed bytes with a tag so the same
  // bytes signed for a different protocol context cannot be reused.
  const domainBytes = Buffer.from(SIGNATURE_DOMAIN, 'utf-8');
  const signedPayload = Buffer.concat([domainBytes, canonical]);
  const signedPayloadDigest = require('node:crypto').createHash('sha256').update(signedPayload).digest();
  const sig = edSign(null, signedPayload, keyPair.privateKey);
  return { signature: sig, signedPayloadDigest, signedPayload };
}

export function verify(value: JsonValue, signature: Buffer, publicKey: KeyObject): boolean {
  const canonical = canonicalize(value);
  const domainBytes = Buffer.from(SIGNATURE_DOMAIN, 'utf-8');
  const signedPayload = Buffer.concat([domainBytes, canonical]);
  return edVerify(null, signedPayload, publicKey, signature);
}

/** Stable, short key id derived from a public key. */
export function keyId(publicKey: KeyObject | string): string {
  const pub: KeyObject = typeof publicKey === 'string' ? loadPublicKey(publicKey) : publicKey;
  const der = pub.export({ format: 'der', type: 'spki' });
  const h = require('node:crypto').createHash('sha256');
  h.update(KEY_ID_DOMAIN);
  h.update('\0');
  h.update(der);
  // Short key id: 16 hex chars of the digest.
  return h.digest('hex').slice(0, 16);
}

export interface SignedEnvelope {
  payload: JsonValue;
  signature: {
    algorithm: 'ed25519';
    value: string;
    signedPayloadDigest: string;
  };
  signer: Identity;
}

/** Produce a signed envelope around an arbitrary payload. */
export function signPayload(
  payload: JsonValue,
  keyPair: KeyPair,
  identity: { identityId: string }
): SignedEnvelope {
  const { signature, signedPayloadDigest } = sign(payload, keyPair);
  return {
    payload,
    signature: {
      algorithm: SIGNING_ALGORITHM,
      value: signature.toString('hex'),
      signedPayloadDigest: signedPayloadDigest.toString('hex'),
    },
    signer: { identityId: identity.identityId, keyId: keyId(keyPair.publicKey) },
  };
}

export function verifySignedEnvelope(envelope: SignedEnvelope, publicKey: KeyObject): boolean {
  if (envelope.signature.algorithm !== SIGNING_ALGORITHM) return false;
  const sig = Buffer.from(envelope.signature.value, 'hex');
  if (sig.length !== 64) return false;
  return verify(envelope.payload, sig, publicKey);
}
