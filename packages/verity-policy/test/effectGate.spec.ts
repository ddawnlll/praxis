// @praxis/verity-policy — EffectGate and Hephaestus v0.6 tests

import { describe, test, expect } from 'bun:test';
import { hepheastusV06, EffectGate, type EffectRequest } from '../src/effectGate';
import type { VerificationPolicy } from '@praxis/protocol';

const policy: VerificationPolicy = {
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

function req(effectClass: EffectRequest['effectClass'], overrides: Partial<EffectRequest> = {}): EffectRequest {
  return { effectClass, description: 'test', steps: 1, ...overrides };
}

describe('hepheastusV06 policy pack', () => {
  test('reversible effect without compensation plan: PASS (no human needed)', () => {
    const d = hepheastusV06.decide(req('reversible'), policy);
    expect(d.allowed).toBe(true);
    expect(d.requiresHumanApproval).toBe(false);
  });
  test('compensable effect without plan: FAIL', () => {
    const d = hepheastusV06.decide(req('compensable'), policy);
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('POLICY_COMPENSATION_PLAN_REQUIRED');
  });
  test('compensable effect with plan: PASS', () => {
    const d = hepheastusV06.decide(req('compensable', { compensationPlan: 'undo by reverting commit' }), policy);
    expect(d.allowed).toBe(true);
  });
  test('irreversible without human approval: FAIL', () => {
    const d = hepheastusV06.decide(req('irreversible', { compensationPlan: 'snapshot before deploy' }), policy);
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('POLICY_HUMAN_APPROVAL_REQUIRED');
  });
  test('irreversible with human approval: PASS', () => {
    const d = hepheastusV06.decide(req('irreversible', { compensationPlan: 'snapshot', humanApproved: true }), policy);
    expect(d.allowed).toBe(true);
  });
  test('maxSteps exceeded: FAIL', () => {
    const d = hepheastusV06.decide(req('compensable', { compensationPlan: 'plan', steps: 100, humanApproved: true }), policy);
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('POLICY_MAX_STEPS_EXCEEDED');
  });
  test('class disallowed: FAIL', () => {
    const p: VerificationPolicy = { ...policy, effectClasses: { ...policy.effectClasses, irreversible: { allowed: false, requiresCompensationPlan: true } } };
    const d = hepheastusV06.decide(req('irreversible', { compensationPlan: 'plan', humanApproved: true }), p);
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe('POLICY_EFFECT_DISALLOWED:irreversible');
  });
});

describe('EffectGate', () => {
  test('no effects → PASS', () => {
    const g = new EffectGate();
    const r = g.evaluate({ policy, manifest: {} as any });
    expect(r.verdict).toBe('PASS');
    expect(r.reasonCode).toBe('EFFECT_NONE_DECLARED');
  });
  test('all allowed effects → PASS', () => {
    const g = new EffectGate(hepheastusV06, [
      req('reversible'),
      req('compensable', { compensationPlan: 'plan' }),
      req('irreversible', { compensationPlan: 'snapshot', humanApproved: true }),
    ]);
    const r = g.evaluate({ policy, manifest: {} as any });
    expect(r.verdict).toBe('PASS');
    expect(r.reasonCode).toMatch(/^EFFECT_OK:hepheastus@/);
  });
  test('one denied effect → FAIL with that reason', () => {
    const g = new EffectGate(hepheastusV06, [req('irreversible', { compensationPlan: 'snapshot' })]);
    const r = g.evaluate({ policy, manifest: {} as any });
    expect(r.verdict).toBe('FAIL');
    expect(r.reasonCode).toBe('POLICY_HUMAN_APPROVAL_REQUIRED');
  });
  test('setEffects replaces the effect set', () => {
    const g = new EffectGate();
    g.setEffects([req('reversible')]);
    expect(g.evaluate({ policy, manifest: {} as any }).verdict).toBe('PASS');
    g.setEffects([req('irreversible')]);
    expect(g.evaluate({ policy, manifest: {} as any }).verdict).toBe('FAIL');
  });
  test('fingerprint is deterministic and changes when decisions change', () => {
    const g1 = new EffectGate(hepheastusV06, [req('reversible')]);
    const f1 = g1.fingerprint({ policy, manifest: {} as any });
    const f2 = g1.fingerprint({ policy, manifest: {} as any });
    expect(f1).toBe(f2);
    const g2 = new EffectGate(hepheastusV06, [req('compensable', { compensationPlan: 'plan' })]);
    const f3 = g2.fingerprint({ policy, manifest: {} as any });
    expect(f1).not.toBe(f3);
  });
});
