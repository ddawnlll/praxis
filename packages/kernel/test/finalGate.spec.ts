// @praxis/kernel — FinalGate Tests
// Tests for FinalGate: criterion evaluation, verdict aggregation,
// advisory/manual review handling, prior gate failure, and forbidden diff detection.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { runFinalGate } from '../src/gates/finalGate';
import { FINAL_REASON_CODES } from '../src/diagnostics';
import type { PlanSpecV01, PlanHashes, AcceptanceCriterion } from '@praxis/contracts';
import type { GateVerdict } from '../src/types';
import type { EvidenceRecordV01 } from '../src/evidence/types';
import type { CommandResult } from '../src/executor/types';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const FIXTURE_DIR = resolve(REPO_ROOT, '.praxis/test-final');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeHashes(): PlanHashes {
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

function makeEvidenceRecord(overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: 'praxis-evidence/v0.1' as const,
    recordId: `EV-${Math.random().toString(36).slice(2, 10)}`,
    attemptId: 'final-test-001',
    planId: 'FINAL-TEST-001',
    timestamp: '2026-06-22T00:00:00Z',
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

function makeCommandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    commandId: 'CMD-TEST',
    command: 'bun test',
    kind: 'final_validation',
    verdict: 'PASS',
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 500,
    stdoutTruncated: '31 tests passed, 0 failed',
    stderrTruncated: '',
    stdoutBytes: 100,
    stderrBytes: 0,
    reasonCodes: ['COMMAND_SUCCEEDED'],
    skipped: false,
    ...overrides,
  };
}

function makePriorGateVerdicts(verdicts: Array<{ gateName: string; verdict: 'PASS' | 'HOLD' | 'FAIL' }>): GateVerdict[] {
  return verdicts.map((gv, i) => ({
    gateName: gv.gateName,
    verdict: gv.verdict,
    reasonCodes: gv.verdict === 'PASS' ? [`${gv.gateName.toUpperCase()}_PASS`] : [`${gv.gateName.toUpperCase()}_FAIL`],
    failedCriteriaIds: [],
    evidenceRefs: [],
    attemptId: 'final-test-001',
    timestamp: `2026-06-22T00:00:0${i}Z`,
  }));
}

function buildPlan(overrides: Partial<PlanSpecV01> = {}): PlanSpecV01 {
  return {
    planSpecVersion: '0.1.0',
    kind: 'ImplementationPlan',
    profile: 'praxis-v0.1',
    metadata: {
      planId: 'FINAL-TEST-001',
      title: 'FinalGate Test Plan',
      description: 'Synthetic plan for FinalGate tests.',
      createdAt: '2026-06-22T00:00:00Z',
      humanId: 'test',
      status: 'draft',
    },
    authority: {
      executor: 'ClaudeCode',
      completionAuthority: 'PraxisTruthKernel',
      agentSelfReportIsClaimOnly: true,
      criteriaSourceRequired: 'human',
      reportsAreEvidenceOnly: true,
      pluginOwnsTruth: false,
    },
    workspace: { root: '.', allowedFiles: [], forbiddenFiles: [] },
    execution: {
      mode: 'single_session',
      agent: 'claude-code',
      autonomy: 'implementation_allowed',
      canModifyCode: true,
      canModifyPlan: false,
      canModifyAcceptanceCriteria: false,
      maxRepairLoops: 3,
    },
    tasks: [],
    commands: {
      exactAllowedCommands: [],
      validationEvidenceRules: {
        finalPromotionRequiresExactAllowedCommand: true,
        discoveryCommandsMayNotSatisfyFinalValidation: true,
        runtimeGrantCommandsCanSatisfyValidationOnlyIfGrantStatesValidationPurpose: true,
      },
      hardDeniedCommands: [],
    },
    evidence: {
      ledgerRequired: true,
      requiredEvidenceTypes: [],
      hashWhenAvailable: true,
    },
    gates: {
      sequence: ['SchemaGate', 'LockGate', 'EvidenceGate', 'WiringGate', 'ExecGate', 'FinalGate'],
      verdicts: ['PASS', 'HOLD', 'FAIL'],
      reasonCodes: {},
    },
    repair: {
      enabled: false,
      failedCriteriaOnly: true,
      mayModifyAcceptanceCriteria: false,
      mayModifyPlan: false,
      allowedFilesFromFailedTasksOnly: true,
      maxRepairLoops: 0,
      reverifyCommand: '',
      repairPacketFormat: { json: true, markdown: true },
    },
    locking: {
      lockRequired: true,
      canonicalHashRequired: true,
      planLockFile: '.praxis/planspec.lock',
      hashes: [
        'planHash', 'acceptanceCriteriaHash', 'artifactPolicyHash',
        'integrationContractHash', 'commandPolicyHash',
        'allowedFilesHash', 'forbiddenFilesHash',
      ],
    },
    reports: {
      protocol: 'ACCP',
      artifactDirectory: 'reports/',
      reportsAreEvidenceOnly: true,
      reportsDoNotAuthorizeExecution: true,
      commandEvidenceRequired: true,
      repairPacketRequiredOnHoldOrFail: false,
    },
    ...overrides,
  };
}

