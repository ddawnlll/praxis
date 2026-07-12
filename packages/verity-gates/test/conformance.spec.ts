// @praxis/verity-gates — Conformance test vectors + harness (#20)
//
// Validates that every protocol type fixture (positive, negative, boundary)
// is accepted or rejected correctly by the schema validators and gates.
// This harness is the reference implementation — Python/other SDKs must
// produce identical verdicts for the same fixtures.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdmissionGate, IntegrityGate, FinalReceiptGate, RecoveryGate, RecoveryStateStore } from '../src';
import { validate } from '@praxis/protocol';
import type { VerificationPolicy, CandidateManifest, EvidenceBundle, ProtocolEnvelope, ProtocolVersion, GateResult } from '@praxis/protocol';

const FIXTURE_DIR = join(import.meta.dir, '..', '..', '..', 'fixtures', 'verity');

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));
}

const POLICY_ID = 'policy-canonical-1';

const VALID_POLICY: VerificationPolicy = {
  schemaVersion: 'praxis-protocol/v1',
  policyId: POLICY_ID,
  blastRadius: 'repo',
  effectClasses: {
    reversible: { allowed: true, requiresCompensationPlan: false, maxSteps: 100 },
    compensable: { allowed: true, requiresCompensationPlan: true, maxSteps: 10 },
    irreversible: { allowed: true, requiresCompensationPlan: true },
  },
  authority: { requiredIdentityId: 'A', humanApprovalRequired: true },
};

const VALID_MANIFEST: CandidateManifest = {
  schemaVersion: 'praxis-protocol/v1',
  candidateId: 'cand-1',
  policyId: POLICY_ID,
  baseHash: 'a'.repeat(64),
  intent: 'test',
  submittedBy: { identityId: 'A', keyId: 'a'.repeat(16) },
  submittedAt: '2026-07-11T00:00:00Z',
  idempotencyKey: 'idem-1',
};

const VALID_BUNDLE: EvidenceBundle = {
  schemaVersion: 'praxis-protocol/v1',
  candidateId: 'cand-1',
  merkleRoot: 'b'.repeat(64),
  attestation: {
    runnerDigest: 'sha256:' + 'c'.repeat(64),
    toolchain: { language: 'TypeScript', compiler: 'tsc', version: '5.9.2' },
  },
  records: [{ recordId: 'r-1', kind: 'command.exit', capturedAt: '2026-07-11T00:00:00Z', payload: { exitCode: 0 } }],
};

// ── Schema-level validation (independent of gates) ──

describe('conformance: schema validation', () => {
  test('positive: candidate-manifest-v1 validates', () => {
    const manifest = loadJson('candidate-manifest-positive.json');
    const r = validate('candidate-manifest-v1', manifest);
    expect(r.ok).toBe(true);
  });

  test('negative: candidate-manifest missing schemaVersion fails', () => {
    const manifest = loadJson('candidate-manifest-negative-missing-version.json');
    const r = validate('candidate-manifest-v1', manifest);
    expect(r.ok).toBe(false);
  });

  test('negative: candidate-manifest bad baseHash fails', () => {
    const manifest = loadJson('candidate-manifest-negative-bad-hash.json');
    const r = validate('candidate-manifest-v1', manifest);
    expect(r.ok).toBe(false);
  });

  test('negative: candidate-manifest missing submittedBy fails', () => {
    const manifest = loadJson('candidate-manifest-negative-missing-submittedBy.json');
    const r = validate('candidate-manifest-v1', manifest);
    expect(r.ok).toBe(false);
  });

  test('positive: evidence-bundle-v1 validates', () => {
    const bundle = loadJson('evidence-bundle-positive.json');
    const r = validate('evidence-bundle-v1', bundle);
    expect(r.ok).toBe(true);
  });

  test('negative: evidence-bundle missing schemaVersion fails', () => {
    const bundle = loadJson('evidence-bundle-negative-missing-version.json');
    const r = validate('evidence-bundle-v1', bundle);
    expect(r.ok).toBe(false);
  });

  test('negative: evidence-bundle bad merkleRoot fails', () => {
    const bundle = loadJson('evidence-bundle-negative-bad-merkle.json');
    const r = validate('evidence-bundle-v1', bundle);
    expect(r.ok).toBe(false);
  });

  test('positive: verification-policy-v1 validates', () => {
    const policy = loadJson('verification-policy-positive.json');
    const r = validate('verification-policy-v1', policy);
    expect(r.ok).toBe(true);
  });

  test('negative: verification-policy missing schemaVersion fails', () => {
    const policy = loadJson('verification-policy-negative-missing-version.json');
    const r = validate('verification-policy-v1', policy);
    expect(r.ok).toBe(false);
  });

  test('negative: verification-policy invalid blastRadius fails', () => {
    const policy = loadJson('verification-policy-negative-invalid-blast-radius.json');
    const r = validate('verification-policy-v1', policy);
    expect(r.ok).toBe(false);
  });

  test('negative: verification-policy missing blastRadius fails', () => {
    const policy = loadJson('verification-policy-negative-missing-blast-radius.json');
    const r = validate('verification-policy-v1', policy);
    expect(r.ok).toBe(false);
  });

  test('positive: protocol-v1 (envelope) validates', () => {
    const envelope = loadJson('protocol-envelope-positive.json');
    const r = validate('protocol-v1', envelope);
    expect(r.ok).toBe(true);
  });

  test('negative: protocol-envelope missing schemaVersion fails', () => {
    const envelope = loadJson('protocol-envelope-negative-missing-version.json');
    const r = validate('protocol-v1', envelope);
    expect(r.ok).toBe(false);
  });

  test('negative: protocol-envelope wrong version fails', () => {
    const envelope = loadJson('protocol-envelope-negative-wrong-version.json');
    const r = validate('protocol-v1', envelope);
    expect(r.ok).toBe(false);
  });

  test('negative: protocol-envelope additional properties fails', () => {
    const envelope = loadJson('protocol-envelope-negative-additional-properties.json');
    const r = validate('protocol-v1', envelope);
    expect(r.ok).toBe(false);
  });

  test('negative: protocol-envelope missing sender fails', () => {
    const envelope = loadJson('protocol-envelope-negative-missing-sender.json');
    const r = validate('protocol-v1', envelope);
    expect(r.ok).toBe(false);
  });
});

