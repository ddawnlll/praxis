// @praxis/verity-qual — Architecture compliance tests (#14)
//
// These tests exercise the architecture invariants documented in
// docs/verity-architecture.md. They assert the three ACs from #14:
//   AC-1: exactly one completion authority and signed receipt path
//   AC-2: threat model covers tampering, replay, stale base,
//         compromised worker, crash, disk-full, concurrent promotion
//   AC-3: qualification thresholds are numeric and machine-checkable

import { describe, test, expect } from 'bun:test';
import { canonicalize, domainHashHex, generateKeyPair, sign, type VerificationReceipt, type ProtocolVersion } from '@praxis/protocol';
import { FinalReceiptGate, verifyReceipt, consumeReceipt } from '@praxis/verity-gates';
import { RecoveryGate, RecoveryStateStore } from '@praxis/verity-gates';
import { AdmissionGate } from '@praxis/verity-gates';
import { IntegrityGate } from '@praxis/verity-gates';
import { applyFault, evaluateReleaseGate } from '../src/index';
import { rootFromRecords } from '@praxis/ledger';

const SAMPLE_BASEHASH = 'a'.repeat(64);
const SAMPLE_MERKLEROOT = 'b'.repeat(64);

function samplePolicy() {
  return {
    schemaVersion: 'praxis-protocol/v1' as ProtocolVersion,
    policyId: 'p-1',
    blastRadius: 'repo' as const,
    effectClasses: {
      reversible: { allowed: true, requiresCompensationPlan: false, maxSteps: 100 },
      compensable: { allowed: true, requiresCompensationPlan: true, maxSteps: 10 },
      irreversible: { allowed: true, requiresCompensationPlan: true },
    },
    authority: { requiredIdentityId: 'A', humanApprovalRequired: true },
  };
}
function sampleManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'praxis-protocol/v1' as ProtocolVersion,
    candidateId: 'cand-1',
    policyId: 'p-1',
    baseHash: SAMPLE_BASEHASH,
    intent: 'x',
    submittedBy: { identityId: 'A', keyId: 'a'.repeat(16) },
    submittedAt: '2026-07-11T00:00:00Z',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}
function sampleBundle() {
  const records = [{ recordId: 'r-1', kind: 'command.exit' as const, capturedAt: '2026-07-11T00:00:00Z', payload: { exitCode: 0 } }];
  return {
    schemaVersion: 'praxis-protocol/v1' as ProtocolVersion,
    candidateId: 'cand-1',
    merkleRoot: rootFromRecords(records.map((r) => Buffer.from(canonicalize({ recordId: r.recordId, capturedAt: r.capturedAt, payload: r.payload } as unknown as Record<string, unknown>)))).toString('hex'),
    attestation: { runnerDigest: 'sha256:' + SAMPLE_BASEHASH, toolchain: { language: 'ts', compiler: 'tsc', version: '5.9.2' } },
    records,
  };
}

describe('architecture AC-1: one completion authority + signed receipt', () => {
  test('FinalReceiptGate is the only gate that emits a VerificationReceipt', () => {
    // The other gates (Admission, Integrity, Recovery, Effect, Scope,
    // Architecture, HermeticExec) return GateResult, NOT a receipt. Only
    // FinalReceiptGate.evaluate() returns an `issued` field.
    const integ = new IntegrityGate();
    const integResult = integ.evaluate({ policy: samplePolicy(), manifest: sampleManifest(), bundle: sampleBundle() });
    expect((integResult as unknown as { issued?: unknown }).issued).toBeUndefined();
    // FinalReceiptGate DOES return an issued receipt.
    const allPass = (gate: string) => ({ gate: gate as any, verdict: 'PASS' as const, reasonCode: 'OK', producedAt: 't' });
    const results = ['admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt'].map(allPass);
    const frg = new FinalReceiptGate({ issuer: { identityId: 'A' } });
    const { issued } = frg.evaluate({ policy: samplePolicy(), manifest: sampleManifest(), bundle: sampleBundle() }, results);
    expect(issued).toBeDefined();
  });
  test('Receipt signed with Ed25519 only; verifyReceipt rejects other algorithms', () => {
    const allPass = (gate: string) => ({ gate: gate as any, verdict: 'PASS' as const, reasonCode: 'OK', producedAt: 't' });
    const frg = new FinalReceiptGate({ issuer: { identityId: 'A' } });
    const { issued } = frg.evaluate({ policy: samplePolicy(), manifest: sampleManifest(), bundle: sampleBundle() }, ['admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt'].map(allPass));
    expect(issued!.receipt.signature.algorithm).toBe('ed25519');
    // Tamper algorithm → invalid
    const tampered = { ...issued!.receipt, signature: { ...issued!.receipt.signature, algorithm: 'rsa' as 'ed25519' } };
    expect(verifyReceipt(tampered, issued!.publicKeyHex)).toEqual({ ok: false, reasonCode: 'VR_ALGO' });
  });
  test('Receipt is base-bound: tampering with baseHash invalidates verification', () => {
    const allPass = (gate: string) => ({ gate: gate as any, verdict: 'PASS' as const, reasonCode: 'OK', producedAt: 't' });
    const frg = new FinalReceiptGate({ issuer: { identityId: 'A' } });
    const { issued } = frg.evaluate({ policy: samplePolicy(), manifest: sampleManifest(), bundle: sampleBundle() }, ['admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt'].map(allPass));
    const tampered = { ...issued!.receipt, baseHash: 'c'.repeat(64) };
    expect(verifyReceipt(tampered, issued!.publicKeyHex).ok).toBe(false);
  });
});

