// @praxis/kernel — WiringGate Tests
// Tests for WiringGate: declared unit matching, export surface verification,
// entrypoints, integration points, orphan detection, and mode validation.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWiringGate } from '../src/gates/wiringGate';
import { WIRING_REASON_CODES } from '../src/diagnostics';
import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const FIXTURE_DIR = resolve(REPO_ROOT, '.praxis/test-wiring');
const FIXTURE_MODULE = resolve(FIXTURE_DIR, 'healthRouter.ts');
const FIXTURE_SURFACE = resolve(FIXTURE_DIR, 'index.ts');
const FIXTURE_INTEGRATION = resolve(FIXTURE_DIR, 'server.ts');
const FIXTURE_ENTRYPOINT = resolve(FIXTURE_DIR, 'main.ts');

// ---------------------------------------------------------------------------
// Test fixture setup
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

/**
 * Build a minimal synthetic PlanSpecV01 with the given tasks.
 * Most fields are filled with safe defaults — only the fields
 * relevant to WiringGate are customized per-test.
 */
function buildPlan(overrides: Partial<PlanSpecV01> = {}): PlanSpecV01 {
  return {
    planSpecVersion: '0.1.0',
    kind: 'ImplementationPlan',
    profile: 'praxis-v0.1',
    metadata: {
      planId: 'WIRING-TEST-001',
      title: 'WiringGate Test Plan',
      description: 'Synthetic plan for WiringGate tests.',
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
    workspace: {
      root: '.',
      allowedFiles: [],
      forbiddenFiles: [],
    },
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

// ===========================================================================
// Setup / teardown
// ===========================================================================

beforeAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // Create a module with known exports
  writeFileSync(FIXTURE_MODULE,
    `export function healthRouter() { return 'ok'; }\n` +
    `export const VERSION = '1.0';\n` +
    `export class HealthCheck {}\n`,
  );

  // Create a surface (index) file with required exports
  writeFileSync(FIXTURE_SURFACE,
    `export { healthRouter } from './healthRouter';\n` +
    `export { VERSION } from './healthRouter';\n`,
  );

  // Create an integration point file with known imports
  writeFileSync(FIXTURE_INTEGRATION,
    `import { healthRouter } from './healthRouter';\n` +
    `import express from 'express';\n` +
    `const app = express();\n` +
    `app.use('/health', healthRouter);\n`,
  );

  // Create an entrypoint file
  writeFileSync(FIXTURE_ENTRYPOINT,
    `import './server';\n` +
    `console.log('Server started');\n`,
  );
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ===========================================================================
// WiringGate PASS
// ===========================================================================

describe('WiringGate PASS', () => {
  test('PASS when all declared units exist with expected exports', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-01',
        title: 'Health Endpoint',
        objective: 'Create health endpoint.',
        implementation: {
          instructions: ['Create health router.'],
          allowedFiles: ['.praxis/test-wiring/healthRouter.ts'],
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
          declaredUnits: [{
            id: 'health-route',
            path: '.praxis/test-wiring/healthRouter.ts',
            kind: 'runtime_module',
            expectedExports: ['healthRouter', 'VERSION', 'HealthCheck'],
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['.praxis/test-wiring/healthRouter.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-pass-001',
      repoRoot: REPO_ROOT,
    });

    expect(result.gateName).toBe('WiringGate');
    expect(result.verdict).toBe('PASS');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.WIRING_PASS);
    expect(result.declaredUnitsChecked).toBe(1);
    expect(result.declaredUnitsMatched).toBe(1);
  });

  test('PASS when no integrationContract (task skipped)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-no-ic',
        title: 'Documentation Task',
        objective: 'Write docs.',
        implementation: {
          instructions: ['Write README.'],
        },
        artifactPolicy: {
          class: 'documentation',
          wiringRequired: false,
          reachabilityRequired: false,
          executionRequired: false,
          deterministicEvidenceRequired: false,
        },
        // No integrationContract
        acceptanceCriteria: [],
      }],
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-pass-002',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('PASS');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.WIRING_PASS);
  });

  test('PASS for test-only task (skipped — no integrationContract)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-test-only',
        title: 'Test Suite',
        objective: 'Write tests.',
        implementation: {
          instructions: ['Add tests.'],
        },
        artifactPolicy: {
          class: 'test_only',
          wiringRequired: false,
          reachabilityRequired: false,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [],
      }],
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-pass-003',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('PASS');
  });

  test('PASS for documentation task (skipped — no integrationContract)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-doc',
        title: 'Documentation',
        objective: 'Write documentation.',
        implementation: {
          instructions: ['Update docs.'],
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

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-pass-004',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('PASS');
  });
});

// ===========================================================================
// WiringGate FAIL
// ===========================================================================

