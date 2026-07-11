// @praxis/protocol — schema validation tests
//
// These tests cover the positive, negative, and boundary fixtures required by
// issue #15 AC-1/2/3 and the cross-runtime invariants from #20.

import { describe, test, expect } from 'bun:test';
import { validate, assertValid, type SchemaName } from '../src/v1/schemas';

const SAMPLE_BASEHASH = 'a'.repeat(64);
const SAMPLE_MERKLEROOT = 'b'.repeat(64);

function sampleEnvelope() {
  return {
    protocolVersion: 'praxis-protocol/v1',
    envelopeKind: 'verify.request',
    sender: { identityId: 'A', keyId: 'a'.repeat(16) },
    capabilities: ['verify.cold', 'receipt.issue'],
    issuedAt: '2026-07-11T00:00:00Z',
    expiresAt: '2026-07-12T00:00:00Z',
    nonce: 'nonce-1234',
    payload: { candidateId: 'cand-1' },
  };
}

function samplePolicy() {
  return {
    schemaVersion: 'praxis-protocol/v1',
    policyId: 'policy-default',
    blastRadius: 'repo',
    effectClasses: {
      reversible: { allowed: true, requiresCompensationPlan: false, maxSteps: 100 },
      compensable: { allowed: true, requiresCompensationPlan: true, maxSteps: 10 },
      irreversible: { allowed: false, requiresCompensationPlan: true },
    },
    authority: { requiredIdentityId: 'A', humanApprovalRequired: true },
    scope: { allowedGlobs: ['**/*.ts'], forbiddenGlobs: ['**/secrets/**'] },
    commands: { exactAllowed: ['bun test', 'bun run typecheck'], hardDenied: ['rm -rf /'] },
  };
}

function sampleManifest() {
  return {
    schemaVersion: 'praxis-protocol/v1',
    candidateId: 'cand-1',
    policyId: 'policy-default',
    baseHash: SAMPLE_BASEHASH,
    intent: 'verify schemas',
    submittedBy: { identityId: 'A', keyId: 'a'.repeat(16) },
    submittedAt: '2026-07-11T00:00:00Z',
    idempotencyKey: 'idem-1',
    rollbackPointer: 'p-1',
  };
}

function sampleBundle() {
  return {
    schemaVersion: 'praxis-protocol/v1',
    candidateId: 'cand-1',
    merkleRoot: SAMPLE_MERKLEROOT,
    attestation: {
      runnerDigest: 'sha256:' + SAMPLE_BASEHASH,
      toolchain: { language: 'typescript', compiler: 'tsc', version: '5.9.2' },
      dependencyLocks: ['package-lock.json'],
      environmentFingerprint: 'env-fp-1',
    },
    records: [
      { recordId: 'r-1', kind: 'command.exit', capturedAt: '2026-07-11T00:00:00Z', payload: { exitCode: 0 } },
    ],
  };
}

function sampleReceipt() {
  return {
    schemaVersion: 'praxis-protocol/v1',
    receiptId: 'receipt-1',
    candidateId: 'cand-1',
    policyId: 'policy-default',
    baseHash: SAMPLE_BASEHASH,
    merkleRoot: SAMPLE_MERKLEROOT,
    gateResults: [
      { gate: 'admission', verdict: 'PASS', reasonCode: 'OK', producedAt: '2026-07-11T00:00:00Z' },
      { gate: 'finalReceipt', verdict: 'PASS', reasonCode: 'OK', producedAt: '2026-07-11T00:00:00Z' },
    ],
    issuedAt: '2026-07-11T00:00:00Z',
    expiresAt: '2026-07-12T00:00:00Z',
    singleUseKeyId: 'single-use-1',
    consumedAt: null,
    issuer: { identityId: 'A', keyId: 'a'.repeat(16) },
    signature: {
      algorithm: 'ed25519',
      value: 'a'.repeat(128),
      signedPayloadDigest: 'c'.repeat(64),
    },
  };
}

const POSITIVES: Array<[SchemaName, unknown]> = [
  ['protocol-v1', sampleEnvelope()],
  ['verification-policy-v1', samplePolicy()],
  ['candidate-manifest-v1', sampleManifest()],
  ['evidence-bundle-v1', sampleBundle()],
  ['verification-receipt-v1', sampleReceipt()],
];

describe('protocol v1 — positive fixtures', () => {
  for (const [name, value] of POSITIVES) {
    test(`${name} accepts a valid fixture`, () => {
      const r = validate(name, value);
      expect(r.ok).toBe(true);
      expect(r.issues.length).toBe(0);
    });
  }
  for (const [name, value] of POSITIVES) {
    test(`${name} assertValid round-trips the input`, () => {
      const out = assertValid(name, value);
      expect(out).toBe(value);
    });
  }
});

describe('protocol v1 — unknown required capabilities are rejected', () => {
  test('protocol-v1: unknown capability fails', () => {
    const v = sampleEnvelope();
    (v.capabilities as string[]).push('unknown.capability');
    const r = validate('protocol-v1', v);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('must be equal to one of the allowed values'))).toBe(true);
  });
});

describe('protocol v1 — protocol version is locked to v1', () => {
  test('protocol-v1: unknown protocolVersion fails', () => {
    const v = { ...sampleEnvelope(), protocolVersion: 'praxis-protocol/v0' };
    const r = validate('protocol-v1', v);
    expect(r.ok).toBe(false);
  });
  test('verification-policy-v1: unknown schemaVersion fails', () => {
    const v = { ...samplePolicy(), schemaVersion: 'praxis-protocol/v0' };
    const r = validate('verification-policy-v1', v);
    expect(r.ok).toBe(false);
  });
});

describe('protocol v1 — schemas reject authority-bearing agent claims', () => {
  test('envelope: missing sender fails', () => {
    const v: any = sampleEnvelope();
    delete v.sender;
    const r = validate('protocol-v1', v);
    expect(r.ok).toBe(false);
  });
  test('manifest: missing submittedBy fails', () => {
    const v: any = sampleManifest();
    delete v.submittedBy;
    const r = validate('candidate-manifest-v1', v);
    expect(r.ok).toBe(false);
  });
  test('receipt: missing issuer fails', () => {
    const v: any = sampleReceipt();
    delete v.issuer;
    const r = validate('verification-receipt-v1', v);
    expect(r.ok).toBe(false);
  });
  test('receipt: missing signature fails', () => {
    const v: any = sampleReceipt();
    delete v.signature;
    const r = validate('verification-receipt-v1', v);
    expect(r.ok).toBe(false);
  });
});

describe('protocol v1 — hash format', () => {
  test('manifest: bad baseHash pattern fails', () => {
    const v = { ...sampleManifest(), baseHash: 'not-a-hash' };
    const r = validate('candidate-manifest-v1', v);
    expect(r.ok).toBe(false);
  });
  test('receipt: bad signature length fails', () => {
    const v = { ...sampleReceipt(), signature: { ...sampleReceipt().signature, value: 'ab' } };
    const r = validate('verification-receipt-v1', v);
    expect(r.ok).toBe(false);
  });
});

describe('protocol v1 — additional properties are forbidden', () => {
  test('envelope rejects extra top-level fields', () => {
    const v = { ...sampleEnvelope(), rogueField: 'x' } as any;
    const r = validate('protocol-v1', v);
    expect(r.ok).toBe(false);
  });
});
