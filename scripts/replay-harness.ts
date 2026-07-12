#!/usr/bin/env bun
// 300K adversarial replay harness (issue #35, AC-1).
//
// Runs the fuzzer N times and writes a durable aggregate to stdout (or to
// the path given as argv[2]). Used by .github/workflows/verity-ci.yml to
// produce the replayArtifact that the fail-closed release gate reads.

import { fuzzGate, seedHash, writeArtifact } from '@praxis/verity-qual';
import { canonicalize, validate, domainHashHex, type ProtocolEnvelope, type ProtocolVersion, type JsonValue } from '@praxis/protocol';
import { AdmissionGate, IntegrityGate, FinalReceiptGate } from '@praxis/verity-gates';
import { rootFromRecords } from '@praxis/ledger';
import { createHash } from 'node:crypto';

const ITER = Number(process.argv[2] ?? 300000);
const OUT = process.argv[3] ?? '/dev/stdout';

const SAMPLE_BASEHASH = 'a'.repeat(64);

function sampleManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'praxis-protocol/v1' as ProtocolVersion,
    candidateId: 'cand-1',
    policyId: 'p-1',
    baseHash: SAMPLE_BASEHASH,
    intent: 'x',
    submittedBy: { identityId: 'A', keyId: 'a'.repeat(16) },
    submittedAt: '2026-07-11T00:00:00Z',
    ...overrides,
  };
}
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

// The replay runs the gates in sequence on randomized inputs and asserts
// determinism. Each iteration produces a verdict from each gate; the
// replay is "false-PASS-free" iff no input produces a final PASS that
// any second-run gate would reject.
const adm = new AdmissionGate();
const integ = new IntegrityGate();
const allPass = (gate: string) => ({ gate: gate as any, verdict: 'PASS' as const, reasonCode: 'OK', producedAt: 't' });
const frg = new FinalReceiptGate({ issuer: { identityId: 'A' } });

const stats = fuzzGate('replay-300k', {
  seed: 1,
  iterations: ITER,
  runOnce: (input) => {
    // Drive the Admission + Integrity gates on the randomized input.
    // Both must produce a stable verdict; the final aggregate verdict
    // is the input's worst verdict.
    const a = adm.evaluate({ policy: samplePolicy(), manifest: input as any });
    let worst: 'PASS' | 'HOLD' | 'FAIL' = 'PASS';
    if (a.verdict === 'FAIL') worst = 'FAIL';
    if (a.verdict === 'HOLD') worst = 'HOLD';
    // Try integrity too if a candidateId+baseHash look shape-able.
    if (typeof (input as Record<string, unknown>).candidateId === 'string') {
      const i = integ.evaluate({ policy: samplePolicy(), manifest: input as any, bundle: sampleBundle() });
      if (i.verdict === 'FAIL') worst = 'FAIL';
    }
    return { verdict: worst };
  },
});

const fp = createHash('sha256').update(JSON.stringify(stats)).digest('hex');

const aggregate = {
  iterations: stats.total,
  falsePass: stats.falsePass,
  crashes: stats.crashes,
  determinismViolations: stats.determinismViolations,
  durationMs: stats.durationMs,
  seed: stats.seed,
  seedHash: seedHash(stats.seed, stats.total),
  fingerprint: fp,
};

if (OUT === '/dev/stdout') {
  console.log(JSON.stringify(aggregate, null, 2));
} else {
  await writeArtifact(OUT, aggregate);
  console.error(`wrote ${OUT}: ${fp}`);
}

// Fail-closed: any false PASS is a release blocker.
if (aggregate.falsePass > 0) {
  console.error(`FAIL: replay found ${aggregate.falsePass} false-PASS instances`);
  process.exit(1);
}
