// @praxis/verity-gates — shared gate types and helpers

import type { GateName, GateResult, Verdict, VerificationPolicy, CandidateManifest, EvidenceBundle, ProtocolEnvelope } from '@praxis/protocol';
import { canonicalize, domainHashHex } from '@praxis/protocol';

export type { GateName, GateResult, Verdict } from '@praxis/protocol';

export interface GateContext {
  policy: VerificationPolicy;
  manifest: CandidateManifest;
  bundle?: EvidenceBundle;
  envelope?: ProtocolEnvelope;
  // Optional: extra metadata that gates may inspect.
  metadata?: Record<string, unknown>;
}

export interface Gate {
  readonly name: GateName;
  evaluate(ctx: GateContext): GateResult;
}

/** Deterministic result builder. */
export function makeResult(
  name: GateName,
  verdict: Verdict,
  reasonCode: string,
  producedAt: string = new Date().toISOString()
): GateResult {
  return { gate: name, verdict, reasonCode, producedAt };
}

/** Stable hash of a gate's verdict for cross-gate tying. */
export function gateResultHash(r: GateResult): string {
  return domainHashHex('praxis-gate-result/v1', canonicalize(r as unknown as Record<string, unknown> as unknown as JsonValue));
}

/** Aggregate verdicts: only PASS when every required verdict is PASS. */
export function aggregate(results: GateResult[], required: GateName[]): Verdict {
  if (results.length === 0) return 'FAIL';
  const byName = new Map(results.map((r) => [r.gate, r]));
  // FAIL anywhere → FAIL
  if (results.some((r) => r.verdict === 'FAIL')) return 'FAIL';
  // HOLD on a required gate → HOLD (not PASS)
  for (const n of required) {
    const r = byName.get(n);
    if (r && r.verdict === 'HOLD') return 'HOLD';
  }
  // Any HOLD anywhere → HOLD
  if (results.some((r) => r.verdict === 'HOLD')) return 'HOLD';
  for (const n of required) {
    if (!byName.get(n)) return 'FAIL';
  }
  return 'PASS';
}
