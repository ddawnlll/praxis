// @praxis/verity-client — versioned client tests

import { describe, test, expect } from 'bun:test';
import { VersionedPraxisClient, type PromotionRequest } from '../src/versionedClient';
import {
  generateKeyPair, sign, canonicalize, type VerificationReceipt, type ProtocolVersion,
} from '@praxis/protocol';
import { rootFromRecords } from '@praxis/ledger';

const SAMPLE_BASEHASH = 'a'.repeat(64);
const SAMPLE_MERKLEROOT = 'b'.repeat(64);

function sampleReceipt(kp: ReturnType<typeof generateKeyPair>, overrides: Partial<VerificationReceipt> = {}): VerificationReceipt {
  // Build the body first (without signature), then sign the body.
  const body: Omit<VerificationReceipt, 'signature'> = {
    schemaVersion: 'praxis-protocol/v1' as ProtocolVersion,
    receiptId: 'r-1',
    candidateId: 'cand-1',
    policyId: 'p-1',
    baseHash: SAMPLE_BASEHASH,
    merkleRoot: SAMPLE_MERKLEROOT,
    gateResults: [{ gate: 'admission', verdict: 'PASS', reasonCode: 'OK', producedAt: '2026-07-11T00:00:00Z' }],
    issuedAt: '2026-07-11T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
    singleUseKeyId: 'suk-1',
    consumedAt: null,
    issuer: { identityId: 'A', keyId: 'k' },
    ...overrides,
  } as Omit<VerificationReceipt, 'signature'>;
  const { signature, signedPayloadDigest } = sign(body, kp);
  return {
    ...body,
    signature: { algorithm: 'ed25519', value: signature.toString('hex'), signedPayloadDigest: signedPayloadDigest.toString('hex') },
  };
}

describe('VersionedPraxisClient', () => {
  test('handshake envelope has correct shape', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['verify.cold', 'receipt.issue'] });
    const env = c.handshake();
    expect(env.protocolVersion).toBe('praxis-protocol/v1');
    expect(env.envelopeKind).toBe('capability.handshake');
    expect(env.capabilities).toContain('verify.cold');
  });
  test('buildPromoteRequest wraps receipt in the envelope payload', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const r = sampleReceipt(kp);
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: SAMPLE_BASEHASH, receipt: r, reason: 'deploy' });
    expect(env.envelopeKind).toBe('promote.request');
    const payload = env.payload as { receipt: VerificationReceipt; candidateId: string };
    expect(payload.receipt.receiptId).toBe('r-1');
    expect(payload.candidateId).toBe('cand-1');
  });
  test('evaluatePromote accepts a valid receipt and consumes it', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const r = sampleReceipt(kp);
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: SAMPLE_BASEHASH, receipt: r, reason: 'x' });
    const result = c.evaluatePromote(env);
    expect(result.decision).toBe('APPLIED');
    expect(c.consumedCount).toBe(1);
  });
  test('replay is rejected after first consumption', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const r = sampleReceipt(kp);
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: SAMPLE_BASEHASH, receipt: r, reason: 'x' });
    expect(c.evaluatePromote(env).decision).toBe('APPLIED');
    const result2 = c.evaluatePromote(env);
    expect(result2.decision).toBe('REJECTED');
    expect(result2.reasonCode).toBe('PC_REPLAY');
  });
  test('base mismatch is rejected', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const r = sampleReceipt(kp);
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: 'd'.repeat(64), receipt: r, reason: 'x' });
    const result = c.evaluatePromote(env);
    expect(result.decision).toBe('REJECTED');
    expect(result.reasonCode).toBe('PC_BASE_MISMATCH');
  });
  test('candidate mismatch is rejected', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const r = sampleReceipt(kp, { candidateId: 'other' });
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: SAMPLE_BASEHASH, receipt: r, reason: 'x' });
    const result = c.evaluatePromote(env);
    expect(result.decision).toBe('REJECTED');
    expect(result.reasonCode).toBe('PC_CANDIDATE_MISMATCH');
  });
  test('consumed receipt is rejected', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const r = sampleReceipt(kp, { consumedAt: '2026-07-11T00:00:00Z' });
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: SAMPLE_BASEHASH, receipt: r, reason: 'x' });
    expect(c.evaluatePromote(env).reasonCode).toBe('PC_CONSUMED');
  });
  test('expired receipt is rejected', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const r = sampleReceipt(kp, { expiresAt: '2020-01-01T00:00:00Z' });
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: SAMPLE_BASEHASH, receipt: r, reason: 'x' });
    expect(c.evaluatePromote(env).reasonCode).toBe('PC_EXPIRED');
  });
  test('wrong public key cannot verify', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp1.publicKeyHex, capabilities: ['promote.authority'] });
    // Sign with kp2 but client expects kp1
    const r = sampleReceipt(kp2);
    const env = c.buildPromoteRequest({ candidateId: 'cand-1', baseHash: SAMPLE_BASEHASH, receipt: r, reason: 'x' });
    expect(c.evaluatePromote(env).reasonCode).toBe('PC_SIGNATURE_INVALID');
  });
  test('protocol version mismatch is rejected', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const env = c.handshake();
    (env as { protocolVersion: string }).protocolVersion = 'praxis-protocol/v0';
    expect(c.evaluatePromote(env).reasonCode).toBe('PC_PROTOCOL_VERSION');
  });
  test('non-promote envelope kind is rejected', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: ['promote.authority'] });
    const env = c.handshake();
    expect(c.evaluatePromote(env).reasonCode).toBe('PC_NOT_PROMOTE');
  });
  test('missing promote capability is rejected', () => {
    const kp = generateKeyPair();
    const c = new VersionedPraxisClient({ identity: { identityId: 'A' }, praxisPublicKeyHex: kp.publicKeyHex, capabilities: [] });
    const env = c.handshake();
    (env as { envelopeKind: string }).envelopeKind = 'promote.request';
    expect(c.evaluatePromote(env).reasonCode).toBe('PC_NO_PROMOTE_CAP');
  });
});
