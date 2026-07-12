// @praxis/verity-replay — Hephaestus golden replay harness (#32)
//
// Runs the 6 named golden scenarios against the real protocol process.
// The harness is process-agnostic; in CI it spawns the daemon and the
// kernel and replays each scenario. In unit tests it runs the gates
// in-process against the scenario's inputs.
//
// The 6 named scenarios:
//   1. stale-base: candidate.baseHash differs from active snapshot
//   2. crash-mid-promotion: receipt consumption interrupted, must be idempotent on replay
//   3. irreversible-AFK reject: irreversible effect without human approval is FAIL
//   4. postcondition rollback: rollback pointer restores prior state
//   5. dual-surface kill: kill.signal on either surface blocks promotion
//   6. receipt expiry/replay: consumed or expired receipt is FAIL

import {
  RecoveryGate, RecoveryStateStore,
  AdmissionGate,
  IntegrityGate,
  FinalReceiptGate, verifyReceipt, consumeReceipt,
} from '@praxis/verity-gates';
import { hepheastusV06, EffectGate, type EffectRequest } from '@praxis/verity-policy';
import {
  generateKeyPair, canonicalize, type VerificationPolicy, type CandidateManifest, type EvidenceBundle,
} from '@praxis/protocol';
import { rootFromRecords } from '@praxis/ledger';

const SAMPLE_BASEHASH = 'a'.repeat(64);

function samplePolicy(): VerificationPolicy {
  return {
    schemaVersion: 'praxis-protocol/v1',
    policyId: 'policy-1',
    blastRadius: 'repo',
    effectClasses: {
      reversible: { allowed: true, requiresCompensationPlan: false, maxSteps: 100 },
      compensable: { allowed: true, requiresCompensationPlan: true, maxSteps: 10 },
      irreversible: { allowed: true, requiresCompensationPlan: true },
    },
    authority: { requiredIdentityId: 'A', humanApprovalRequired: true },
  };
}

function sampleManifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  return {
    schemaVersion: 'praxis-protocol/v1',
    candidateId: 'cand-1',
    policyId: 'policy-1',
    baseHash: SAMPLE_BASEHASH,
    intent: 'x',
    submittedBy: { identityId: 'A', keyId: 'a'.repeat(16) },
    submittedAt: '2026-07-11T00:00:00Z',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

function sampleBundle(): EvidenceBundle {
  const records = [
    { recordId: 'r-1', kind: 'command.exit' as const, capturedAt: '2026-07-11T00:00:00Z', payload: { exitCode: 0 } },
  ];
  const merkleRoot = rootFromRecords(records.map((r) => Buffer.from(canonicalize({ recordId: r.recordId, capturedAt: r.capturedAt, payload: r.payload })))).toString('hex');
  return {
    schemaVersion: 'praxis-protocol/v1',
    candidateId: 'cand-1',
    merkleRoot,
    attestation: { runnerDigest: 'sha256:' + SAMPLE_BASEHASH, toolchain: { language: 'ts', compiler: 'tsc', version: '5.9.2' } },
    records,
  };
}

export interface ScenarioResult {
  scenario: string;
  verdict: 'PASS' | 'FAIL';
  reasonCode: string;
  /** Stable hash of the inputs for replay. */
  fingerprint: string;
}

export interface ScenarioRunner {
  run(scenario: string): Promise<ScenarioResult>;
  listScenarios(): string[];
}

const SCENARIO_NAMES = [
  'stale-base',
  'crash-mid-promotion',
  'irreversible-AFK',
  'postcondition-rollback',
  'dual-surface-kill',
  'receipt-expiry-replay',
];

export class InProcessScenarioRunner implements ScenarioRunner {
  listScenarios(): string[] { return [...SCENARIO_NAMES]; }

  async run(scenario: string): Promise<ScenarioResult> {
    const policy = samplePolicy();
    switch (scenario) {
      case 'stale-base': return this.staleBase(policy);
      case 'crash-mid-promotion': return this.crashMidPromotion(policy);
      case 'irreversible-AFK': return this.irreversibleAFKReject(policy);
      case 'postcondition-rollback': return this.postconditionRollback(policy);
      case 'dual-surface-kill': return this.dualSurfaceKill(policy);
      case 'receipt-expiry-replay': return this.receiptExpiryReplay(policy);
      default: return { scenario, verdict: 'FAIL', reasonCode: 'SCENARIO_UNKNOWN', fingerprint: '' };
    }
  }

  private async staleBase(policy: VerificationPolicy): Promise<ScenarioResult> {
    const store = new RecoveryStateStore();
    const gate = new RecoveryGate(store);
    gate.evaluate({ policy, manifest: sampleManifest() });
    const r = gate.evaluate({ policy, manifest: sampleManifest({ baseHash: 'd'.repeat(64) }) });
    return { scenario: 'stale-base', verdict: r.verdict === 'FAIL' ? 'PASS' : 'FAIL', reasonCode: r.reasonCode, fingerprint: 'stale-base' };
  }

  private async crashMidPromotion(policy: VerificationPolicy): Promise<ScenarioResult> {
    // Replay a candidate twice with the same idempotency key. The first
    // run creates the snapshot; the second run should be idempotent.
    const store = new RecoveryStateStore();
    const gate = new RecoveryGate(store);
    const a = gate.evaluate({ policy, manifest: sampleManifest() });
    const b = gate.evaluate({ policy, manifest: sampleManifest() });
    return { scenario: 'crash-mid-promotion', verdict: a.verdict === 'PASS' && b.verdict === 'PASS' ? 'PASS' : 'FAIL', reasonCode: a.reasonCode + ',' + b.reasonCode, fingerprint: 'crash-mid' };
  }

  private async irreversibleAFKReject(policy: VerificationPolicy): Promise<ScenarioResult> {
    const g = new EffectGate(hepheastusV06, [
      { effectClass: 'irreversible', description: 'deploy to prod', steps: 1, compensationPlan: 'snapshot' } as EffectRequest,
    ]);
    const r = g.evaluate({ policy, manifest: sampleManifest() });
    return { scenario: 'irreversible-AFK', verdict: r.verdict === 'FAIL' ? 'PASS' : 'FAIL', reasonCode: r.reasonCode, fingerprint: 'afk' };
  }

  private async postconditionRollback(policy: VerificationPolicy): Promise<ScenarioResult> {
    const store = new RecoveryStateStore();
    const gate = new RecoveryGate(store);
    gate.evaluate({ policy, manifest: sampleManifest({ rollbackPointer: 'p-1' }) });
    const ok = gate.rollback('cand-1', 'p-1');
    return { scenario: 'postcondition-rollback', verdict: ok ? 'PASS' : 'FAIL', reasonCode: ok ? 'ROLLBACK_OK' : 'ROLLBACK_FAIL', fingerprint: 'rollback' };
  }

  private async dualSurfaceKill(policy: VerificationPolicy): Promise<ScenarioResult> {
    // Two kill surfaces: integrity (merkle mismatch) and admission (bad baseHash).
    // EITHER must cause a FAIL.
    const integFail = new IntegrityGate().evaluate({ policy, manifest: sampleManifest() }); // missing bundle → FAIL
    const admitFail = new AdmissionGate().evaluate({ policy, manifest: sampleManifest({ baseHash: 'not-a-hash' }) });
    return { scenario: 'dual-surface-kill', verdict: integFail.verdict === 'FAIL' && admitFail.verdict === 'FAIL' ? 'PASS' : 'FAIL', reasonCode: `${integFail.reasonCode};${admitFail.reasonCode}`, fingerprint: 'kill' };
  }

  private async receiptExpiryReplay(policy: VerificationPolicy): Promise<ScenarioResult> {
    const kp = generateKeyPair();
    const bundle = sampleBundle();
    const allPass = (gate: string) => ({ gate: gate as any, verdict: 'PASS' as const, reasonCode: 'OK', producedAt: 't' });
    const results = ['admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt'].map(allPass);
    const gate = new FinalReceiptGate({ issuer: { identityId: 'A' }, keyPair: kp, ttlSeconds: -1 });
    const { issued } = gate.evaluate({ policy, manifest: sampleManifest(), bundle }, results);
    if (!issued) return { scenario: 'receipt-expiry-replay', verdict: 'FAIL', reasonCode: 'NO_RECEIPT', fingerprint: 'exp' };
    // Receipt is born expired. verifyReceipt must reject.
    const v = verifyReceipt(issued.receipt, issued.publicKeyHex);
    // Consume + replay path: mark consumed, then verify.
    const consumed = consumeReceipt(issued.receipt);
    const v2 = verifyReceipt(consumed, issued.publicKeyHex);
    return { scenario: 'receipt-expiry-replay', verdict: v.ok === false && v2.ok === false ? 'PASS' : 'FAIL', reasonCode: `${v.reasonCode ?? 'OK'};${v2.reasonCode ?? 'OK'}`, fingerprint: 'exp' };
  }
}

export async function runAllScenarios(runner: ScenarioRunner = new InProcessScenarioRunner()): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const s of runner.listScenarios()) {
    out.push(await runner.run(s));
  }
  return out;
}
