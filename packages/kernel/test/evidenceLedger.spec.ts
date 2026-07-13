// @praxis/kernel — EvidenceLedger Tests
// Tests for JSONL parsing, writing, appending, and validation.

import { describe, test, expect } from 'bun:test';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEvidenceLedgerJsonl, parseEvidenceRecord } from '../src/evidence/readEvidenceLedgerJsonl';
import { writeEvidenceLedgerJsonl } from '../src/evidence/writeEvidenceLedgerJsonl';
import { appendEvidenceRecordJsonl } from '../src/evidence/appendEvidenceRecordJsonl';
import { validateEvidenceLedger } from '../src/evidence/validateEvidenceLedger';
import {
  type EvidenceRecordV01,
  type EvidenceRungV01,
  EVIDENCE_VERSION_V01,
} from '../src/evidence/types';
import { loadPlanSpecYaml, type PlanSpecV01 } from '@praxis/contracts';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const FIXTURES = resolve(REPO_ROOT, 'fixtures/kernel/p3');
const PLAN_PATH = resolve(FIXTURES, 'evidencegate-test.plan.yaml');

function loadPlan(): PlanSpecV01 {
  const result = loadPlanSpecYaml(PLAN_PATH, REPO_ROOT);
  if (!result.ok || !result.plan) throw new Error('Failed to load test plan: ' + JSON.stringify(result.diagnostics));
  return result.plan;
}

function makeRecord(overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: EVIDENCE_VERSION_V01,
    recordId: 'EV-test-001',
    attemptId: 'p3-test-001',
    planId: 'PRAXIS-P3-TEST-001',
    timestamp: '2026-06-20T10:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

function tmpPath(name: string): string {
  return resolve(REPO_ROOT, `.praxis/tmp-${name}.jsonl`);
}

function cleanup(path: string): void {
  try { if (existsSync(path)) unlinkSync(path); } catch {}
}

// =========================================================
// JSONL Reader Tests
// =========================================================
describe('readEvidenceLedgerJsonl', () => {
  test('reads valid JSONL records', () => {
    const path = resolve(FIXTURES, 'evidencegate-valid-ledger.evidence.jsonl');
    const result = readEvidenceLedgerJsonl(path);

    expect(result.ok).toBe(true);
    expect(result.records.length).toBe(4);
    expect(result.records[0].recordId).toBe('EV-valid-001');
    expect(result.records[0].type).toBe('diff');
  });

  test('rejects malformed JSON line but still parses valid lines', () => {
    const path = resolve(FIXTURES, 'evidencegate-malformed-ledger.evidence.jsonl');
    const result = readEvidenceLedgerJsonl(path);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some(d => d.code === 'EVIDENCE_LEDGER_PARSE_ERROR')).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
  });

  test('returns empty for missing file', () => {
    const result = readEvidenceLedgerJsonl('/nonexistent/path/evidence.jsonl');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'EVIDENCE_LEDGER_MISSING')).toBe(true);
    expect(result.records.length).toBe(0);
  });
});

// =========================================================
// parseEvidenceRecord unit tests
// =========================================================
describe('parseEvidenceRecord', () => {
  test('parses valid record', () => {
    const json = JSON.stringify(makeRecord());
    const result = parseEvidenceRecord(json, 1);
    expect('severity' in result).toBe(false);
    const record = result as EvidenceRecordV01;
    expect(record.recordId).toBe('EV-test-001');
  });

  test('rejects non-JSON line', () => {
    const result = parseEvidenceRecord('this is not json', 1);
    expect('severity' in result).toBe(true);
    if ('code' in result) expect(result.code).toBe('EVIDENCE_LEDGER_PARSE_ERROR');
  });

  test('rejects wrong evidenceVersion', () => {
    const record = makeRecord({ evidenceVersion: 'wrong-version' as any });
    const result = parseEvidenceRecord(JSON.stringify(record), 1);
    expect('severity' in result).toBe(true);
    if ('code' in result) expect(result.code).toBe('EVIDENCE_VERSION_MISMATCH');
  });

  test('rejects missing required field', () => {
    const obj = { evidenceVersion: EVIDENCE_VERSION_V01, recordId: 'EV-001' };
    const result = parseEvidenceRecord(JSON.stringify(obj), 1);
    expect('severity' in result).toBe(true);
    if ('code' in result) expect(result.code).toBe('EVIDENCE_MISSING_REQUIRED_FIELD');
  });

  test('rejects invalid recordId pattern', () => {
    const record = makeRecord({ recordId: 'bad-format' });
    const result = parseEvidenceRecord(JSON.stringify(record), 1);
    expect('severity' in result).toBe(true);
    if ('code' in result) expect(result.code).toBe('EVIDENCE_INVALID_RECORD_ID');
  });

  test('accepts valid recordId with dots and dashes', () => {
    const record = makeRecord({ recordId: 'EV-test.v1-run_3' });
    const result = parseEvidenceRecord(JSON.stringify(record), 1);
    expect('severity' in result).toBe(false);
  });

  test('skips blank line', () => {
    const result = parseEvidenceRecord('   ', 1);
    expect('severity' in result).toBe(true);
    if ('code' in result) expect(result.code).toBe('EVIDENCE_BLANK_LINE');
  });
});

// =========================================================
// JSONL Writer Tests
// =========================================================
describe('writeEvidenceLedgerJsonl', () => {
  test('writes JSONL records to disk', () => {
    const records = [makeRecord(), makeRecord({ recordId: 'EV-test-002', type: 'test_output' })];
    const tp = tmpPath('write');
    const result = writeEvidenceLedgerJsonl(tp, records);
    expect(result.ok).toBe(true);
    expect(result.recordCount).toBe(2);
    const readBack = readEvidenceLedgerJsonl(tp);
    expect(readBack.records.length).toBe(2);
    cleanup(tp);
  });
});

