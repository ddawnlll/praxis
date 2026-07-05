// @praxis/kernel — ACCP Report Format Tests

import { describe, test, expect } from 'bun:test';
import { formatReportAccpYaml, formatReportAccpSummary } from '../src/report/accpReport';
import type { VerificationReport } from '../src/report/reportGenerator';

function makeReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    reportVersion: 'praxis-report/v0.1',
    attemptId: 'test-run-001',
    planId: 'TEST-PLAN-001',
    planTitle: 'Test Plan',
    verdict: 'PASS',
    ok: true,
    createdAt: '2026-07-05T00:00:00Z',
    startedAt: '2026-07-05T00:00:00Z',
    finishedAt: '2026-07-05T00:01:00Z',
    gates: [
      { gateName: 'SchemaGate', verdict: 'PASS', reasonCodes: ['SCHEMA_PASS'] },
      { gateName: 'LockGate', verdict: 'PASS', reasonCodes: ['LOCK_PASS'] },
      { gateName: 'FinalGate', verdict: 'PASS', reasonCodes: ['ALL_CRITERIA_MET'] },
    ],
    totalGates: 3,
    passedGates: 3,
    heldGates: 0,
    failedGates: 0,
    diagnostics: [],
    summary: 'All gates passed.',
    ...overrides,
  };
}

describe('formatReportAccpYaml', () => {
  test('produces valid YAML string', () => {
    const report = makeReport();
    const yaml = formatReportAccpYaml(report);
    expect(yaml.length).toBeGreaterThan(0);
    expect(yaml).toContain('accp_version: praxis-accp/v0.1');
    expect(yaml).toContain('report_type: verification_report');
  });

  test('contains all required sections', () => {
    const report = makeReport();
    const yaml = formatReportAccpYaml(report);
    expect(yaml).toContain('attempt_id:');
    expect(yaml).toContain('gates:');
    expect(yaml).toContain('summary:');
    expect(yaml).toContain('SchemaGate');
    expect(yaml).toContain('ALL_CRITERIA_MET');
  });

  test('includes criteria summary when present', () => {
    const report = makeReport({
      criterionSummary: { total: 5, passed: 4, failed: 1, advisory: 0, notEvaluated: 0 },
    });
    const yaml = formatReportAccpYaml(report);
    expect(yaml).toContain('total: 5');
    expect(yaml).toContain('passed: 4');
    expect(yaml).toContain('failed: 1');
  });
});

describe('formatReportAccpSummary', () => {
  test('produces readable markdown', () => {
    const report = makeReport();
    const md = formatReportAccpSummary(report);
    expect(md).toContain('PRAXIS Verification Summary');
    expect(md).toContain('PASS');
    expect(md).toContain('3/3 gates passed');
  });

  test('dual output consistency', () => {
    const report = makeReport({ verdict: 'FAIL' });
    const yaml = formatReportAccpYaml(report);
    const md = formatReportAccpSummary(report);
    expect(yaml).toContain('FAIL');
    expect(md).toContain('FAIL');
    expect(md).toContain('3/3 gates passed');
  });
});