/**
 * Build a deterministic PASS criterion: file_exists on a known file.
 */
function passCriterion(id: string): AcceptanceCriterion {
  return {
    id,
    description: `File exists: packages/kernel/package.json`,
    level: 'required',
    humanApproved: true,
    criteriaSource: 'human',
    verification: {
      type: 'file_exists',
      path: 'packages/kernel/package.json',
      deterministic: true,
      canSatisfyFinalGate: true,
      advisoryOnly: false,
      evidenceRefs: [],
    },
    requiredEvidence: ['diff'],
  };
}

// ===========================================================================
// Setup / teardown
// ===========================================================================

beforeAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(resolve(FIXTURE_DIR, 'output.txt'), 'expected content here');
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ===========================================================================
// FinalGate PASS
// ===========================================================================

describe('FinalGate PASS', () => {
  test('PASS with all deterministic criteria met', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Pass all criteria.',
        implementation: {
          instructions: ['Create files.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        integrationContract: {
          mode: 'required',
          reason: 'Integration required.',
        },
        acceptanceCriteria: [
          passCriterion('AC-01'),
          {
            id: 'AC-02',
            description: 'Diff contains expected pattern.',
            level: 'required',
            humanApproved: true,
            criteriaSource: 'human',
            verification: {
              type: 'diff_contains',
              patterns: ['healthRouter'],
              deterministic: true,
              canSatisfyFinalGate: true,
              advisoryOnly: false,
              evidenceRefs: [],
            },
            requiredEvidence: ['diff'],
          },
        ],
      }],
    });

    const evidenceRecords = [
      makeEvidenceRecord({ type: 'diff', summary: 'export function healthRouter() {}', criterionId: 'AC-02' }),
    ];

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-pass-001',
      repoRoot: REPO_ROOT,
      evidenceRecords,
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.gateName).toBe('FinalGate');
    expect(result.verdict).toBe('PASS');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.ALL_CRITERIA_MET);
    expect(result.totalCriteria).toBe(2);
    expect(result.passedCriteria).toBe(2);
  });

  test('PASS ignoring advisory-only criteria', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Pass with advisory criteria ignored.',
        implementation: {
          instructions: ['Create files.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [
          passCriterion('AC-DET'),
          {
            id: 'AC-ADV',
            description: 'Advisory criterion.',
            level: 'advisory',
            humanApproved: true,
            criteriaSource: 'human',
            verification: {
              type: 'file_exists',
              path: 'nonexistent/adv-file.ts',
              deterministic: true,
              canSatisfyFinalGate: true,
              advisoryOnly: true,
              evidenceRefs: [],
            },
            requiredEvidence: ['diff'],
          },
        ],
      }],
    });

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-pass-002',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    // The deterministic criterion passes, advisory is ignored → PASS
    expect(result.verdict).toBe('PASS');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.ALL_CRITERIA_MET);
    expect(result.advisoryCriteria).toBe(1);
  });
});

// ===========================================================================
// FinalGate HOLD
// ===========================================================================