// =========================================================
// JSONL Appender Tests
// =========================================================
describe('appendEvidenceRecordJsonl', () => {
  test('appends JSONL record to existing file', () => {
    const record0 = makeRecord({ recordId: 'EV-append-001' });
    const record1 = makeRecord({ recordId: 'EV-append-002', type: 'source' });
    const tp = tmpPath('append');
    cleanup(tp);
    writeEvidenceLedgerJsonl(tp, [record0]);
    const appendResult = appendEvidenceRecordJsonl(tp, record1);
    expect(appendResult.ok).toBe(true);
    const readBack = readEvidenceLedgerJsonl(tp);
    expect(readBack.records.length).toBe(2);
    cleanup(tp);
  });
});

// =========================================================
// validateEvidenceLedger Tests
// =========================================================
describe('validateEvidenceLedger', () => {
  test('passes valid records matching plan', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ recordId: 'EV-v-001', type: 'diff', criterionId: 'AC-01' }),
      makeRecord({ recordId: 'EV-v-002', type: 'test_output', criterionId: 'AC-02', source: 'test' }),
    ];
    const result = validateEvidenceLedger(records, plan, 'p3-test-001');
    expect(result.ok).toBe(true);
    expect(result.divergenceRecords.length).toBe(0);
  });

  test('detects attemptId mismatch', () => {
    const plan = loadPlan();
    const records = [makeRecord({ attemptId: 'wrong-attempt' })];
    const result = validateEvidenceLedger(records, plan, 'p3-test-001');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'ATTEMPT_ID_MISMATCH')).toBe(true);
  });

  test('detects planId mismatch', () => {
    const plan = loadPlan();
    const records = [makeRecord({ planId: 'WRONG-PLAN' })];
    const result = validateEvidenceLedger(records, plan, 'p3-test-001');
    expect(result.ok).toBe(false);
  });

  test('detects unknown criterionId', () => {
    const plan = loadPlan();
    const records = [makeRecord({ criterionId: 'AC-NONEXISTENT' })];
    const result = validateEvidenceLedger(records, plan, 'p3-test-001');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'UNKNOWN_CRITERION_ID')).toBe(true);
  });

  test('detects divergence records', () => {
    const plan = loadPlan();
    const records = [makeRecord({ type: 'divergence_file' })];
    const result = validateEvidenceLedger(records, plan, 'p3-test-001');
    expect(result.ok).toBe(false);
    expect(result.divergenceRecords.length).toBe(1);
  });

  test('detects missing required evidence for criterion', () => {
    const plan = loadPlan();
    const records = [makeRecord({ recordId: 'EV-m-001', type: 'diff', criterionId: 'AC-01' })];
    const result = validateEvidenceLedger(records, plan, 'p3-test-001');
    expect(result.missingRequiredEvidence.length).toBeGreaterThan(0);
  });

  test('allows bookkeeping types without being in requiredEvidenceTypes', () => {
    const plan = loadPlan();
    const records = [
      makeRecord({ type: 'changed_file' }),
      makeRecord({ type: 'diff', criterionId: 'AC-01' }),
      makeRecord({ type: 'test_output', criterionId: 'AC-02', source: 'test' }),
    ];
    const result = validateEvidenceLedger(records, plan, 'p3-test-001');
    const unsupported = result.diagnostics.filter(d => d.code === 'UNSUPPORTED_EVIDENCE_TYPE');
    expect(unsupported.length).toBe(0);
  });
});

// =========================================================
// Evidence Rung Ladder Tests
// =========================================================

describe('sourceToRung', () => {
  test('kernel sources map to OS_RECORDED', async () => {
    const { sourceToRung } = await import('../src/evidence/types');
    expect(sourceToRung('kernel')).toBe('OS_RECORDED');
    expect(sourceToRung('contracts')).toBe('OS_RECORDED');
    expect(sourceToRung('hook')).toBe('OS_RECORDED');
    expect(sourceToRung('cli')).toBe('OS_RECORDED');
    expect(sourceToRung('test')).toBe('OS_RECORDED');
  });

  test('agent_claim and manual map to AGENT_AUTHORED', async () => {
    const { sourceToRung } = await import('../src/evidence/types');
    expect(sourceToRung('agent_claim')).toBe('AGENT_AUTHORED');
    expect(sourceToRung('manual')).toBe('AGENT_AUTHORED');
  });

  test('external maps to THIRD_PARTY', async () => {
    const { sourceToRung } = await import('../src/evidence/types');
    expect(sourceToRung('external')).toBe('THIRD_PARTY');
  });
});

describe('resolveRung', () => {
  test('uses explicit rung field when present', async () => {
    const { resolveRung } = await import('../src/evidence/types');
    const record: EvidenceRecordV01 = {
      evidenceVersion: EVIDENCE_VERSION_V01,
      recordId: 'EV-test',
      attemptId: 'a1',
      planId: 'p1',
      timestamp: '2026-01-01T00:00:00Z',
      type: 'diff',
      source: 'kernel',
      rung: 'THIRD_PARTY',
    };
    expect(resolveRung(record)).toBe('THIRD_PARTY');
  });

  test('derives rung from source when rung field is absent', async () => {
    const { resolveRung } = await import('../src/evidence/types');
    const record: EvidenceRecordV01 = {
      evidenceVersion: EVIDENCE_VERSION_V01,
      recordId: 'EV-test',
      attemptId: 'a1',
      planId: 'p1',
      timestamp: '2026-01-01T00:00:00Z',
      type: 'diff',
      source: 'agent_claim',
    };
    expect(resolveRung(record)).toBe('AGENT_AUTHORED');
  });
});
