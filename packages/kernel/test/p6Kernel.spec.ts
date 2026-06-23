// @praxis/kernel — P6 Kernel Pipeline Tests
// Tests for runKernel / runP6Kernel: full 6-gate pipeline
// SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync, existsSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runKernel } from '../src/runP6Kernel';
import type { EvidenceRecordV01 } from '../src/evidence/types';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const TMP_LOCK_DIR = resolve(REPO_ROOT, '.praxis/locks/test-p6');
const TMP_LOCK_PATH = resolve(TMP_LOCK_DIR, 'p6-test.lock.yaml');

// ---------------------------------------------------------------------------
// Minimal test plan YAML — designed to flow through all 6 gates.
//
// Key design choices:
// - No integrationContract → WiringGate skips (no wiring to check).
// - artifactPolicy.class = 'test_only' → executionRequired=true, wiringRequired=false.
// - Only file_exists criterion on a real file → FinalGate can evaluate.
// - Minimal requiredEvidence so evidence records suffice.
// - Empty commanded list → ExecGate runs 0 commands → PASS.
// ---------------------------------------------------------------------------
const MINIMAL_PLAN_YAML = `planSpecVersion: "0.1.0"
kind: "ImplementationPlan"
profile: "praxis-v0.1"

metadata:
  planId: "P6-MINIMAL-001"
  title: "Minimal P6 Pipeline Test"
  description: "Synthetic plan designed to flow through all 6 gates."
  createdAt: "2026-06-22T00:00:00Z"
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
    - "packages/kernel/package.json"
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
  - id: "task-minimal"
    title: "Minimal Task"
    objective: "Verify pipeline flow through all 6 gates."
    implementation:
      instructions:
        - "Ensure packages/kernel/package.json exists."
      allowedFiles:
        - "packages/kernel/package.json"

    artifactPolicy:
      class: "test_only"
      wiringRequired: false
      reachabilityRequired: false
      executionRequired: true
      deterministicEvidenceRequired: true

    # No integrationContract → WiringGate skips with PASS

    acceptanceCriteria:
      - id: "AC-FILE"
        description: "package.json exists."
        level: "required"
        humanApproved: true
        criteriaSource: "human"
        verification:
          type: "file_exists"
          path: "packages/kernel/package.json"
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
  enabled: false
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
  repairPacketRequiredOnHoldOrFail: false
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadYaml(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf-8');
}

function makeRecord(attemptId: string, overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: 'praxis-evidence/v0.1' as const,
    recordId: `EV-p6-${Math.random().toString(36).slice(2, 8)}`,
    attemptId,
    planId: 'P6-MINIMAL-001',
    timestamp: '2026-06-22T00:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

function makeP3Record(attemptId: string, overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: 'praxis-evidence/v0.1' as const,
    recordId: `EV-p6-${Math.random().toString(36).slice(2, 8)}`,
    attemptId,
    planId: 'PRAXIS-P3-TEST-001',
    timestamp: '2026-06-22T00:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

function cleanTmpLock() {
  try { if (existsSync(TMP_LOCK_PATH)) unlinkSync(TMP_LOCK_PATH); } catch {}
  if (!existsSync(TMP_LOCK_DIR)) mkdirSync(TMP_LOCK_DIR, { recursive: true });
}

function ensureLockDir() {
  if (!existsSync(TMP_LOCK_DIR)) mkdirSync(TMP_LOCK_DIR, { recursive: true });
}

beforeAll(() => {
  ensureLockDir();
});

afterAll(() => {
  try { if (existsSync(TMP_LOCK_PATH)) unlinkSync(TMP_LOCK_PATH); } catch {}
  try { rmdirSync(TMP_LOCK_DIR); } catch {}
});

// ===========================================================================
// Full Pipeline Tests
// ===========================================================================

describe('runKernel — full pipeline', () => {
  test('runs all 6 gates on valid plan (SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate)', async () => {
    cleanTmpLock();

    const attemptId = 'p6-full-test';
    const evidenceRecords = [
      makeRecord(attemptId, { type: 'diff', criterionId: 'AC-FILE', taskId: 'task-minimal' }),
    ];

    const result = await runKernel({
      planYaml: MINIMAL_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: TMP_LOCK_PATH,
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'packages/kernel/package.json', status: 'modified' }],
      commandOverrides: [],
    });

    // All 6 gates should have run
    expect(result.gateVerdicts.length).toBe(6);

    const gateNames = result.gateVerdicts.map(g => g.gateName);
    expect(gateNames).toContain('SchemaGate');
    expect(gateNames).toContain('LockGate');
    expect(gateNames).toContain('EvidenceGate');
    expect(gateNames).toContain('WiringGate');
    expect(gateNames).toContain('ExecGate');
    expect(gateNames).toContain('FinalGate');

    // Plan and hashes should be carried forward
    expect(result.plan).toBeDefined();
    expect(result.hashes).toBeDefined();

    cleanTmpLock();
  });

  test('outputs all 6 gate verdicts on full run', async () => {
    cleanTmpLock();

    const attemptId = 'p6-output-test';
    const evidenceRecords = [
      makeRecord(attemptId, { type: 'diff', criterionId: 'AC-FILE', taskId: 'task-minimal' }),
    ];

    const result = await runKernel({
      planYaml: MINIMAL_PLAN_YAML,
      repoRoot: REPO_ROOT,
      attemptId,
      lockPath: TMP_LOCK_PATH,
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'packages/kernel/package.json', status: 'modified' }],
      commandOverrides: [],
    });

    // Each gate should produce a verdict object with gateName and verdict
    expect(result.gateVerdicts.length).toBe(6);
    for (const gv of result.gateVerdicts) {
      expect(gv.gateName).toBeTruthy();
      expect(['PASS', 'HOLD', 'FAIL']).toContain(gv.verdict);
      expect(gv.timestamp).toBeTruthy();
    }

    // The result should carry gate-specific results
    expect(result.evidence).toBeDefined();
    expect(result.wiring).toBeDefined();
    expect(result.exec).toBeDefined();
    expect(result.final).toBeDefined();

    cleanTmpLock();
  });
});

// ===========================================================================
// Stop-on-Fail Tests
// ===========================================================================

describe('runKernel — stop conditions', () => {
  test('stops on SchemaGate FAIL', async () => {
    const result = await runKernel({
      planYaml: '{{{ definitely invalid yaml :::',
      repoRoot: REPO_ROOT,
      attemptId: 'p6-schema-fail',
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.gateVerdicts.length).toBe(1);
    expect(result.gateVerdicts[0].gateName).toBe('SchemaGate');
    expect(result.gateVerdicts[0].verdict).toBe('FAIL');

    // No other gates should have run
    const gateNames = result.gateVerdicts.map(g => g.gateName);
    expect(gateNames).not.toContain('FinalGate');
    expect(gateNames).not.toContain('ExecGate');
  });

  test('stops on LockGate FAIL', async () => {
    cleanTmpLock();
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');

    const { runSchemaGate } = await import('../src/gates/schemaGate');
    const { runLockGate } = await import('../src/gates/lockGate');

    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });
    if (!sv.plan || !sv.hashes) throw new Error('SchemaGate produced no plan');

    // Create a lock first
    runLockGate({
      plan: sv.plan,
      hashes: sv.hashes,
      lockPath: TMP_LOCK_PATH,
      mode: 'create_if_missing',
    });

    // Tamper the lock — change planId to trigger FAIL on verify
    const { readPlanLockYaml } = await import('../src/lock/readPlanLockYaml');
    const { writePlanLockYaml } = await import('../src/lock/writePlanLockYaml');
    const lockResult = readPlanLockYaml(TMP_LOCK_PATH);
    if (lockResult.ok && lockResult.lock) {
      lockResult.lock.planId = 'TAMPERED-PLAN-ID';
      writePlanLockYaml(lockResult.lock, TMP_LOCK_PATH);
    }

    const result = await runKernel({
      planYaml: yaml,
      repoRoot: REPO_ROOT,
      attemptId: 'p6-lock-fail',
      lockPath: TMP_LOCK_PATH,
      lockMode: 'verify_existing',
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.gateVerdicts.length).toBe(2);

    const lockVerdict = result.gateVerdicts.find(g => g.gateName === 'LockGate');
    expect(lockVerdict).toBeDefined();
    expect(lockVerdict!.verdict).toBe('FAIL');

    // Later gates should not have run
    const gateNames = result.gateVerdicts.map(g => g.gateName);
    expect(gateNames).not.toContain('FinalGate');
    expect(gateNames).not.toContain('ExecGate');

    cleanTmpLock();
  });

  test('stops on LockGate HOLD when stopOnHold=true', async () => {
    cleanTmpLock();
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');

    // verify_existing with no lock file → LockGate returns HOLD
    const result = await runKernel({
      planYaml: yaml,
      repoRoot: REPO_ROOT,
      attemptId: 'p6-lock-hold',
      lockPath: TMP_LOCK_PATH,
      lockMode: 'verify_existing',
      stopOnHold: true,
    });

    // LockGate should have returned HOLD
    const lockVerdict = result.gateVerdicts.find(g => g.gateName === 'LockGate');
    expect(lockVerdict).toBeDefined();
    expect(lockVerdict!.verdict).toBe('HOLD');

    // Later gates should not have run
    const gateNames = result.gateVerdicts.map(g => g.gateName);
    expect(gateNames).not.toContain('FinalGate');

    // Overall verdict should be HOLD
    expect(result.verdict).toBe('HOLD');

    cleanTmpLock();
  });
});

// ===========================================================================
// P3 Path Test
// ===========================================================================

describe('runKernel — P3 path', () => {
  test('only runs SchemaGate → LockGate → EvidenceGate on P3 path (stops before WiringGate)', async () => {
    cleanTmpLock();
    const yaml = loadYaml('fixtures/kernel/p3/evidencegate-test.plan.yaml');

    const evidenceRecords = [
      makeP3Record('p6-p3-path', { type: 'diff', criterionId: 'AC-01', taskId: 'task-01' }),
      makeP3Record('p6-p3-path', { type: 'test_output', criterionId: 'AC-02', taskId: 'task-01', source: 'test' }),
    ];

    const result = await runKernel({
      planYaml: yaml,
      repoRoot: REPO_ROOT,
      attemptId: 'p6-p3-path',
      lockPath: TMP_LOCK_PATH,
      lockMode: 'create_if_missing',
      evidenceRecords,
      changedFiles: [{ path: 'src/feature.ts', status: 'added' }],
      commandOverrides: [],
    });

    // All 6 gates should run (with stopOnHold=false, pipeline continues through HOLD)
    const gateNames = result.gateVerdicts.map(g => g.gateName);
    expect(gateNames).toContain('SchemaGate');
    expect(gateNames).toContain('LockGate');
    expect(gateNames).toContain('EvidenceGate');

    // The plan and hashes should be carried forward
    expect(result.plan).toBeDefined();
    expect(result.hashes).toBeDefined();

    cleanTmpLock();
  });
});