describe('FinalGate HOLD', () => {
  test('HOLD when some criteria fail (partial)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Partial pass.',
        implementation: {
          instructions: ['Create files.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [
          passCriterion('AC-PASS'),
          {
            id: 'AC-FAIL',
            description: 'File does not exist.',
            level: 'required',
            humanApproved: true,
            criteriaSource: 'human',
            verification: {
              type: 'file_exists',
              path: 'nonexistent/file.ts',
              deterministic: true,
              canSatisfyFinalGate: true,
              advisoryOnly: false,
              evidenceRefs: [],
            },
            requiredEvidence: ['diff'],
          },
        ],
      }],
    });

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-hold-001',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.CRITERIA_PARTIAL);
  });

  test('HOLD when all criteria are advisory/llm_advisory/manual_review', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'All advisory.',
        implementation: {
          instructions: ['Review only.'],
        },
        artifactPolicy: {
          class: 'documentation',
          wiringRequired: false,
          reachabilityRequired: false,
          executionRequired: false,
          deterministicEvidenceRequired: false,
          advisoryReviewAllowed: true,
        },
        acceptanceCriteria: [
          {
            id: 'AC-LLM',
            description: 'LLM advisory.',
            level: 'advisory',
            humanApproved: true,
            criteriaSource: 'human',
            verification: {
              type: 'llm_advisory',
              deterministic: false,
              canSatisfyFinalGate: false,
              advisoryOnly: true,
              evidenceRefs: [],
            },
            requiredEvidence: ['llm_advisory'],
          },
          {
            id: 'AC-MANUAL',
            description: 'Manual review.',
            level: 'advisory',
            humanApproved: true,
            criteriaSource: 'human',
            verification: {
              type: 'manual_review',
              deterministic: false,
              canSatisfyFinalGate: false,
              advisoryOnly: false,
              evidenceRefs: [],
            },
            requiredEvidence: ['manual_review'],
          },
        ],
      }],
    });

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-hold-002',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.NO_DETERMINISTIC_CRITERIA);
  });

  test('HOLD when prior gate failed', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Prior gate failed.',
        implementation: {
          instructions: ['Fix prior gate.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [passCriterion('AC-01')],
      }],
    });

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-hold-003',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'FAIL' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.PRIOR_GATE_NOT_PASS);
  });

  test('HOLD when file not found', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'File missing.',
        implementation: {
          instructions: ['Create missing file.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [{
          id: 'AC-NOFILE',
          description: 'File must exist.',
          level: 'required',
          humanApproved: true,
          criteriaSource: 'human',
          verification: {
            type: 'file_exists',
            path: 'nonexistent/path/to/missing.ts',
            deterministic: true,
            canSatisfyFinalGate: true,
            advisoryOnly: false,
            evidenceRefs: [],
          },
          requiredEvidence: ['diff'],
        }],
      }],
    });

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-hold-004',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.FILE_NOT_FOUND);
  });

  test('HOLD when criterion not human-approved', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Agent-drafted criterion.',
        implementation: {
          instructions: ['Approve criteria.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [{
          id: 'AC-AGENT',
          description: 'Agent-drafted criterion.',
          level: 'required',
          humanApproved: false,
          criteriaSource: 'agent_draft',
          verification: {
            type: 'file_exists',
            path: 'packages/kernel/package.json',
            deterministic: true,
            canSatisfyFinalGate: true,
            advisoryOnly: false,
            evidenceRefs: [],
          },
          requiredEvidence: ['diff'],
        }],
      }],
    });

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-hold-005',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.CRITERION_NOT_HUMAN_APPROVED);
  });

  test('HOLD when no criteria defined', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'No criteria.',
        implementation: {
          instructions: ['Define criteria.'],
        },
        artifactPolicy: {
          class: 'documentation',
          wiringRequired: false,
          reachabilityRequired: false,
          executionRequired: false,
          deterministicEvidenceRequired: false,
        },
        acceptanceCriteria: [],
      }],
    });

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-hold-006',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.NO_CRITERIA_DEFINED);
    expect(result.totalCriteria).toBe(0);
  });

  test('HOLD when test failures detected', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Tests must pass.',
        implementation: {
          instructions: ['Fix tests.'],
        },
        artifactPolicy: {
          class: 'test_only',
          wiringRequired: false,
          reachabilityRequired: false,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [{
          id: 'AC-TESTS',
          description: 'All tests pass.',
          level: 'required',
          humanApproved: true,
          criteriaSource: 'human',
          verification: {
            type: 'test_output',
            commandRef: 'CMD-TEST',
            deterministic: true,
            canSatisfyFinalGate: true,
            advisoryOnly: false,
            evidenceRefs: [],
          },
          requiredEvidence: ['test_output'],
        }],
      }],
    });

    const commandResults = [
      makeCommandResult({
        commandId: 'CMD-TEST',
        kind: 'final_validation',
        verdict: 'HOLD',
        exitCode: 1,
        stdoutTruncated: '2 failed, 29 passed',
      }),
    ];

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-hold-007',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults,
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.TEST_FAILURES);
  });

  test('HOLD when integration contract check fails (wiringResult with non-PASS verdict)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Integration contract must pass.',
        implementation: {
          instructions: ['Fix wiring.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [{
          id: 'AC-IC',
          description: 'Integration contract satisfied.',
          level: 'required',
          humanApproved: true,
          criteriaSource: 'human',
          verification: {
            type: 'integration_contract',
            deterministic: true,
            canSatisfyFinalGate: true,
            advisoryOnly: false,
            evidenceRefs: [],
          },
          requiredEvidence: ['wiring'],
        }],
      }],
    });

    // Build a wiringResult with FAIL verdict
    const wiringResult = {
      gateName: 'WiringGate' as const,
      verdict: 'FAIL' as const,
      reasonCodes: ['DECLARED_UNIT_MISSING'],
      diagnostics: [],
      failedCriteriaIds: [],
      evidenceRefs: [],
      attemptId: 'final-test-ic',
      timestamp: '2026-06-22T00:00:00Z',
      declaredUnitsChecked: 1,
      declaredUnitsMatched: 0,
      exportsMissing: [],
      orphanModules: [],
      entrypointsMissing: [],
      integrationPointsMissing: [],
      modeInconsistent: false,
      declaredUnitResults: [],
      exportSurfaceResults: [],
      entrypointResults: [],
      integrationPointResults: [],
    };

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-ic',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults: [],
      wiringResult,
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'FAIL' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.INTEGRATION_CONTRACT_FAILED);
  });

  test('HOLD when command_output criterion fails (command verdict is HOLD)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'Command output must match.',
        implementation: {
          instructions: ['Fix command.'],
        },
        artifactPolicy: {
          class: 'test_only',
          wiringRequired: false,
          reachabilityRequired: false,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [{
          id: 'AC-CMD',
          description: 'Command output passes.',
          level: 'required',
          humanApproved: true,
          criteriaSource: 'human',
          verification: {
            type: 'command_output',
            commandRef: 'CMD-X',
            patterns: ['expected output'],
            deterministic: true,
            canSatisfyFinalGate: true,
            advisoryOnly: false,
            evidenceRefs: [],
          },
          requiredEvidence: ['command'],
        }],
      }],
    });

    const commandResults = [
      makeCommandResult({
        commandId: 'CMD-X',
        kind: 'final_validation',
        verdict: 'HOLD',
        exitCode: 1,
        stdoutTruncated: 'error: something went wrong',
      }),
    ];

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-cmd-hold',
      repoRoot: REPO_ROOT,
      evidenceRecords: [],
      commandResults,
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.COMMAND_OUTPUT_MISMATCH);
  });
});

