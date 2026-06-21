// @praxis/kernel — P3 Kernel Pipeline Tests
// Tests for runP3Kernel: SchemaGate → LockGate → EvidenceGate pipeline.

import { describe, test, expect } from 'bun:test';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { runP3Kernel } from '../src/runP3Kernel';
import { type EvidenceRecordV01, EVIDENCE_VERSION_V01 } from '../src/evidence/types';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const FIXTURES = resolve(REPO_ROOT, 'fixtures/kernel/p3');
const PLAN_PATH = resolve(FIXTURES, 'evidencegate-test.plan.yaml');
const TMP_LOCK = resolve(REPO_ROOT, '.praxis/test-p3-planspec.lock');

function loadYaml(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf-8');
}

function makeRecord(overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: EVIDENCE_VERSION_V01,
    recordId: `EV-p3-${Math.random().toString(36).slice(2, 8)}`,
    attemptId: 'p3-kernel-test',
    planId: 'PRAXIS-P3-TEST-001',
    timestamp: '2026-06-20T10:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

// Clean up stale test locks before each test
function cleanTmpLock() {
  try { if (existsSync(TMP_LOCK)) unlinkSync(TMP_LOCK); } catch {}
}

describe('runP3Kernel', () => {
  test('runs SchemaGate → LockGate → EvidenceGate on valid plan with evidence', () => {
    cleanTmpLock();
    const yaml = loadYaml('fixtures/kernel/p3/evidencegate-test.plan.yaml');
    const records = [
      makeRecord({ recordId: 'EV-p3-001', type: 'diff', criterionId: 'AC-01', taskId: 'task-01' }),
      makeRecord({ recordId: 'EV-p3-002', type: 'test_output', criterionId: 'AC-02', taskId: 'task-01', source: 'test' }),
    ];

    const result = runP3Kernel({
      planYaml: yaml,
      repoRoot: REPO_ROOT,
      attemptId: 'p3-kernel-test',
      lockPath: TMP_LOCK,
      lockMode: 'create_if_missing',
      evidenceRecords: records,
      changedFiles: [{ path: 'src/feature.ts', status: 'added' }],
    });

    expect(result.gateVerdicts.length).toBe(3);
    expect(result.gateVerdicts[0].gateName).toBe('SchemaGate');
    expect(result.gateVerdicts[1].gateName).toBe('LockGate');
    expect(result.gateVerdicts[2].gateName).toBe('EvidenceGate');

    expect(result.plan).toBeDefined();
    expect(result.hashes).toBeDefined();

    cleanTmpLock();
  });

  test('stops on SchemaGate FAIL', () => {
    const result = runP3Kernel({
      planYaml: '{{{ definitely invalid yaml :::',
      repoRoot: REPO_ROOT,
      attemptId: 'p3-fail-test',
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.gateVerdicts.length).toBe(1);
    expect(result.gateVerdicts[0].gateName).toBe('SchemaGate');
  });

  test('stops on LockGate FAIL (no lock file for new plan with verify_existing)', () => {
    cleanTmpLock();
    const yaml = loadYaml('fixtures/kernel/p3/evidencegate-test.plan.yaml');

    const result = runP3Kernel({
      planYaml: yaml,
      repoRoot: REPO_ROOT,
      attemptId: 'p3-lock-fail',
      lockPath: TMP_LOCK,
      lockMode: 'verify_existing',
    });

    expect(result.gateVerdicts.length).toBeGreaterThanOrEqual(2);
    const evidenceVerdict = result.gateVerdicts.find(g => g.gateName === 'EvidenceGate');
    expect(evidenceVerdict).toBeUndefined();
    cleanTmpLock();
  });

  test('never invokes WiringGate, ExecGate, or FinalGate', () => {
    cleanTmpLock();
    const yaml = loadYaml('fixtures/kernel/p3/evidencegate-test.plan.yaml');
    const records = [
      makeRecord({ recordId: 'EV-nf-001', type: 'diff', criterionId: 'AC-01', taskId: 'task-01' }),
      makeRecord({ recordId: 'EV-nf-002', type: 'test_output', criterionId: 'AC-02', taskId: 'task-01', source: 'test' }),
    ];

    const result = runP3Kernel({
      planYaml: yaml,
      repoRoot: REPO_ROOT,
      attemptId: 'p3-no-future',
      lockPath: TMP_LOCK,
      lockMode: 'create_if_missing',
      evidenceRecords: records,
      changedFiles: [{ path: 'src/feature.ts', status: 'added' }],
    });

    const gateNames = result.gateVerdicts.map(g => g.gateName);
    expect(gateNames).not.toContain('WiringGate');
    expect(gateNames).not.toContain('ExecGate');
    expect(gateNames).not.toContain('FinalGate');
    expect(gateNames.length).toBe(3);

    cleanTmpLock();
  });

  test('carries evidence result in output', () => {
    cleanTmpLock();
    const yaml = loadYaml('fixtures/kernel/p3/evidencegate-test.plan.yaml');
    const records = [
      makeRecord({ recordId: 'EV-carry-001', type: 'diff', criterionId: 'AC-01', taskId: 'task-01' }),
      makeRecord({ recordId: 'EV-carry-002', type: 'test_output', criterionId: 'AC-02', taskId: 'task-01', source: 'test' }),
    ];

    const result = runP3Kernel({
      planYaml: yaml,
      repoRoot: REPO_ROOT,
      attemptId: 'p3-carry',
      lockPath: TMP_LOCK,
      lockMode: 'create_if_missing',
      evidenceRecords: records,
      changedFiles: [{ path: 'src/feature.ts', status: 'added' }],
    });

    expect(result.evidence).toBeDefined();
    expect(result.evidence!.gateName).toBe('EvidenceGate');
    expect(result.evidence!.evidenceCount).toBe(2);

    cleanTmpLock();
  });
});