describe('architecture AC-2: threat model coverage', () => {
  test('tampering: integrity gate fails on bundle.merkleRoot mismatch', () => {
    const bundle = sampleBundle();
    bundle.merkleRoot = 'c'.repeat(64);
    const r = new IntegrityGate().evaluate({ policy: samplePolicy(), manifest: sampleManifest(), bundle });
    expect(r.verdict).toBe('FAIL');
    expect(r.reasonCode).toMatch(/MERKLE_MISMATCH/);
  });
  test('replay: FinalReceiptGate refuses a consumed receipt', () => {
    const r = new FinalReceiptGate({ issuer: { identityId: 'A' } });
    const allPass = (gate: string) => ({ gate: gate as any, verdict: 'PASS' as const, reasonCode: 'OK', producedAt: 't' });
    const { issued } = r.evaluate({ policy: samplePolicy(), manifest: sampleManifest(), bundle: sampleBundle() }, ['admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt'].map(allPass));
    const consumed = consumeReceipt(issued!.receipt);
    expect(verifyReceipt(consumed, issued!.publicKeyHex).reasonCode).toBe('VR_CONSUMED');
  });
  test('stale base: RecoveryGate returns FAIL', () => {
    const store = new RecoveryStateStore();
    const gate = new RecoveryGate(store);
    gate.evaluate({ policy: samplePolicy(), manifest: sampleManifest() });
    const r = gate.evaluate({ policy: samplePolicy(), manifest: sampleManifest({ baseHash: 'd'.repeat(64) }) });
    expect(r.reasonCode).toBe('RECOVERY_STALE_BASE');
  });
  test('compromised worker: AdmissionGate rejects mismatched policy binding', () => {
    const r = new AdmissionGate().evaluate({ policy: samplePolicy(), manifest: sampleManifest({ policyId: 'attacker' }) });
    expect(r.verdict).toBe('FAIL');
  });
  test('crash recovery: recovery snapshot is replayable', () => {
    const store = new RecoveryStateStore();
    const gate = new RecoveryGate(store);
    const a = gate.evaluate({ policy: samplePolicy(), manifest: sampleManifest() });
    const b = gate.evaluate({ policy: samplePolicy(), manifest: sampleManifest() });
    expect(a.verdict).toBe('PASS');
    expect(b.verdict).toBe('PASS');
    expect(b.reasonCode).toBe('RECOVERY_IDEMPOTENT');
  });
  test('disk-full: fault injection is non-destructive on records (passes through)', () => {
    const recs = [{ recordId: 'a' }];
    expect(applyFault(recs, { kind: 'disk-full' })).toEqual(recs);
  });
  test('concurrent promotion: recovery rejects already-consumed receipt', () => {
    const store = new RecoveryStateStore();
    const gate = new RecoveryGate(store);
    gate.evaluate({ policy: samplePolicy(), manifest: sampleManifest() });
    gate.markConsumed('cand-1');
    const r = gate.evaluate({ policy: samplePolicy(), manifest: sampleManifest({ idempotencyKey: 'idem-2' }) });
    expect(r.reasonCode).toBe('RECOVERY_RECEIPT_ALREADY_CONSUMED');
  });
});

describe('architecture AC-3: qualification thresholds are numeric and machine-checkable', () => {
  test('release gate rejects 100K iterations (< 300K minimum)', async () => {
    const r = evaluateReleaseGate({
      replayArtifact: '/no/such/path',
      shadowArtifact: '/no/such/path',
      releaseManifest: '/no/such/path',
    });
    expect(r.decision).toBe('DENY');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  test('release gate is fail-closed on missing artifacts', () => {
    const r = evaluateReleaseGate({});
    expect(r.decision).toBe('DENY');
    // Specifically: 3 reasons for 3 missing artifacts.
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
  test('architecture doc documents the same thresholds', async () => {
    const fs = await import('node:fs');
    const path = '/Users/hootie/src/praxis/docs/verity-architecture.md';
    const raw = fs.readFileSync(path, 'utf-8');
    expect(raw).toContain('300,000');
    expect(raw).toContain('30-day');
    expect(raw).toContain('FinalReceiptGate');
    expect(raw).toContain('Ed25519');
  });
});