describe('WiringGate FAIL', () => {
  test('FAIL when declared unit path does not exist', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-missing',
        title: 'Missing Unit',
        objective: 'Create missing file.',
        implementation: {
          instructions: ['Create file.'],
          allowedFiles: ['nonexistent/path/module.ts'],
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
          reason: 'Unit must exist.',
          declaredUnits: [{
            id: 'missing-unit',
            path: 'nonexistent/path/module.ts',
            kind: 'runtime_module',
            expectedExports: ['someFunc'],
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['nonexistent/path/module.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-fail-001',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.DECLARED_UNIT_MISSING);
  });

  test('FAIL when export surface path does not exist', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-missing-surface',
        title: 'Missing Surface',
        objective: 'Wire surface.',
        implementation: {
          instructions: ['Wire surface.'],
          allowedFiles: ['nonexistent/surface.ts'],
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
          reason: 'Surface must exist.',
          exportSurfaces: [{
            id: 'missing-surface',
            path: 'nonexistent/surface.ts',
            requiredExports: ['someExport'],
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['nonexistent/surface.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-fail-002',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.EXPORT_SURFACE_MISSING);
  });
});

// ===========================================================================
// WiringGate HOLD
// ===========================================================================

describe('WiringGate HOLD', () => {
  test('HOLD when expected export not found in file', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-missing-export',
        title: 'Missing Export',
        objective: 'File exists but export missing.',
        implementation: {
          instructions: ['Add export.'],
          allowedFiles: ['.praxis/test-wiring/healthRouter.ts'],
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
          reason: 'Must have exports.',
          declaredUnits: [{
            id: 'health-route',
            path: '.praxis/test-wiring/healthRouter.ts',
            kind: 'runtime_module',
            expectedExports: ['healthRouter', 'NonExistentExport'],
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['.praxis/test-wiring/healthRouter.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-001',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.EXPORT_NOT_FOUND);
  });

  test('HOLD when required export missing from exportSurface', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-surface-missing-export',
        title: 'Surface Missing Export',
        objective: 'Surface file exists but export missing.',
        implementation: {
          instructions: ['Add export.'],
          allowedFiles: ['.praxis/test-wiring/index.ts'],
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
          reason: 'Exports required.',
          exportSurfaces: [{
            id: 'index-surface',
            path: '.praxis/test-wiring/index.ts',
            requiredExports: ['NonExistentReExport'],
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['.praxis/test-wiring/index.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-002',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.REQUIRED_EXPORT_MISSING);
  });

  test('HOLD when entrypoint not found', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-missing-entrypoint',
        title: 'Missing Entrypoint',
        objective: 'Entrypoint file not found.',
        implementation: {
          instructions: ['Create entrypoint.'],
          allowedFiles: ['nonexistent/entry.ts'],
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
          reason: 'Entrypoint required.',
          entrypoints: [{
            id: 'missing-ep',
            path: 'nonexistent/entry.ts',
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['nonexistent/entry.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-003',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.ENTRYPOINT_NOT_FOUND);
  });

  test('HOLD when integration point not found', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-missing-ip',
        title: 'Missing Integration Point',
        objective: 'Integration point file not found.',
        implementation: {
          instructions: ['Create integration point.'],
          allowedFiles: ['nonexistent/integration.ts'],
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
          reason: 'Integration point required.',
          integrationPoints: [{
            id: 'missing-ip',
            path: 'nonexistent/integration.ts',
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['nonexistent/integration.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-004',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.INTEGRATION_POINT_NOT_FOUND);
  });

  test('HOLD when expected import not found', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-missing-import',
        title: 'Missing Import',
        objective: 'File exists but import missing.',
        implementation: {
          instructions: ['Add import.'],
          allowedFiles: ['.praxis/test-wiring/server.ts'],
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
          reason: 'Import must exist.',
          integrationPoints: [{
            id: 'server-ip',
            path: '.praxis/test-wiring/server.ts',
            expectedImports: ['NonExistentImport'],
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['.praxis/test-wiring/server.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-005',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.EXPECTED_IMPORT_MISSING);
  });

  test('HOLD when orphan modules detected', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-orphan',
        title: 'Orphan Module',
        objective: 'File in allowedFiles not in any declared unit.',
        implementation: {
          instructions: ['Wire modules.'],
          allowedFiles: ['.praxis/test-wiring/orphan.ts'],
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
          reason: 'All modules must be declared.',
          declaredUnits: [{
            id: 'health-route',
            path: '.praxis/test-wiring/healthRouter.ts',
            kind: 'runtime_module',
          }],
        },
        acceptanceCriteria: [],
      }],
      workspace: {
        root: '.',
        allowedFiles: ['.praxis/test-wiring/orphan.ts'],
        forbiddenFiles: [],
      },
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-006',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.ORPHAN_MODULES_DETECTED);
    expect(result.orphanModules).toContain('.praxis/test-wiring/orphan.ts');
  });

  test('HOLD when wiring mode inconsistent (mode=none with declaredUnits)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-mode-inconsistent',
        title: 'Mode Inconsistent',
        objective: 'Mode is none but units are declared.',
        implementation: {
          instructions: ['Fix mode.'],
          allowedFiles: [],
        },
        artifactPolicy: {
          class: 'runtime_code',
          wiringRequired: true,
          reachabilityRequired: true,
          executionRequired: true,
          deterministicEvidenceRequired: true,
        },
        integrationContract: {
          mode: 'none',
          reason: 'No wiring needed.',
          declaredUnits: [{
            id: 'unit-should-not-exist',
            path: '.praxis/test-wiring/healthRouter.ts',
            kind: 'runtime_module',
          }],
        },
        acceptanceCriteria: [],
      }],
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-007',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.WIRING_MODE_INCONSISTENT);
    expect(result.modeInconsistent).toBe(true);
  });

  test('HOLD when wiring mode declared but empty (mode=required with no declarations)', () => {
    const plan = buildPlan({
      tasks: [{
        id: 'task-mode-empty',
        title: 'Mode Empty',
        objective: 'Mode requires declarations but none provided.',
        implementation: {
          instructions: ['Add declarations.'],
          allowedFiles: [],
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
          reason: 'Wiring required but empty.',
          // No declaredUnits, integrationPoints, or exportSurfaces
        },
        acceptanceCriteria: [],
      }],
    });

    const result = runWiringGate({
      plan,
      hashes: fakeHashes(),
      attemptId: 'wiring-test-hold-008',
      repoRoot: REPO_ROOT,
    });

    expect(result.verdict).toBe('HOLD');
    expect(result.reasonCodes).toContain(WIRING_REASON_CODES.WIRING_MODE_DECLARED_BUT_EMPTY);
    expect(result.modeInconsistent).toBe(true);
  });
});
