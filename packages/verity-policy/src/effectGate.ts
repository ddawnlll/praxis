// @praxis/verity-policy — EffectGate and policy framework (#23, #30)

import type { GateContext, GateResult } from '@praxis/verity-gates';
import { makeResult } from '@praxis/verity-gates';
import { canonicalize, domainHashHex, type EffectRule, type GateName, type VerificationPolicy } from '@praxis/protocol';

export type EffectClass = 'reversible' | 'compensable' | 'irreversible';

export interface EffectRequest {
  effectClass: EffectClass;
  description: string;
  compensationPlan?: string;
  steps: number;
  /** Set to true iff a human has approved the request. */
  humanApproved?: boolean;
}

export interface PolicyPack {
  /** Stable pack name. Bound into receipts. */
  name: string;
  /** Pack version. Bound into receipts. */
  version: string;
  /**
   * Decide whether a single effect request is allowed by this policy pack.
   * Returns a structured decision; gate-level logic composes the per-effect
   * decisions into a single GateResult.
   */
  decide(req: EffectRequest, policy: VerificationPolicy): EffectDecision;
}

export interface EffectDecision {
  effectClass: EffectClass;
  allowed: boolean;
  reasonCode: string;
  requiresHumanApproval: boolean;
  humanApproved: boolean;
}

/** Hephaestus v0.6 default policy pack. Maps to the v0.6 invariants. */
export const hepheastusV06: PolicyPack = {
  name: 'hepheastus',
  version: '0.6.0',
  decide(req, policy) {
    const rule: EffectRule = policy.effectClasses[req.effectClass];
    if (!rule || !rule.allowed) {
      return {
        effectClass: req.effectClass,
        allowed: false,
        reasonCode: `POLICY_EFFECT_DISALLOWED:${req.effectClass}`,
        requiresHumanApproval: true,
        humanApproved: false,
      };
    }
    if (rule.requiresCompensationPlan && !req.compensationPlan) {
      return {
        effectClass: req.effectClass,
        allowed: false,
        reasonCode: 'POLICY_COMPENSATION_PLAN_REQUIRED',
        requiresHumanApproval: true,
        humanApproved: !!req.humanApproved,
      };
    }
    if (rule.maxSteps !== undefined && rule.maxSteps !== null && req.steps > rule.maxSteps) {
      return {
        effectClass: req.effectClass,
        allowed: false,
        reasonCode: 'POLICY_MAX_STEPS_EXCEEDED',
        requiresHumanApproval: true,
        humanApproved: !!req.humanApproved,
      };
    }
    // Human approval gate: irreversible ALWAYS requires human. Other
    // classes only require human approval if explicitly flagged in the
    // policy's effect rule. The policy.authority.humanApprovalRequired
    // flag is a default for IRREVERSIBLE specifically, not for all classes.
    const requiresHuman = req.effectClass === 'irreversible' || rule.requiresHumanApproval === true;
    if (requiresHuman && !req.humanApproved) {
      return {
        effectClass: req.effectClass,
        allowed: false,
        reasonCode: 'POLICY_HUMAN_APPROVAL_REQUIRED',
        requiresHumanApproval: true,
        humanApproved: false,
      };
    }
    return {
      effectClass: req.effectClass,
      allowed: true,
      reasonCode: 'POLICY_OK',
      requiresHumanApproval: requiresHuman,
      humanApproved: !!req.humanApproved,
    };
  },
};

export class EffectGate {
  readonly name: GateName = 'effect';
  constructor(private readonly pack: PolicyPack = hepheastusV06, private readonly effects: EffectRequest[] = []) {}

  /** Replace the effect set (e.g., from a plan). */
  setEffects(effects: EffectRequest[]): void {
    (this as { effects: EffectRequest[] }).effects = effects;
  }

  evaluate(ctx: GateContext): GateResult {
    const at = new Date().toISOString();
    if (this.effects.length === 0) {
      return makeResult(this.name, 'PASS', 'EFFECT_NONE_DECLARED', at);
    }
    const decisions = this.effects.map((e) => this.pack.decide(e, ctx.policy));
    if (decisions.some((d) => !d.allowed)) {
      const first = decisions.find((d) => !d.allowed)!;
      return makeResult(this.name, 'FAIL', first.reasonCode, at);
    }
    return makeResult(this.name, 'PASS', `EFFECT_OK:${this.pack.name}@${this.pack.version}`, at);
  }

  /** Hash of (pack, policy, decisions) — bound into receipts. */
  fingerprint(ctx: GateContext): string {
    const decisions = this.effects.map((e) => this.pack.decide(e, ctx.policy));
    return domainHashHex(
      'praxis-effect-policy/v1',
      canonicalize({
        pack: { name: this.pack.name, version: this.pack.version },
        policyId: ctx.policy.policyId,
        decisions,
      } as unknown as JsonValue)
    );
  }
}
