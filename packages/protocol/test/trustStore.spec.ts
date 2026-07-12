// @praxis/protocol — trust store tests

import { describe, test, expect } from 'bun:test';
import { TrustStore, snapshotHash, type TrustEntry } from '../src/v1/trustStore';
import { generateKeyPair, keyId } from '../src/v1/signing';

function entry(identityId: string, opts: Partial<TrustEntry> = {}): TrustEntry {
  const kp = generateKeyPair();
  return {
    identityId,
    publicKeyHex: kp.publicKeyHex,
    keyId: keyId(kp.publicKey),
    notBefore: '2026-01-01T00:00:00Z',
    notAfter: '2027-01-01T00:00:00Z',
    revoked: false,
    revokedAt: null,
    ...opts,
  };
}

describe('TrustStore', () => {
  test('add + resolve returns the public key', () => {
    const ts = TrustStore.empty();
    const e = entry('identity-A');
    ts.add(e);
    const r = ts.resolve(e.keyId);
    expect(r).not.toBeNull();
    expect(r!.entry.identityId).toBe('identity-A');
  });
  test('missing key resolves to null', () => {
    const ts = TrustStore.empty();
    expect(ts.resolve('not-a-real-key')).toBeNull();
  });
  test('revoked key resolves to null', () => {
    const ts = TrustStore.empty();
    const e = entry('A');
    ts.add(e);
    expect(ts.revoke(e.keyId)).toBe(true);
    expect(ts.resolve(e.keyId)).toBeNull();
  });
  test('expired key resolves to null', () => {
    const ts = TrustStore.empty();
    const e = entry('A', { notAfter: '2020-01-01T00:00:00Z' });
    ts.add(e);
    expect(ts.resolve(e.keyId, new Date('2024-01-01T00:00:00Z'))).toBeNull();
  });
  test('not-yet-valid key resolves to null', () => {
    const ts = TrustStore.empty();
    const e = entry('A', { notBefore: '2099-01-01T00:00:00Z' });
    ts.add(e);
    expect(ts.resolve(e.keyId, new Date('2024-01-01T00:00:00Z'))).toBeNull();
  });
  test('resolveIdentity returns all non-revoked, valid keys', () => {
    const ts = TrustStore.empty();
    const e1 = entry('A');
    const e2 = entry('A');
    const e3 = entry('A', { revoked: true });
    ts.add(e1);
    ts.add(e2);
    ts.add(e3);
    const r = ts.resolveIdentity('A');
    expect(r.length).toBe(2);
    expect(r.find((x) => x.keyId === e1.keyId)).toBeDefined();
    expect(r.find((x) => x.keyId === e2.keyId)).toBeDefined();
    expect(r.find((x) => x.keyId === e3.keyId)).toBeUndefined();
  });
  test('snapshot round-trips', () => {
    const ts = TrustStore.empty();
    ts.add(entry('A'));
    ts.add(entry('B'));
    const snap = ts.snapshot();
    expect(snap.entries.length).toBe(2);
    const ts2 = TrustStore.fromSnapshot(snap);
    expect(ts2.size()).toBe(2);
  });
  test('snapshotHash is deterministic and changes on mutation', () => {
    const ts = TrustStore.empty();
    const e = entry('A');
    ts.add(e);
    const h1 = snapshotHash(ts.snapshot());
    const h2 = snapshotHash(ts.snapshot());
    expect(h1).toBe(h2);
    ts.add(entry('B'));
    const h3 = snapshotHash(ts.snapshot());
    expect(h3).not.toBe(h1);
  });
  test('add() recomputes keyId from public key (anti-spoof)', () => {
    const ts = TrustStore.empty();
    const e = entry('A', { keyId: 'WRONG-KEY-ID' });
    ts.add(e);
    // After add, the keyId should be derived from the actual public key.
    expect(e.keyId).toMatch(/^[a-f0-9]{16}$/);
    expect(e.keyId).not.toBe('WRONG-KEY-ID');
  });
});
