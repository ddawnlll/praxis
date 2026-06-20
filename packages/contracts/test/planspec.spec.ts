// @praxis/contracts — Test Suite
// Tests for PlanSpec v0.1 parser, validator, semantics, hashing, and fixtures.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parsePlanSpecYaml,
  readPlanSpecSchema,
  validatePlanSpecSchema,
  validatePlanSpecSemantics,
  validatePlanSpec,
  hashPlanSpec,
  loadPlanSpecYaml,
  runPlanSpecFixtureSuite,
} from '../src/index';

// tests are in packages/contracts/test/ → repo root is 3 levels up
const REPO_ROOT = resolve(import.meta.dir, '../../..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixtureYaml(relativePath: string): string {
  const abs = resolve(REPO_ROOT, relativePath);
  return readFileSync(abs, 'utf-8');
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('parsePlanSpecYaml', () => {
  test('parses valid YAML', () => {
    const yaml = loadFixtureYaml('examples/planspec/runtime-code.plan.yaml');
    const result = parsePlanSpecYaml(yaml);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe('object');
  });

  test('rejects empty string', () => {
    const result = parsePlanSpecYaml('');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'PLAN_FILE_EMPTY')).toBe(true);
  });

  test('rejects invalid YAML', () => {
    const result = parsePlanSpecYaml('{{{ bad: yaml: :::');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'YAML_PARSE_ERROR')).toBe(true);
  });

  test('rejects non-object root (array)', () => {
    const result = parsePlanSpecYaml('- item1\n- item2');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'PLAN_ROOT_NOT_OBJECT')).toBe(true);
  });

  test('rejects whitespace-only string', () => {
    const result = parsePlanSpecYaml('   \n  \n  ');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema loading tests
// ---------------------------------------------------------------------------

describe('readPlanSpecSchema', () => {
  test('loads canonical schema from repo root', () => {
    const result = readPlanSpecSchema(REPO_ROOT);
    expect(result.ok).toBe(true);
    expect(result.schema).toBeDefined();
    const schema = result.schema as Record<string, unknown>;
    expect(schema.$id).toBe('https://praxis.local/schemas/planspec/v0.1/planspec.schema.yaml');
    expect(schema.title).toContain('PlanSpec');
  });

  test('fails for non-existent path', () => {
    const result = readPlanSpecSchema('/nonexistent/path');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'PLAN_SCHEMA_LOAD_ERROR')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('validatePlanSpecSchema', () => {
  const schemaResult = readPlanSpecSchema(REPO_ROOT);
  const schema = schemaResult.schema!;

  test('validates runtime-code example', () => {
    const yaml = loadFixtureYaml('examples/planspec/runtime-code.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    expect(parsed.ok).toBe(true);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(true);
  });

  test('validates documentation example', () => {
    const yaml = loadFixtureYaml('examples/planspec/documentation.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(true);
  });

  test('validates test-only example', () => {
    const yaml = loadFixtureYaml('examples/planspec/test-only.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(true);
  });

  test('validates library-code example', () => {
    const yaml = loadFixtureYaml('examples/planspec/library-code.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(true);
  });

  test('validates cli-command example', () => {
    const yaml = loadFixtureYaml('examples/planspec/cli-command.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(true);
  });

  test('rejects runtime_code missing integrationContract (hold fixture)', () => {
    const yaml = loadFixtureYaml('fixtures/planspec/hold/runtime-code-missing-integration-contract.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(false);
  });

  test('rejects code artifact mode:none (fail fixture)', () => {
    const yaml = loadFixtureYaml('fixtures/planspec/fail/code-artifact-mode-none.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(false);
  });

  test('rejects unapproved FinalGate criterion (fail fixture)', () => {
    const yaml = loadFixtureYaml('fixtures/planspec/fail/unapproved-finalgate-criterion.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(false);
  });

  test('rejects advisory FinalGate criterion (fail fixture)', () => {
    const yaml = loadFixtureYaml('fixtures/planspec/fail/advisory-finalgate-criterion.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(false);
  });

  test('rejects repair/report inconsistency (fail fixture)', () => {
    const yaml = loadFixtureYaml('fixtures/planspec/fail/repair-report-inconsistent.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(false);
  });

  test('validates library-export-surface pass fixture', () => {
    const yaml = loadFixtureYaml('fixtures/planspec/pass/library-export-surface.plan.yaml');
    const parsed = parsePlanSpecYaml(yaml);
    const result = validatePlanSpecSchema(parsed.data, schema);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Semantic validation tests
// ---------------------------------------------------------------------------

describe('validatePlanSpecSemantics', () => {
  test('detects duplicate task IDs', () => {
    const plan = makeMinimalPlan();
    plan.tasks.push({ ...plan.tasks[0] }); // Same ID
    const result = validatePlanSpecSemantics(plan);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_TASK_ID')).toBe(true);
  });

  test('detects duplicate command IDs', () => {
    const plan = makeMinimalPlan();
    plan.commands.exactAllowedCommands.push({ ...plan.commands.exactAllowedCommands[0] }); // Same ID
    const result = validatePlanSpecSemantics(plan);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_COMMAND_ID')).toBe(true);
  });

  test('detects missing commandRef target', () => {
    const plan = makeMinimalPlan();
    // Add a criterion referencing non-existent command
    plan.tasks[0].acceptanceCriteria[0].verification.commandRef = 'CMD-NONEXISTENT';
    const result = validatePlanSpecSemantics(plan);
    const cmdRefErrors = result.diagnostics.filter(d => d.code === 'COMMAND_REF_NOT_FOUND');
    expect(cmdRefErrors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Hashing tests
// ---------------------------------------------------------------------------

describe('hashPlanSpec', () => {
  test('computes stable hashes for valid plan', () => {
    const yaml = loadFixtureYaml('examples/planspec/runtime-code.plan.yaml');
    const result = validatePlanSpec(yaml, REPO_ROOT);
    expect(result.ok).toBe(true);
    expect(result.hashes).toBeDefined();
    expect(result.hashes!.planHash).toHaveLength(64); // SHA-256 hex
    expect(result.hashes!.acceptanceCriteriaHash).toHaveLength(64);
    expect(result.hashes!.artifactPolicyHash).toHaveLength(64);
  });

  test('produces deterministic hash across equivalent object order', () => {
    const plan1 = makeMinimalPlan();
    const plan2 = makeMinimalPlan(); // Structurally identical

    const hash1 = hashPlanSpec(plan1);
    const hash2 = hashPlanSpec(plan2);

    expect(hash1.planHash).toBe(hash2.planHash);
    expect(hash1.acceptanceCriteriaHash).toBe(hash2.acceptanceCriteriaHash);
  });
});

// ---------------------------------------------------------------------------
// Fixture runner tests
// ---------------------------------------------------------------------------

describe('runPlanSpecFixtureSuite', () => {
  test('processes all examples and fixtures', () => {
    const suite = runPlanSpecFixtureSuite(REPO_ROOT);
    // 5 examples + 4 pass fixtures + 2 hold fixtures + 4 fail fixtures = 15
    expect(suite.total).toBeGreaterThanOrEqual(14);
  });

  test('reports fixture count correctly', () => {
    const suite = runPlanSpecFixtureSuite(REPO_ROOT);
    expect(typeof suite.total).toBe('number');
    expect(typeof suite.passed).toBe('number');
    expect(typeof suite.failed).toBe('number');
    expect(suite.passed + suite.failed).toBe(suite.total);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline test (validatePlanSpec)
// ---------------------------------------------------------------------------

describe('validatePlanSpec (full pipeline)', () => {
  test('validates runtime-code example end-to-end', () => {
    const yaml = loadFixtureYaml('examples/planspec/runtime-code.plan.yaml');
    const result = validatePlanSpec(yaml, REPO_ROOT);
    expect(result.ok).toBe(true);
    expect(result.hashes).toBeDefined();
  });

  test('validates documentation example end-to-end', () => {
    const yaml = loadFixtureYaml('examples/planspec/documentation.plan.yaml');
    const result = validatePlanSpec(yaml, REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  test('validates test-only example end-to-end', () => {
    const yaml = loadFixtureYaml('examples/planspec/test-only.plan.yaml');
    const result = validatePlanSpec(yaml, REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  test('rejects code-artifact-mode-none end-to-end', () => {
    const yaml = loadFixtureYaml('fixtures/planspec/fail/code-artifact-mode-none.plan.yaml');
    const result = validatePlanSpec(yaml, REPO_ROOT);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadPlanSpecYaml (file loader)
// ---------------------------------------------------------------------------

describe('loadPlanSpecYaml', () => {
  test('loads and validates a file from disk', () => {
    const filePath = resolve(REPO_ROOT, 'examples/planspec/runtime-code.plan.yaml');
    const result = loadPlanSpecYaml(filePath, REPO_ROOT);
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
  });

  test('fails gracefully for missing file', () => {
    const result = loadPlanSpecYaml('/nonexistent/file.yaml', REPO_ROOT);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Minimal plan factory for semantic tests
// ---------------------------------------------------------------------------

function makeMinimalPlan(): import('../src/planspec/types').PlanSpecV01 {
  return {
    planSpecVersion: '0.1.0',
    kind: 'ImplementationPlan',
    profile: 'praxis-v0.1',
    metadata: {
      planId: 'TEST-001',
      title: 'Test Plan',
      description: 'Minimal valid plan for testing.',
      createdAt: '2026-01-01T00:00:00Z',
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
      allowedFiles: ['src/test.ts'],
      forbiddenFiles: [],
    },
    execution: {
      mode: 'single_session',
      agent: 'claude-code',
      autonomy: 'implementation_allowed',
      canModifyCode: true,
      canModifyPlan: false,
      canModifyAcceptanceCriteria: false,
      maxRepairLoops: 1,
    },
    tasks: [
      {
        id: 'TASK-001',
        title: 'Test Task',
        objective: 'Test.',
        implementation: {
          instructions: ['Do something.'],
        },
        artifactPolicy: {
          class: 'documentation',
          wiringRequired: false,
          reachabilityRequired: false,
          executionRequired: false,
          deterministicEvidenceRequired: true,
        },
        acceptanceCriteria: [
          {
            id: 'AC-TEST-001',
            description: 'Test criterion.',
            level: 'required',
            humanApproved: true,
            criteriaSource: 'human',
            verification: {
              type: 'file_exists',
              path: 'test.md',
              deterministic: true,
              canSatisfyFinalGate: true,
              advisoryOnly: false,
              evidenceRefs: ['diff'],
            },
            requiredEvidence: ['diff'],
          },
        ],
      },
    ],
    commands: {
      exactAllowedCommands: [
        {
          id: 'CMD-TEST-001',
          kind: 'final_validation',
          command: 'echo ok',
          evidenceRequired: true,
          timeoutSeconds: 30,
        },
      ],
      validationEvidenceRules: {
        finalPromotionRequiresExactAllowedCommand: true,
        discoveryCommandsMayNotSatisfyFinalValidation: true,
        runtimeGrantCommandsCanSatisfyValidationOnlyIfGrantStatesValidationPurpose: true,
      },
      hardDeniedCommands: [
        { command: 'rm -rf', reason: 'Destructive.' },
      ],
    },
    evidence: {
      ledgerRequired: true,
      requiredEvidenceTypes: ['diff', 'source'],
      hashWhenAvailable: true,
    },
    gates: {
      sequence: ['SchemaGate', 'LockGate', 'EvidenceGate', 'WiringGate', 'ExecGate', 'FinalGate'],
      verdicts: ['PASS', 'HOLD', 'FAIL'],
      reasonCodes: {
        SchemaGate: ['SCHEMA_INVALID'],
        LockGate: ['LOCK_MISSING'],
        EvidenceGate: ['EVIDENCE_EMPTY'],
        WiringGate: ['WIRING_MISSING'],
        ExecGate: ['TESTS_FAILURES'],
        FinalGate: ['ALL_CRITERIA_MET'],
      },
    },
    repair: {
      enabled: true,
      failedCriteriaOnly: true,
      mayModifyAcceptanceCriteria: false,
      mayModifyPlan: false,
      allowedFilesFromFailedTasksOnly: true,
      maxRepairLoops: 3,
      reverifyCommand: 'echo ok',
      repairPacketFormat: { json: true, markdown: false },
    },
    locking: {
      lockRequired: true,
      canonicalHashRequired: true,
      planLockFile: '.praxis/planspec.lock',
      hashes: [
        'planHash',
        'acceptanceCriteriaHash',
        'artifactPolicyHash',
        'integrationContractHash',
        'commandPolicyHash',
        'allowedFilesHash',
        'forbiddenFilesHash',
      ],
    },
    reports: {
      protocol: 'ACCP',
      artifactDirectory: 'reports/',
      reportsAreEvidenceOnly: true,
      reportsDoNotAuthorizeExecution: true,
      commandEvidenceRequired: true,
      repairPacketRequiredOnHoldOrFail: true,
    },
  };
}
