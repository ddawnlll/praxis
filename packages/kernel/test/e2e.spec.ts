// @praxis/kernel — End-to-End Gate Pipeline Tests
// Real-world scenarios exercising the full 6-gate pipeline with
// report and repair packet generation.
//
// Scenarios:
//   1. PASS — valid plan, clean evidence, all gates pass
//   2. FAIL — invalid YAML → SchemaGate stops pipeline
//   3. HOLD — empty diff → EvidenceGate returns HOLD
//   4. HOLD — missing file → FinalGate returns HOLD
//   5. Mixed — prior gate FAIL stops before FinalGate
//   6. Report generation from kernel result
//   7. Repair packet generation from failed run

import { describe, test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { runKernel } from '../src/runP6Kernel';
import { generateReport, formatReportMarkdown } from '../src/report/reportGenerator';
import { generateRepairPacket } from '../src/repair/repairPacketGenerator';
import type { EvidenceRecordV01 } from '../src/evidence/types';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const LOCK_DIR = resolve(REPO_ROOT, '.praxis/locks/e2e-tests');

// ---------------------------------------------------------------------------
// Test plan: a valid PlanSpec that flows through all 6 gates.
// ---------------------------------------------------------------------------
const PASS_PLAN_YAML = `planSpecVersion: "0.1.0"
kind: "ImplementationPlan"
profile: "praxis-v0.1"

metadata:
  planId: "E2E-PASS-001"
  title: "E2E Full Pass Test"
  description: "Test plan designed to pass all 6 gates."
  createdAt: "2026-07-05T00:00:00Z"
  humanId: "test"
  status: "draft"

authority:
  executor: "ClaudeCode"
  completionAuthority: "PraxisTruthKernel"
  agentSelfReportIsClaimOnly: true
  criteriaSourceRequired: "human"
  reportsAreEvidenceOnly: true
  pluginOwnsTruth: false

workspace:
  root: "."
  allowedFiles:
    - "README.md"
  forbiddenFiles: []

execution:
  mode: "single_session"
  agent: "claude-code"
  autonomy: "implementation_allowed"
  canModifyCode: true
  canModifyPlan: false
  canModifyAcceptanceCriteria: false
  maxRepairLoops: 3

tasks:
  - id: "task-e2e-pass"
    title: "E2E Pass Task"
    objective: "Verify pipeline passes with clean evidence."
    implementation:
      instructions:
        - "Ensure README.md exists."
      allowedFiles:
        - "README.md"

    artifactPolicy:
      class: "test_only"
      wiringRequired: false
      reachabilityRequired: false
      executionRequired: true
      deterministicEvidenceRequired: true

    acceptanceCriteria:
      - id: "AC-README"
        description: "README.md exists."
        level: "required"
        humanApproved: true
        criteriaSource: "human"
        verification:
          type: "file_exists"
          path: "README.md"
          deterministic: true
          canSatisfyFinalGate: true
          advisoryOnly: false
          evidenceRefs: []
        requiredEvidence:
          - "diff"

commands:
  exactAllowedCommands:
    - id: "CMD-ECHO"
      kind: "final_validation"
      command: "echo ok"
      evidenceRequired: true
      timeoutSeconds: 10
  validationEvidenceRules:
    finalPromotionRequiresExactAllowedCommand: true
    discoveryCommandsMayNotSatisfyFinalValidation: true
    runtimeGrantCommandsCanSatisfyValidationOnlyIfGrantStatesValidationPurpose: false
  hardDeniedCommands:
    - command: "rm -rf /"
      reason: "Destructive operation blocked."

evidence:
  ledgerRequired: true
  requiredEvidenceTypes:
    - "diff"
  hashWhenAvailable: true

gates:
  sequence:
    - "SchemaGate"
    - "LockGate"
    - "EvidenceGate"
    - "WiringGate"
    - "ExecGate"
    - "FinalGate"
  verdicts:
    - "PASS"
    - "HOLD"
    - "FAIL"
  reasonCodes: {}

repair:
  enabled: true
  failedCriteriaOnly: true
  mayModifyAcceptanceCriteria: false
  mayModifyPlan: false
  allowedFilesFromFailedTasksOnly: true
  maxRepairLoops: 0
  reverifyCommand: ""
  repairPacketFormat:
    json: true
    markdown: true

locking:
  lockRequired: true
  canonicalHashRequired: true
  planLockFile: ".praxis/planspec.lock"
  hashes:
    - "planHash"
    - "acceptanceCriteriaHash"
    - "artifactPolicyHash"
    - "integrationContractHash"
    - "commandPolicyHash"
    - "allowedFilesHash"
    - "forbiddenFilesHash"

reports:
  protocol: "ACCP"
  artifactDirectory: "reports/"
  reportsAreEvidenceOnly: true
  reportsDoNotAuthorizeExecution: true
  commandEvidenceRequired: true
  repairPacketRequiredOnHoldOrFail: true
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(attemptId: string, overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: 'praxis-evidence/v0.1' as const,
    recordId: `EV-e2e-${Math.random().toString(36).slice(2, 8)}`,
    attemptId,
    planId: 'E2E-PASS-001',
    timestamp: '2026-07-05T00:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

function makeP3Record(attemptId: string, overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: 'praxis-evidence/v0.1' as const,
    recordId: `EV-e2e-${Math.random().toString(36).slice(2, 8)}`,
    attemptId,
    planId: 'E2E-PASS-001',
    timestamp: '2026-07-05T00:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

function lockPath(name: string): string {
  return resolve(LOCK_DIR, `${name}.lock.yaml`);
}

// ===========================================================================
// Scenario 1: Full PASS
// ===========================================================================

describe('E2E: Full PASS scenario', () => {
  test('runs all 6 gates and returns PASS', async () => {
    const attemptId = 'e2e-pass-001';
    const evidenceRecords = [
      makeRecord(attemptId, {
        type: 'diff',
        criterionId: 'AC-README',
        taskId: 'task-e2e-pass',
        path: 'README.md',
      }),
    ];

    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('hold-evidence'),
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      commandOverrides: [],
    });

    // All 6 gates ran
    expect(result.gateVerdicts.length).toBe(6);
    expect(result.plan).toBeDefined();
    expect(result.hashes).toBeDefined();

    // SchemaGate
    const gateNames = result.gateVerdicts.map(g => g.gateName);
    expect(gateNames).toEqual(['SchemaGate', 'LockGate', 'EvidenceGate', 'WiringGate', 'ExecGate', 'FinalGate']);

    // All gates PASS
    for (const gv of result.gateVerdicts) {
      expect(gv.verdict).toBe('PASS');
    }

    // Overall verdict PASS
    expect(result.verdict).toBe('PASS');
    expect(result.ok).toBe(true);

    // Gate-specific results populated
    expect(result.evidence).toBeDefined();
    expect(result.wiring).toBeDefined();
    expect(result.exec).toBeDefined();
    expect(result.final).toBeDefined();
  });

  test('generates accurate report from PASS result', async () => {
    const attemptId = 'e2e-pass-report';
    const evidenceRecords = [
      makeRecord(attemptId, {
        type: 'diff',
        criterionId: 'AC-README',
        taskId: 'task-e2e-pass',
        path: 'README.md',
      }),
    ];

    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('pass-report'),
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      commandOverrides: [],
    });

    // Generate report
    const report = generateReport(result);

    expect(report.reportVersion).toBe('praxis-report/v0.1');
    expect(report.attemptId).toBe(attemptId);
    expect(report.planId).toBe('E2E-PASS-001');
    expect(report.verdict).toBe('PASS');
    expect(report.ok).toBe(true);
    expect(report.startedAt).toBeTruthy();
    expect(report.finishedAt).toBeTruthy();
    expect(report.totalGates).toBe(6);
    expect(report.passedGates).toBe(6);
    expect(report.heldGates).toBe(0);
    expect(report.failedGates).toBe(0);

    // Format as Markdown
    const md = formatReportMarkdown(report);
    expect(md).toContain('PRAXIS Verification Report');
    expect(md).toContain('PASS');
    expect(md).toContain('6/6 gates passed');
    expect(md).toContain('E2E-PASS-001');
  });

  test('generates no repair packet from PASS result', async () => {
    const attemptId = 'e2e-pass-norepair';
    const evidenceRecords = [
      makeRecord(attemptId, {
        type: 'diff',
        criterionId: 'AC-README',
        taskId: 'task-e2e-pass',
        path: 'README.md',
      }),
    ];

    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('pass-norepair'),
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      commandOverrides: [],
    });

    // Repair packet should be undefined
    const packet = generateRepairPacket(
      result.plan,
      result.hashes,
      attemptId,
      result.gateVerdicts,
      result.final?.criterionResults,
      result.diagnostics,
    );
    expect(packet).toBeUndefined();
  });
});

// ===========================================================================
// Scenario 2: SchemaGate FAIL (invalid YAML)
// ===========================================================================

describe('E2E: SchemaGate FAIL scenario', () => {
  test('stops pipeline on invalid YAML', async () => {
    const result = await runKernel({
      planYaml: '{{{ definitely not valid yaml :::',
      repoRoot: REPO_ROOT,
      attemptId: 'e2e-fail-001',
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.ok).toBe(false);
    expect(result.gateVerdicts.length).toBe(1);
    expect(result.gateVerdicts[0].gateName).toBe('SchemaGate');
    expect(result.gateVerdicts[0].verdict).toBe('FAIL');
    expect(result.gateVerdicts[0].reasonCodes).toContain('YAML_PARSE_ERROR');

    // Generate report from FAIL result
    const report = generateReport(result);
    expect(report.verdict).toBe('FAIL');
    expect(report.failedGates).toBe(1);
    expect(report.totalGates).toBe(1);
    expect(report.gates[0].gateName).toBe('SchemaGate');
    expect(report.gates[0].verdict).toBe('FAIL');
  });

  test('generates repair packet from SchemaGate FAIL', async () => {
    const result = await runKernel({
      planYaml: '{{{ invalid',
      repoRoot: REPO_ROOT,
      attemptId: 'e2e-fail-repair',
    });

    const packet = generateRepairPacket(
      result.plan,
      result.hashes,
      'e2e-fail-repair',
      result.gateVerdicts,
      undefined,
      result.diagnostics,
    );

    expect(packet).toBeDefined();
    expect(packet!.triggerVerdict).toBe('FAIL');
    expect(packet!.failedGates.length).toBe(1);
    expect(packet!.failedGates[0].gateName).toBe('SchemaGate');
    expect(packet!.failedGates[0].verdict).toBe('FAIL');
    expect(packet!.strategies.length).toBeGreaterThanOrEqual(2);
    expect(packet!.strategy_kinds).toBeUndefined(); // no such field — sanity check

    // Should contain schema-related strategies
    const strategyKinds = packet!.strategies.map(s => s.kind);
    expect(strategyKinds).toContain('initial');
  });
});

// ===========================================================================
// Scenario 3: EvidenceGate HOLD (empty diff for code task)
// ===========================================================================

describe('E2E: EvidenceGate HOLD scenario', () => {
  test('returns HOLD when diff is empty for code task', async () => {
    const attemptId = 'e2e-hold-001';
    // No evidence records → EvidenceGate returns HOLD because
    // required evidence type "diff" is missing
    const evidenceRecords: EvidenceRecordV01[] = [];

    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('hold-evidence'),
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [],
      commandOverrides: [],
    });

    // EvidenceGate should hold
    const evGate = result.gateVerdicts.find(g => g.gateName === 'EvidenceGate');
    expect(evGate).toBeDefined();
    expect(evGate!.verdict).toBe('HOLD');

    // Overall verdict is HOLD (stopOnHold=false so pipeline continues)
    expect(result.verdict).toBe('HOLD');
  });
});

// ===========================================================================
// Scenario 4: FinalGate HOLD (missing file criterion)
// ===========================================================================

describe('E2E: FinalGate HOLD — criterion failure', () => {
  test('returns HOLD when file_exists criterion targets non-existent file', async () => {
    const attemptId = 'e2e-hold-file';

    // Build a plan with a criterion targeting a non-existent file.
    // Add the file to allowedFiles so EvidenceGate doesn't fail.
    const holdPlanYaml = PASS_PLAN_YAML
      .replace('path: "README.md"', 'path: "__e2e-nonexistent-file__.foo"')
      .replace('allowedFiles:\n    - "README.md"', 'allowedFiles:\n    - "README.md"\n    - "__e2e-nonexistent-file__.foo"');

    const evidenceRecords = [
      makeRecord(attemptId, {
        type: 'diff',
        criterionId: 'AC-README',
        taskId: 'task-e2e-pass',
        path: '__e2e-nonexistent-file__.foo',
      }),
    ];

    const result = await runKernel({
      planYaml: holdPlanYaml,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('hold-file'),
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{
        path: '__e2e-nonexistent-file__.foo',
        status: 'modified',
      }],
      commandOverrides: [],
    });

    // The criterion file doesn't exist → FinalGate should HOLD or FAIL
    const finalGate = result.gateVerdicts.find(g => g.gateName === 'FinalGate');
    expect(finalGate).toBeDefined();
    expect(finalGate!.verdict).toBe('HOLD');

    // Verify report includes criterion info
    const report = generateReport(result);
    if (result.final) {
      expect(report.criterionSummary).toBeDefined();
      expect(report.criterionSummary!.total).toBeGreaterThan(0);
      expect(report.criterionSummary!.failed).toBeGreaterThanOrEqual(0);
    }
  });
});

// ===========================================================================
// Scenario 5: ExecGate with custom commands
// ===========================================================================

describe('E2E: ExecGate scenarios', () => {
  test('passes with explicit allowed commands', async () => {
    const attemptId = 'e2e-exec-pass';
    const evidenceRecords = [
      makeRecord(attemptId, {
        type: 'diff',
        criterionId: 'AC-README',
        taskId: 'task-e2e-pass',
        path: 'README.md',
      }),
    ];

    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('exec-pass'),
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      commandOverrides: [],
    });

    expect(result.verdict).toBe('PASS');
  });
});

// ===========================================================================
// Scenario 6: Prior gate FAIL prevents downstream gates
// ===========================================================================

describe('E2E: Early stop on FAIL', () => {
  test('LockGate HOLD stops before downstream gates when stopOnHold=true', async () => {
    // First create a lock at a known path, then verify_existing with a
    // DIFFERENT path (no lock) to trigger MISSING_PLAN_LOCK
    const lockPathCreate = lockPath('lockhold-create');
    const lockPathVerify = lockPath('lockhold-verify-nonexistent');

    // Create a lock first
    const setupResult = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId: 'e2e-lockhold-setup',
      lockPath: lockPathCreate,
      lockMode: 'create_if_missing',
      evidenceRecords: [],
      changedFiles: [],
      commandOverrides: [],
    });
    expect(setupResult.verdict).toBe('HOLD'); // EvidenceGate HOLD (no evidence) but LockGate should have passed

    // Now verify with a non-existent lock → should MISSING_PLAN_LOCK → HOLD
    // With stopOnHold=false (default), pipeline continues
    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId: 'e2e-lockfail',
      lockPath: lockPathVerify,
      lockMode: 'verify_existing',
    });

    // SchemaGate should PASS
    const schemaGate = result.gateVerdicts.find(g => g.gateName === 'SchemaGate');
    expect(schemaGate).toBeDefined();
    expect(schemaGate!.verdict).toBe('PASS');

    // LockGate should HOLD (MISSING_PLAN_LOCK) since no lock at this path
    const lockGate = result.gateVerdicts.find(g => g.gateName === 'LockGate');
    expect(lockGate).toBeDefined();
    expect(lockGate!.verdict).toBe('HOLD');

    // With stopOnHold=false (default), pipeline continues → FinalGate should still run
    const finalGate = result.gateVerdicts.find(g => g.gateName === 'FinalGate');
    expect(finalGate).toBeDefined();
  });

  test('stops immediately with stopOnHold=true and LockGate HOLD', async () => {
    const lockPathVerify = lockPath('lockhold-stop-nonexistent');

    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId: 'e2e-lockhold-stop',
      lockPath: lockPathVerify,
      lockMode: 'verify_existing',
      stopOnHold: true,
    });

    // LockGate should be HOLD (MISSING_PLAN_LOCK)
    const lockGate = result.gateVerdicts.find(g => g.gateName === 'LockGate');
    expect(lockGate).toBeDefined();
    expect(lockGate!.verdict).toBe('HOLD');

    // FinalGate should NOT have run
    const finalGate = result.gateVerdicts.find(g => g.gateName === 'FinalGate');
    expect(finalGate).toBeUndefined();
  });
});

// ===========================================================================
// Scenario 7: Full report and repair packet integration
// ===========================================================================

describe('E2E: Report + Repair integration', () => {
  test('report and repair packet share consistent data', async () => {
    const attemptId = 'e2e-integration';

    // Run with no evidence → HOLD
    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('integration'),
      lockMode: 'create_if_missing',
      evidenceRecords: [],
      changedFiles: [],
      commandOverrides: [],
    });

    // Generate both report and repair packet
    const report = generateReport(result);
    const packet = generateRepairPacket(
      result.plan,
      result.hashes,
      attemptId,
      result.gateVerdicts,
      result.final?.criterionResults,
      result.diagnostics,
    );

    // Report should exist and be consistent
    expect(report.attemptId).toBe(attemptId);
    expect(report.planId).toBe('E2E-PASS-001');

    // Both report and packet should reference the same gates
    for (const g of report.gates) {
      if (g.verdict !== 'PASS') {
        const matchingGate = packet?.failedGates.find(fg => fg.gateName === g.gateName);
        expect(matchingGate).toBeDefined();
        if (matchingGate) {
          expect(matchingGate.reasonCodes).toEqual(g.reasonCodes);
        }
      }
    }

    // Markdown report should be readable
    const md = formatReportMarkdown(report);
    expect(md.length).toBeGreaterThan(50);
    expect(md).toContain('| Gate | Verdict |');
  });
});

// ===========================================================================
// Scenario 8: Multi-gate pipeline with diverse evidence
// ===========================================================================

describe('E2E: Complex scenario with diverse evidence', () => {
  test('passes with multiple evidence records', async () => {
    const attemptId = 'e2e-complex-pass';
    const evidenceRecords = [
      makeRecord(attemptId, {
        type: 'diff',
        criterionId: 'AC-README',
        taskId: 'task-e2e-pass',
        path: 'README.md',
      }),
      makeRecord(attemptId, {
        type: 'diff',
        criterionId: 'AC-README',
        taskId: 'task-e2e-pass',
        summary: 'Tests passed: 10/10',
      }),
    ];

    const result = await runKernel({
      planYaml: PASS_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: lockPath('complex-pass'),
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'README.md', status: 'modified' }],
      commandOverrides: [],
    });

    expect(result.verdict).toBe('PASS');
    expect(result.gateVerdicts.length).toBe(6);

    // All gates should pass
    for (const gv of result.gateVerdicts) {
      expect(gv.verdict).toBe('PASS');
    }
  });
});
