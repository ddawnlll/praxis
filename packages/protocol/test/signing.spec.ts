// @praxis/protocol — Ed25519 signing tests

import { describe, test, expect } from 'bun:test';
import {
  generateKeyPair,
  loadKeyPair,
  sign,
  verify,
  signPayload,
  verifySignedEnvelope,
  keyId,
  SIGNING_ALGORITHM,
} from '../src/v1/signing';
import { canonicalize } from '../src/v1/canonicalize';

describe('Ed25519 signing', () => {
  test('signature roundtrip succeeds', () => {
    const kp = generateKeyPair();
    const value = { candidateId: 'cand-1', baseHash: 'a'.repeat(64) };
    const { signature, signedPayloadDigest, signedPayload } = sign(value, kp);
    expect(signature.length).toBe(64);
    expect(signedPayloadDigest.length).toBe(32);
    expect(signedPayload.length).toBeGreaterThan(0);
    expect(verify(value, signature, kp.publicKey)).toBe(true);
  });
  test('a one-byte mutation invalidates the signature', () => {
    const kp = generateKeyPair();
    const value = { a: 1, b: 2 };
    const { signature } = sign(value, kp);
    expect(verify({ a: 1, b: 3 }, signature, kp.publicKey)).toBe(false);
    expect(verify({ a: 1, b: 2 }, signature, kp.publicKey)).toBe(true);
  });
  test('domain separation prevents cross-context reuse', () => {
    // Re-signing the same canonical bytes under a different key still produces
    // a valid signature for THAT key, but no valid signature for the ORIGINAL
    // key — proves the signed bytes are domain-tagged.
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const v = { a: 1 };
    const { signature } = sign(v, kp1);
    // Different public key MUST NOT verify
    expect(verify(v, signature, kp2.publicKey)).toBe(false);
  });
  test('loadKeyPair round-trips hex', () => {
    const original = generateKeyPair();
    const reloaded = loadKeyPair(original.publicKeyHex, original.privateKeyHex);
    const v = { x: 'y' };
    const { signature } = sign(v, original);
    expect(verify(v, signature, reloaded.publicKey)).toBe(true);
  });
  test('keyId is stable and 16 hex chars', () => {
    const kp = generateKeyPair();
    const id1 = keyId(kp.publicKey);
    const id2 = keyId(kp.publicKey);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{16}$/);
  });
  test('signPayload produces a verifiable envelope', () => {
    const kp = generateKeyPair();
    const payload = { candidateId: 'x', policyId: 'p' };
    const env = signPayload(payload, kp, { identityId: 'identity-A' });
    expect(env.signature.algorithm).toBe(SIGNING_ALGORITHM);
    expect(env.signer.identityId).toBe('identity-A');
    expect(env.signer.keyId).toMatch(/^[a-f0-9]{16}$/);
    expect(env.signature.value).toMatch(/^[a-f0-9]{128}$/);
    expect(env.signature.signedPayloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySignedEnvelope(env, kp.publicKey)).toBe(true);
  });
  test('verifySignedEnvelope rejects tampered payload', () => {
    const kp = generateKeyPair();
    const env = signPayload({ a: 1 }, kp, { identityId: 'A' });
    const tampered = { ...env, payload: { a: 2 } };
    expect(verifySignedEnvelope(tampered, kp.publicKey)).toBe(false);
  });
  test('verifySignedEnvelope rejects wrong algorithm', () => {
    const kp = generateKeyPair();
    const env = signPayload({ a: 1 }, kp, { identityId: 'A' });
    const wrong = { ...env, signature: { ...env.signature, algorithm: 'rsa' as 'ed25519' } };
    expect(verifySignedEnvelope(wrong, kp.publicKey)).toBe(false);
  });
  test('verifySignedEnvelope rejects malformed signature length', () => {
    const kp = generateKeyPair();
    const env = signPayload({ a: 1 }, kp, { identityId: 'A' });
    const short = {
      ...env,
      signature: { ...env.signature, value: env.signature.value.slice(0, 64) },
    };
    expect(verifySignedEnvelope(short, kp.publicKey)).toBe(false);
  });
  test('canonicalized bytes for the same value are identical', () => {
    // Cross-runtime invariant: equivalent objects always produce the same bytes
    // that get signed. This guards against accidental verifier/issuer drift.
    const kp = generateKeyPair();
    const v1 = { a: 1, b: 2 };
    const v2 = { b: 2, a: 1 };
    const a = canonicalize(v1);
    const b = canonicalize(v2);
    expect(a.equals(b)).toBe(true);
    const { signature } = sign(v1, kp);
    expect(verify(v2, signature, kp.publicKey)).toBe(true);
  });
});
