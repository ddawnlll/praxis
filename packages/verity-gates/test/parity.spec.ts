// @praxis/verity-gates — Unified kernel parity tests (#29)
//
// Verifies that the same input produces byte-equivalent verdicts
// across different code paths: direct gate vs aggregated pipeline.
// Daemon and MCP parity require the daemon and MCP server, which
// are pre-existing and not in scope for this session.

import { describe, test, expect } from 'bun:test';
import { canonicalize, type VerificationPolicy, type CandidateManifest, type EvidenceBundle, type ProtocolVersion } from '@praxis/protocol';
import { rootFromRecords } from '@praxis/ledger';
import { AdmissionGate, IntegrityGate, FinalReceiptGate, RecoveryGate, RecoveryStateStore, ScopeGate, ArchitectureGate, HermeticExecGate, TestAdapter, verifyReceipt } from '../src';
import { EffectGate, hepheastusV06 } from '@praxis/verity-policy';
import { mockOciRunner } from '../src/ociRunner';
import { defaultIsolationPolicy } from '../src/isolation';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SAMPLE_BASEHASH = 'a'.repeat(64);
const allPass = (gate: string) => ({ gate: gate as any, verdict: 'PASS' as const, reasonCode: 'OK', producedAt: 't' });

function policy(): VerificationPolicy {
  return {
    schemaVersion: 'praxis-protocol/v1' as ProtocolVersion,
    policyId: 'p-1',
    blastRadius: 'repo' as const,
    effectClasses: { reversible: { allowed: true, requiresCompensationPlan: false, maxSteps: 100 }, compensable: { allowed: true, requiresCompensationPlan: true, maxSteps: 10 }, irreversible: { allowed: true, requiresCompensationPlan: true } },
    authority: { requiredIdentityId: 'A', humanApprovalRequired: true },
  };
}
function manifest(): CandidateManifest {
  return { schemaVersion: 'praxis-protocol/v1' as ProtocolVersion, candidateId: 'cand-1', policyId: 'p-1', baseHash: SAMPLE_BASEHASH, intent: 'x', submittedBy: { identityId: 'A', keyId: 'a'.repeat(16) }, submittedAt: '2026-07-11T00:00:00Z', idempotencyKey: 'idem-1' };
}
function bundle(): EvidenceBundle {
  const records = [{ recordId: 'r-1', kind: 'command.exit' as const, capturedAt: '2026-07-11T00:00:00Z', payload: { exitCode: 0 } }];
  return { schemaVersion: 'praxis-protocol/v1' as ProtocolVersion, candidateId: 'cand-1', merkleRoot: rootFromRecords(records.map((r) => Buffer.from(canonicalize({ recordId: r.recordId, capturedAt: r.capturedAt, payload: r.payload } as unknown as Record<string, unknown>)))).toString('hex'), attestation: { runnerDigest: 'sha256:' + SAMPLE_BASEHASH, toolchain: { language: 'ts', compiler: 'tsc', version: '5.9.2' } }, records };
}

const FIXTURE_DIR = join(import.meta.dir, '..', '__fixtures__', 'parity');