// ===========================================================================
// FinalGate FAIL
// ===========================================================================

describe('FinalGate FAIL', () => {
  test('FAIL when forbidden diff content found', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Test Task',
        objective: 'No forbidden patterns.',
        implementation: {
          instructions: ['Avoid forbidden patterns.'],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [{
          id: 'AC-NO-BAD',
          description: 'No forbidden diff content.',
          level: 'required',
          humanApproved: true,
          criteriaSource: 'human',
          verification: {
            type: 'no_diff_contains',
            patterns: ['DROP TABLE'],
            deterministic: true,
            canSatisfyFinalGate: true,
            advisoryOnly: false,
            evidenceRefs: [],
          },
          requiredEvidence: ['diff'],
        }],
      }],
    });

    const evidenceRecords = [
      makeEvidenceRecord({
        type: 'diff',
        summary: 'DROP TABLE users; -- destructive operation',
        criterionId: 'AC-NO-BAD',
      }),
    ];

    const result = runFinalGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'final-test-fail-001',
      repoRoot: REPO_ROOT,
      evidenceRecords,
      commandResults: [],
      priorGateVerdicts: makePriorGateVerdicts([
        { gateName: 'SchemaGate', verdict: 'PASS' },
        { gateName: 'LockGate', verdict: 'PASS' },
        { gateName: 'EvidenceGate', verdict: 'PASS' },
        { gateName: 'WiringGate', verdict: 'PASS' },
        { gateName: 'ExecGate', verdict: 'PASS' },
      ]),
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(FINAL_REASON_CODES.FORBIDDEN_DIFF_CONTENT);
  });
});