// ── Gate-level validation (fixtures wired into gate evaluate) ──

describe('conformance: AdmissionGate with fixtures', () => {
  test('positive: valid envelope + manifest passes', () => {
    const envelope = loadJson('protocol-envelope-positive.json') as ProtocolEnvelope;
    const gate = new AdmissionGate();
    const result = gate.evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST, envelope });
    expect(result.verdict).toBe('PASS');
    expect(result.gate).toBe('admission');
  });

  test('negative: wrong envelope version FAILs', () => {
    const envelope = loadJson('protocol-envelope-negative-wrong-version.json') as ProtocolEnvelope;
    const gate = new AdmissionGate();
    const result = gate.evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST, envelope });
    expect(result.verdict).toBe('FAIL');
  });

  test('negative: missing-envelope manifest still checked via schema', () => {
    const manifest = loadJson('candidate-manifest-negative-missing-version.json') as CandidateManifest;
    const gate = new AdmissionGate();
    const result = gate.evaluate({ policy: VALID_POLICY, manifest });
    expect(result.verdict).toBe('FAIL');
  });

  test('negative: bad baseHash FAILs', () => {
    const manifest = loadJson('candidate-manifest-negative-bad-hash.json') as CandidateManifest;
    const gate = new AdmissionGate();
    const result = gate.evaluate({ policy: VALID_POLICY, manifest });
    expect(result.verdict).toBe('FAIL');
  });
});

describe('conformance: IntegrityGate with fixtures', () => {
  test('positive: valid bundle passes', () => {
    const bundle = loadJson('evidence-bundle-positive.json') as EvidenceBundle;
    const gate = new IntegrityGate();
    const result = gate.evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST, bundle });
    expect(result.verdict).toBe('PASS');
    expect(result.gate).toBe('integrity');
  });

  test('negative: missing schemaVersion FAILs', () => {
    const bundle = loadJson('evidence-bundle-negative-missing-version.json') as EvidenceBundle;
    const gate = new IntegrityGate();
    const result = gate.evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST, bundle });
    expect(result.verdict).toBe('FAIL');
  });

  test('negative: bad merkleRoot FAILs', () => {
    const bundle = loadJson('evidence-bundle-negative-bad-merkle.json') as EvidenceBundle;
    const gate = new IntegrityGate();
    const result = gate.evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST, bundle });
    expect(result.verdict).toBe('FAIL');
  });
});

// ── Cross-gate consistency ──

describe('conformance: cross-gate consistency', () => {
  test('all gates produce typed gate name in result', () => {
    const results: GateResult[] = [
      new AdmissionGate().evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST }),
      new IntegrityGate().evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST, bundle: VALID_BUNDLE }),
      new RecoveryGate(new RecoveryStateStore()).evaluate({ policy: VALID_POLICY, manifest: { ...VALID_MANIFEST, idempotencyKey: 'x' } }),
    ];
    const expectedNames = ['admission', 'integrity', 'recovery'];
    for (let i = 0; i < results.length; i++) {
      expect(results[i].gate).toBe(expectedNames[i]);
      expect(typeof results[i].reasonCode).toBe('string');
      expect(typeof results[i].producedAt).toBe('string');
    }
  });

  test('PASS verdict has non-empty reasonCode', () => {
    const result = new AdmissionGate().evaluate({ policy: VALID_POLICY, manifest: VALID_MANIFEST });
    if (result.verdict === 'PASS') {
      expect(result.reasonCode.length).toBeGreaterThan(0);
    }
  });
});

// ── Canonical determinism ──

describe('conformance: canonical determinism', () => {
  test('10 identical AdmissionGate inputs produce identical results', () => {
    const gate = new AdmissionGate();
    const inputs = { policy: VALID_POLICY, manifest: VALID_MANIFEST };
    const results: GateResult[] = [];
    for (let i = 0; i < 10; i++) results.push(gate.evaluate(inputs));
    for (let i = 1; i < results.length; i++) {
      expect(results[i].verdict).toBe(results[0].verdict);
      expect(results[i].reasonCode).toBe(results[0].reasonCode);
      expect(results[i].gate).toBe(results[0].gate);
    }
  });

  test('10 identical IntegrityGate inputs produce identical results', () => {
    const gate = new IntegrityGate();
    const inputs = { policy: VALID_POLICY, manifest: VALID_MANIFEST, bundle: VALID_BUNDLE };
    const results: GateResult[] = [];
    for (let i = 0; i < 10; i++) results.push(gate.evaluate(inputs));
    for (let i = 1; i < results.length; i++) {
      expect(results[i].verdict).toBe(results[0].verdict);
      expect(results[i].reasonCode).toBe(results[0].reasonCode);
    }
  });
});