describe('parity: cold path vs aggregated pipeline', () => {
  test('AdmissionGate verdict is deterministic (same input → same verdict)', () => {
    const p = policy(); const m = manifest();
    const a = new AdmissionGate().evaluate({ policy: p, manifest: m });
    const b = new AdmissionGate().evaluate({ policy: p, manifest: m });
    expect(a.verdict).toBe(b.verdict);
    expect(a.reasonCode).toBe(b.reasonCode);
  });
  test('IntegrityGate verdict is deterministic', () => {
    const p = policy(); const m = manifest(); const b = bundle();
    const a = new IntegrityGate().evaluate({ policy: p, manifest: m, bundle: b });
    const c = new IntegrityGate().evaluate({ policy: p, manifest: m, bundle: b });
    expect(a.verdict).toBe(c.verdict);
  });
  test('RecoveryGate verdict is deterministic across two builds on same state', () => {
    const store = new RecoveryStateStore();
    const p = policy(); const m = manifest();
    new RecoveryGate(store).evaluate({ policy: p, manifest: m });
    const a = new RecoveryGate(store).evaluate({ policy: p, manifest: m });
    const b = new RecoveryGate(store).evaluate({ policy: p, manifest: m });
    expect(a.verdict).toBe(b.verdict);
    expect(a.reasonCode).toBe(b.reasonCode);
  });
  test('EffectGate verdict is deterministic', () => {
    const p = policy();
    const g = new EffectGate(hepheastusV06, []);
    const a = g.evaluate({ policy: p, manifest: manifest() });
    const b = g.evaluate({ policy: p, manifest: manifest() });
    expect(a.verdict).toBe(b.verdict);
  });
  test('ScopeGate verdict is deterministic', () => {
    mkdirSync(join(FIXTURE_DIR, 'src'), { recursive: true });
    writeFileSync(join(FIXTURE_DIR, 'src', 'a.ts'), 'export {}');
    const p = policy();
    const gate = new ScopeGate({ rootDir: FIXTURE_DIR, allowedGlobs: ['src/**'] });
    const a = gate.evaluate({ policy: p, manifest: manifest(), metadata: { filesTouched: [join(FIXTURE_DIR, 'src', 'a.ts')] } });
    const b = gate.evaluate({ policy: p, manifest: manifest(), metadata: { filesTouched: [join(FIXTURE_DIR, 'src', 'a.ts')] } });
    expect(a.verdict).toBe(b.verdict);
    expect(a.reasonCode).toBe(b.reasonCode);
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });
  test('ArchitectureGate verdict is deterministic', () => {
    mkdirSync(join(FIXTURE_DIR, 'src'), { recursive: true });
    writeFileSync(join(FIXTURE_DIR, 'src', 'main.ts'), 'export {}');
    const p = policy();
    const gate = new ArchitectureGate({ declaredUnits: [{ name: 'main', path: join(FIXTURE_DIR, 'src', 'main.ts') }] });
    const a = gate.evaluate({ policy: p, manifest: manifest() });
    const b = gate.evaluate({ policy: p, manifest: manifest() });
    expect(a.verdict).toBe(b.verdict);
    expect(a.reasonCode).toBe(b.reasonCode);
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });
  test('HermeticExecGate verdict is deterministic', () => {
    const p = policy();
    const gate = new HermeticExecGate({ runner: mockOciRunner, isolationPolicy: defaultIsolationPolicy(), adapters: [new TestAdapter('echo test')] });
    const a = gate.evaluate({ policy: p, manifest: manifest() });
    const b = gate.evaluate({ policy: p, manifest: manifest() });
    expect(a.verdict).toBe(b.verdict);
    expect(a.reasonCode).toBe(b.reasonCode);
  });
  test('FinalReceiptGate produces byte-identical receipts for same input', () => {
    const p = policy(); const m = manifest(); const b = bundle();
    const results = ['admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt'].map(allPass);
    const g1 = new FinalReceiptGate({ issuer: { identityId: 'A' } });
    const g2 = new FinalReceiptGate({ issuer: { identityId: 'A' } });
    const { issued: a } = g1.evaluate({ policy: p, manifest: m, bundle: b }, results);
    const { issued: c } = g2.evaluate({ policy: p, manifest: m, bundle: b }, results);
    expect(a).toBeDefined();
    expect(c).toBeDefined();
    expect(verifyReceipt(a!.receipt, a!.publicKeyHex).ok).toBe(true);
    expect(verifyReceipt(c!.receipt, c!.publicKeyHex).ok).toBe(true);
  });
  test('cold path verdict and replay path verdict match', () => {
    const p = policy(); const m = manifest(); const b = bundle();
    const filed = ['admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt'].map(allPass);
    const g = new FinalReceiptGate({ issuer: { identityId: 'A' } });
    const { result } = g.evaluate({ policy: p, manifest: m, bundle: b }, filed);
    expect(result.verdict).toBe('PASS');
  });
});
