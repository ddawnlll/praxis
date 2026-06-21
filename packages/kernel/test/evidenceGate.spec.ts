// @praxis/kernel — EvidenceGate Tests
// Tests for EvidenceGate PASS/HOLD/FAIL verdicts.

import { describe, test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { runEvidenceGate } from '../src/gates/evidenceGate';
import { readEvidenceLedgerJsonl } from '../src/evidence/readEvidenceLedgerJsonl';
import { EVIDENCE_REASON_CODES } from '../src/diagnostics';
import { type EvidenceRecordV01, EVIDENCE_VERSION_V01 } from '../src/evidence/types';
import { loadPlanSpecYaml, type PlanSpecV01 } from '@praxis/contracts';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const FIXTURES = resolve(REPO_ROOT, 'fixtures/kernel/p3');
const PLAN_PATH = resolve(FIXTURES, 'evidencegate-test.plan.yaml');

function loadPlan(): PlanSpecV01 {
  const result = loadPlanSpecYaml(PLAN_PATH, REPO_ROOT);
  if (!result.ok || !result.plan) throw new Error('Failed to load test plan');
  return result.plan;
}

function makeRecord(overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: EVIDENCE_VERSION_V01,
    recordId: `EV-${Math.random().toString(36).slice(2, 10)}`,
    attemptId: 'p3-test-001',
    planId: 'PRAXIS-P3-TEST-001',
    timestamp: '2026-06-20T10:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

function fakeHashes() {
  return {
    planHash: 'a'.repeat(64),
    acceptanceCriteriaHash: 'b'.repeat(64),
    artifactPolicyHash: 'c'.repeat(64),
    integrationContractHash: 'd'.repeat(64),
    commandPolicyHash: 'e'.repeat(64),
    allowedFilesHash: 'f'.repeat(64),
    forbiddenFilesHash: 'g'.repeat(64),
  };
}

// =========================================================
// EvidenceGate PASS
// =========================================================
describe('EvidenceGate PASS', () => {
  test('PASS with valid ledger, matching IDs, allowed changed files, required evidence', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-pass-001', type: 'diff', criterionId: 'AC-01', taskId: 'task-01', source: 'kernel' }),
      makeRecord({ recordId: 'EV-pass-002', type: 'test_output', criterionId: 'AC-02', taskId: 'task-01', source: 'test' }),
    ];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
      changedFiles: [{ path: 'src/feature.ts', status: 'added' }],
    });

    expect(result.verdict).toBe('PASS');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.EVIDENCE_PASS);
  });
});

// =========================================================
// EvidenceGate HOLD
// =========================================================
describe('EvidenceGate HOLD', () => {
  test('HOLD when evidenceRecords empty and plan expects implementation', () => {
    const plan = loadPlan();

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: [],
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.EVIDENCE_LEDGER_MISSING);
  });

  test('HOLD when changedFiles empty for implementation plan', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-hold-001', type: 'source', source: 'agent_claim', criterionId: 'AC-01' }),
    ];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
      changedFiles: [],
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.DIFF_EMPTY);
  });

  test('HOLD when required evidence type missing', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-hold-002', type: 'diff', criterionId: 'AC-01', taskId: 'task-01', source: 'kernel' }),
    ];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
      changedFiles: [{ path: 'src/feature.ts', status: 'added' }],
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.REQUIRED_EVIDENCE_TYPE_MISSING);
  });

  test('HOLD when evidence is agent_claim-only for deterministic requirement', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-hold-003', type: 'diff', criterionId: 'AC-01', taskId: 'task-01', source: 'agent_claim' }),
      makeRecord({ recordId: 'EV-hold-004', type: 'test_output', criterionId: 'AC-02', taskId: 'task-01', source: 'agent_claim' }),
    ];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
      changedFiles: [{ path: 'src/feature.ts', status: 'added' }],
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.DETERMINISTIC_EVIDENCE_MISSING);
  });
});

// =========================================================
// EvidenceGate FAIL
// =========================================================
describe('EvidenceGate FAIL', () => {
  test('FAIL with malformed ledger via path', () => {
    const plan = loadPlan();
    const ledgerPath = resolve(FIXTURES, 'evidencegate-malformed-ledger.evidence.jsonl');

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceLedgerPath: ledgerPath,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.EVIDENCE_LEDGER_PARSE_ERROR);
  });

  test('FAIL when attemptId mismatches', () => {
    const plan = loadPlan();
    const records = [makeRecord({ attemptId: 'wrong-attempt-id' })];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.ATTEMPT_ID_MISMATCH);
  });

  test('FAIL when forbidden file changed', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-fail-001', type: 'diff', criterionId: 'AC-01', taskId: 'task-01', source: 'kernel' }),
    ];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
      changedFiles: [{ path: 'package.json', status: 'modified' }],
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.FORBIDDEN_FILE_CHANGED);
  });

  test('FAIL when changed file outside allowedFiles', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-fail-003', type: 'diff', criterionId: 'AC-01', taskId: 'task-01', source: 'kernel' }),
    ];

    // Use a path that's outside allowedFiles but NOT in forbiddenFiles
    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
      changedFiles: [{ path: 'outside/some-random-file.ts', status: 'modified' }],
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.CHANGED_FILE_OUTSIDE_ALLOWED_FILES);
  });

  test('FAIL when evidence references unknown criterionId', () => {
    const plan = loadPlan();
    const records = [makeRecord({ criterionId: 'AC-NONEXISTENT' })];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.UNKNOWN_CRITERION_ID);
  });

  test('FAIL when divergence record present', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-div-001', type: 'divergence_file', source: 'hook', taskId: 'task-01' }),
    ];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.DIVERGENCE_DETECTED);
  });

  test('FAIL when unsupported evidence type used', () => {
    const plan = loadPlan();
    const records = [makeRecord({ type: 'wiring' as any, criterionId: 'AC-01' })];

    const result = runEvidenceGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'p3-test-001',
      evidenceRecords: records,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(EVIDENCE_REASON_CODES.UNSUPPORTED_EVIDENCE_TYPE);
  });
});
