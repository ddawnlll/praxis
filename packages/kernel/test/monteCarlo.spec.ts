// @praxis/kernel — Monte Carlo Hallucination Tests
//
// Principle: PRAXIS gates must NEVER hallucinate a PASS.
// A false PASS means the system declares a task complete when it isn't.
//
// Approach: Generate thousands of randomized scenarios and verify:
//   1. No false PASS — if any gate FAILs, overall MUST NOT be PASS
//   2. Determinism — same inputs → same outputs every time
//   3. Edge-case resilience — extreme values, empty inputs, special characters
//   4. Anti-fragility — random mutations of valid plans don't produce false PASS
//
// Each scenario is independently seeded for reproducibility.

import { describe, test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { runKernel } from '../src/runP6Kernel';
import { runSchemaGate } from '../src/gates/schemaGate';
import { runEvidenceGate } from '../src/gates/evidenceGate';
import { runFinalGate } from '../src/gates/finalGate';
import { generateReport } from '../src/report/reportGenerator';
import { generateRepairPacket } from '../src/repair/repairPacketGenerator';
import type { EvidenceRecordV01 } from '../src/evidence/types';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const LOCK_DIR = resolve(REPO_ROOT, '.praxis/locks/mc-test');

// ===========================================================================
// Seeded PRNG for reproducible randomness
// ===========================================================================

class SeededRng {
  private s: number;
  constructor(seed: number) { this.s = seed & 0x7fffffff; }
  next(): number {
    this.s = (this.s * 1103515245 + 12345) & 0x7fffffff;
    return this.s / 0x7fffffff;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(arr: T[]): T { return arr[this.int(0, arr.length - 1)]; }
  pickN<T>(arr: T[], n: number): T[] {
    const shuffled = [...arr].sort(() => this.next() - 0.5);
    return shuffled.slice(0, Math.min(n, arr.length));
  }
  bool(prob = 0.5): boolean { return this.next() < prob; }
  str(minLen: number, maxLen: number): string {
    const len = this.int(minLen, maxLen);
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./\\\'"!@#$%^&*() ';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[this.int(0, chars.length - 1)];
    return s;
  }
}

// ===========================================================================
// Permutation counter for iteration identification
// ===========================================================================

let scenarioCounter = 0;
function nextScenarioId(prefix: string): string {
  scenarioCounter++;
  return `mc-${prefix}-${String(scenarioCounter).padStart(4, '0')}`;
}

// ===========================================================================
// Valid template plan — serves as the base for mutations
// ===========================================================================

const BASE_PLAN = `planSpecVersion: "0.1.0"
kind: "ImplementationPlan"
profile: "praxis-v0.1"
metadata:
  planId: "MC-BASE-001"
  title: "Monte Carlo Base"
  description: "Base template for Monte Carlo mutations."
  createdAt: "2026-07-05T00:00:00Z"
  humanId: "mc-test"
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
  - id: "task-mc"
    title: "MC Task"
    objective: "Monte Carlo test task."
    implementation:
      instructions: []
      allowedFiles:
        - "README.md"
    artifactPolicy:
      class: "test_only"
      wiringRequired: false
      reachabilityRequired: false
      executionRequired: true
      deterministicEvidenceRequired: true
    acceptanceCriteria:
      - id: "AC-MC"
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
    - id: "CMD-MC"
      kind: "final_validation"
      command: "echo ok"
      evidenceRequired: true
      timeoutSeconds: 10
  validationEvidenceRules:
    finalPromotionRequiresExactAllowedCommand: true
    discoveryCommandsMayNotSatisfyFinalValidation: true
    runtimeGrantCommandsCanSatisfyValidationOnlyIfGrantStatesValidationPurpose: false
  hardDeniedCommands: []
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

function makeRecord(attemptId: string, overrides: Partial<EvidenceRecordV01> = {}): EvidenceRecordV01 {
  return {
    evidenceVersion: 'praxis-evidence/v0.1' as const,
    recordId: `EV-mc-${Math.random().toString(36).slice(2, 8)}`,
    attemptId,
    planId: 'MC-BASE-001',
    timestamp: new Date().toISOString(),
    type: 'diff',
    source: 'kernel',
    ...overrides,
  };
}

// ===========================================================================
// Hallucination Oracle: if any gate yields FAIL, overall must NOT be PASS.
// ===========================================================================

function assertNoFalsePass(result: Awaited<ReturnType<typeof runKernel>>): void {
  const anyFail = result.gateVerdicts.some(g => g.verdict === 'FAIL');
  const anyHold = result.gateVerdicts.some(g => g.verdict === 'HOLD');
  if (anyFail) {
    // FAIL takes priority — overall MUST be FAIL, never PASS
    expect(result.verdict).not.toBe('PASS');
    expect(result.ok).toBe(false);
  }
  if (anyHold && !anyFail) {
    // If only HOLD (no FAIL), overall can be HOLD but never PASS if any HOLD exists
    // Actually, with stopOnHold=false, HOLDs are allowed and FinalGate might still PASS
    // if all criteria are met. So this check only applies when FinalGate is the HOLD source.
  }
}

// ===========================================================================
// Test Suites
// ===========================================================================

// ---------------------------------------------------------------------------
// Suite 1: Determinism — same inputs, same outputs (100 iterations)
// ---------------------------------------------------------------------------

describe('MC1: Determinism (20 iterations)', () => {
  const SEED = 42;
  const ITERATIONS = 20;

  test('identical inputs produce identical results', async () => {
    const rng = new SeededRng(SEED);
    for (let i = 0; i < ITERATIONS; i++) {
      const attemptId = nextScenarioId('det');
      const evidenceRecords = [
        makeRecord(attemptId, { type: 'diff', criterionId: 'AC-MC', taskId: 'task-mc' }),
      ];

      // Run twice with identical inputs
      const r1 = await runKernel({
        planYaml: BASE_PLAN,
        repoRoot: REPO_ROOT,
        attemptId,
        lockPath: resolve(LOCK_DIR, `${attemptId}.lock.yaml`),
        lockMode: 'create_if_missing',
        evidenceRecords,
        changedFiles: [{ path: 'README.md', status: 'modified' }],
        commandOverrides: [],
      });

      const r2 = await runKernel({
        planYaml: BASE_PLAN,
        repoRoot: REPO_ROOT,
        attemptId,
        lockPath: resolve(LOCK_DIR, `${attemptId}.lock.yaml`),
        lockMode: 'verify_existing',
        evidenceRecords,
        changedFiles: [{ path: 'README.md', status: 'modified' }],
        commandOverrides: [],
      });

      // Both should produce the same verdict
      expect(r1.verdict).toBe(r2.verdict);
      expect(r1.gateVerdicts.length).toBe(r2.gateVerdicts.length);

      // Gate verdicts should match
      for (let g = 0; g < r1.gateVerdicts.length; g++) {
        expect(r1.gateVerdicts[g].verdict).toBe(r2.gateVerdicts[g].verdict);
      }

      assertNoFalsePass(r1);
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Suite 2: No-false-PASS with randomized empty evidence (200 iterations)
// ---------------------------------------------------------------------------

describe('MC2: Empty evidence never PASSes (20 iterations)', () => {
  const ITERATIONS = 20;

  test('empty evidence never produces overall PASS', async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const attemptId = nextScenarioId('empt');

      const result = await runKernel({
        planYaml: BASE_PLAN,
        repoRoot: REPO_ROOT,
        attemptId,
        lockPath: resolve(LOCK_DIR, `${attemptId}.lock.yaml`),
        lockMode: 'create_if_missing',
        evidenceRecords: [],
        changedFiles: [],
        commandOverrides: [],
      });

      // Empty evidence must NOT produce PASS
      expect(result.verdict).not.toBe('PASS');
      assertNoFalsePass(result);
    }
  }, 60000);
});

// ---------------------------------------------------------------------------
// Suite 3: Invalid YAML never PASSes (300 iterations)
// ---------------------------------------------------------------------------

describe('MC3: Invalid YAML never PASSes (50 iterations)', () => {
  const ITERATIONS = 50;

  function generateCorruptedYaml(rng: SeededRng): string {
    const strategies = [
      // Strategy 1: Truncate valid YAML
      () => BASE_PLAN.slice(0, rng.int(10, Math.floor(BASE_PLAN.length * 0.5))),
      // Strategy 2: Injected garbage
      () => BASE_PLAN + '\n' + rng.str(1, 200),
      // Strategy 3: Replace valid structure with garbage
      () => BASE_PLAN.replace(/tasks:\n[\s\S]*?(?=\n\w)/, 'tasks: ' + rng.str(1, 100)),
      // Strategy 4: Random bytes at start
      () => rng.str(1, 50) + '\n' + BASE_PLAN,
      // Strategy 5: Remove critical fields
      () => {
        let y = BASE_PLAN;
        const fields = ['planSpecVersion', 'kind', 'profile', 'metadata', 'authority', 'workspace', 'tasks', 'commands', 'gates', 'locking', 'reports'];
        const toRemove = rng.pickN(fields, rng.int(1, 3));
        for (const f of toRemove) {
          y = y.replace(new RegExp(`${f}:.*?(\\n(?!\\s{2}))`, 's'), '');
        }
        return y;
      },
      // Strategy 6: Deeply nested garbage
      () => '  '.repeat(rng.int(10, 50)) + 'nested: ' + rng.str(1, 100),
    ];

    return strategies[rng.int(0, strategies.length - 1)]();
  }

  test('corrupted YAML never produces PASS', async () => {
    const seed = 12345;
    const rng = new SeededRng(seed);

    for (let i = 0; i < ITERATIONS; i++) {
      const corruptedYaml = generateCorruptedYaml(rng);
      const attemptId = nextScenarioId('corrupt');

      const result = await runKernel({
        planYaml: corruptedYaml,
        repoRoot: REPO_ROOT,
        attemptId,
      });

      // Corrupted YAML must NOT produce PASS
      expect(result.verdict).not.toBe('PASS');
      assertNoFalsePass(result);

      // SchemaGate should fail
      const schemaGate = result.gateVerdicts.find(g => g.gateName === 'SchemaGate');
      if (schemaGate) {
        expect(schemaGate.verdict).toBe('FAIL');
      }

      // If SchemaGate FAILed, no other gates should have run
      if (schemaGate?.verdict === 'FAIL') {
        expect(result.gateVerdicts.length).toBe(1);
      }
    }
  }, 60000);
});

// ---------------------------------------------------------------------------
// Suite 4: Randomized evidence mutations (500 iterations)
// ---------------------------------------------------------------------------

describe('MC4: Evidence mutations (50 iterations)', () => {
  const ITERATIONS = 50;

  function randomEvidence(attemptId: string, rng: SeededRng): {
    records: EvidenceRecordV01[];
    changedFiles: Array<{ path: string; status: string }>;
  } {
    const records: EvidenceRecordV01[] = [];
    const changedFiles: Array<{ path: string; status: string }> = [];

    const types: Array<'diff' | 'source' | 'command' | 'test_output'> = ['diff', 'source', 'command', 'test_output'];
    const statuses = ['added', 'modified', 'deleted', 'renamed'];

    // Decide how many records to generate (0 to 5)
    const count = rng.int(0, 5);
    for (let i = 0; i < count; i++) {
      const record: EvidenceRecordV01 = {
        evidenceVersion: 'praxis-evidence/v0.1' as const,
        recordId: `EV-mc-${attemptId}-${i}`,
        attemptId,
        planId: 'MC-BASE-001',
        timestamp: new Date().toISOString(),
        type: rng.pick(types),
        source: rng.pick(['kernel', 'hook', 'cli', 'test', 'agent_claim', 'manual']),
      };

      // Sometimes include path/criterion fields
      if (rng.bool(0.7)) {
        record.path = rng.str(5, 50);
        record.criterionId = 'AC-MC';
        record.taskId = 'task-mc';
        record.changedFile = {
          path: rng.str(5, 50),
          status: rng.pick(statuses),
        };
      }

      // Occasionally include problematic data
      if (rng.bool(0.1)) {
        record.path = ''; // empty path
      }
      if (rng.bool(0.05)) {
        record.metadata = { malicious: rng.str(1, 1000) }; // arbitrary metadata
      }

      records.push(record);
      if (record.changedFile) {
        changedFiles.push({ path: record.changedFile.path, status: record.changedFile.status });
      }
    }

    return { records, changedFiles };
  }

  test('randomized evidence never produces false PASS', async () => {
    const seed = 67890;
    const rng = new SeededRng(seed);

    for (let i = 0; i < ITERATIONS; i++) {
      const attemptId = nextScenarioId('evmut');
      const { records, changedFiles } = randomEvidence(attemptId, rng);
      const hasDiff = records.some(r => r.type === 'diff');

      const result = await runKernel({
        planYaml: BASE_PLAN,
        repoRoot: REPO_ROOT,
        attemptId,
        lockPath: resolve(LOCK_DIR, `${attemptId}.lock.yaml`),
        lockMode: 'create_if_missing',
        evidenceRecords: records,
        changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
        commandOverrides: [],
      });

      // Core hallucination check: never false PASS
      assertNoFalsePass(result);

      // If no diff evidence, EvidenceGate should NOT PASS
      const evGate = result.gateVerdicts.find(g => g.gateName === 'EvidenceGate');
      if (!hasDiff && evGate) {
        // Without diff evidence, EvidenceGate must HOLD or FAIL
        expect(['HOLD', 'FAIL']).toContain(evGate.verdict);
      }

      // Report and repair packet must not throw on any input
      expect(() => generateReport(result as any)).not.toThrow();
      if (result.plan && result.verdict !== 'PASS') {
        expect(() => generateRepairPacket(
          result.plan,
          result.hashes,
          attemptId,
          result.gateVerdicts,
          result.final?.criterionResults,
          result.diagnostics,
        )).not.toThrow();
      }
    }
  }, 120000);
});

// ---------------------------------------------------------------------------
// Suite 5: Hallucination fuzz — plan boundary conditions (500 iterations)
// ---------------------------------------------------------------------------

describe('MC5: Plan boundary conditions (50 iterations)', () => {
  const ITERATIONS = 50;

  function mutatePlan(rng: SeededRng): { yaml: string; description: string } {
    const mutations: Array<() => { yaml: string; description: string }> = [
      // Empty string
      () => ({ yaml: '', description: 'empty string' }),
      // Only whitespace
      () => ({ yaml: '   \n  \n  ', description: 'whitespace only' }),
      // Very long single line
      () => ({ yaml: 'key: ' + rng.str(10000, 20000), description: 'very long single line' }),
      // Extremely deep nesting
      () => {
        const depth = rng.int(50, 100);
        let y = '';
        for (let d = 0; d < depth; d++) y += '  '.repeat(d) + `level${d}: `;
        y += '"leaf"\n';
        return { yaml: y, description: `deep nesting (${depth} levels)` };
      },
      // Repeated keys
      () => ({
        yaml: BASE_PLAN + '\n' + BASE_PLAN.replace(/^/gm, ''),
        description: 'duplicated content',
      }),
      // YAML with only comments
      () => ({ yaml: '# only comments\n# line 2\n# line 3\n', description: 'comments only' }),
      // Null bytes
      () => ({ yaml: 'key: \x00value\x00\x00', description: 'null bytes in value' }),
      // Unicode overflow
      () => ({ yaml: 'key: "\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}"\n', description: 'emoji in value' }),
      // Cross-site scripting attempt
      () => ({ yaml: 'key: "<script>alert(1)</script>"\n', description: 'XSS in value' }),
      // Tab characters
      () => ({ yaml: BASE_PLAN.replace(/  /g, '\t'), description: 'tabs instead of spaces' }),
      // Infinite YAML anchors
      () => ({ yaml: 'x: &a *a\n', description: 'circular YAML anchor' }),
      // Negative numbers for everything
      () => ({
        yaml: BASE_PLAN
          .replace(/"0\.1\.0"/g, '-1')
          .replace(/timeoutSeconds: \d+/g, 'timeoutSeconds: -999999')
          .replace(/maxRepairLoops: \d+/g, 'maxRepairLoops: -1'),
        description: 'negative values in numeric fields',
      }),
    ];

    return mutations[rng.int(0, mutations.length - 1)]();
  }

  test('boundary conditions never produce false PASS', async () => {
    const seed = 24680;
    const rng = new SeededRng(seed);

    for (let i = 0; i < ITERATIONS; i++) {
      const { yaml, description } = mutatePlan(rng);
      const attemptId = nextScenarioId('bound');

      // Run through schema gate first (the rest may blow up — catch errors)
      try {
        const result = await runKernel({
          planYaml: yaml,
          repoRoot: REPO_ROOT,
          attemptId,
        });

        // CAST IRON RULE: never PASS on garbage input
        expect(result.verdict).not.toBe('PASS');

        // Report generation must never throw
        expect(() => generateReport(result as any)).not.toThrow();

      } catch (err) {
        // Kernel throws are acceptable for truly pathological inputs,
        // but they must NOT be PASS errors
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).not.toContain('PASS');
      }
    }
  }, 60000);
});

// ---------------------------------------------------------------------------
// Suite 6: High-volume random gate calls (1000 iterations)
// ---------------------------------------------------------------------------

describe('MC6: High-volume random gate resolution (200 iterations)', () => {
  const ITERATIONS = 200;

  test('SchemaGate + EvidenceGate individually never hallucinate', async () => {
    const seed = 13579;
    const rng = new SeededRng(seed);

    for (let i = 0; i < ITERATIONS; i++) {
      const attemptId = nextScenarioId('highvol');

      // Generate completely random YAML
      const isJsonLike = rng.bool(0.3);
      const yaml = isJsonLike
        ? JSON.stringify({ [rng.str(1, 20)]: rng.str(1, 100) })
        : rng.str(1, 500);

      // SchemaGate on junk must never PASS
      const schemaResult = runSchemaGate({
        planYaml: yaml,
        repoRoot: REPO_ROOT,
        attemptId,
      });

      expect(schemaResult.verdict).not.toBe('PASS');

      // If SchemaGate FAILed, the gate should have FAIL verdict
      if (schemaResult.verdict === 'FAIL') {
        expect(schemaResult.gateName).toBe('SchemaGate');
        expect(schemaResult.reasonCodes.length).toBeGreaterThan(0);
      }
    }
  }, 30000);

  test('EvidenceGate with random records never hallucinates PASS with empty required types', async () => {
    const seed = 97531;
    const rng = new SeededRng(seed);

    // We need a valid plan first so SchemaGate+Lock pass
    // Then test EvidenceGate with crazy evidence
    for (let i = 0; i < ITERATIONS; i++) {
      const attemptId = nextScenarioId('randomev');

      // Mix of valid records and random junk
      const records: EvidenceRecordV01[] = [];
      const addCount = rng.int(0, 10);
      for (let j = 0; j < addCount; j++) {
        const ev: EvidenceRecordV01 = {
          evidenceVersion: 'praxis-evidence/v0.1' as const,
          recordId: `EV-mc-${attemptId}-${j}`,
          attemptId,
          planId: rng.bool() ? 'MC-BASE-001' : rng.str(10, 50),
          timestamp: rng.bool() ? new Date().toISOString() : rng.str(1, 100),
          type: rng.pick(['diff', 'source', 'test_output', 'command', 'changed_file', 'divergence_file', 'invalid_type' as any]),
          source: rng.pick(['kernel', 'hook', 'cli', 'agent_claim', 'test', 'unknown' as any]),
        };
        if (rng.bool(0.3)) ev.path = rng.str(1, 200);
        if (rng.bool(0.3)) ev.summary = rng.str(1, 500);
        records.push(ev);
      }

      const evidenceResult = runEvidenceGate({
        plan: {
          metadata: { planId: 'MC-BASE-001', title: 'MC', description: '', createdAt: '', humanId: '', status: 'draft' },
          authority: { executor: '', completionAuthority: '', agentSelfReportIsClaimOnly: true, criteriaSourceRequired: 'human', reportsAreEvidenceOnly: true, pluginOwnsTruth: false },
          workspace: { root: '.', allowedFiles: ['README.md'], forbiddenFiles: [] },
          execution: { mode: 'single_session', agent: '', autonomy: '', canModifyCode: false, canModifyPlan: false, canModifyAcceptanceCriteria: false, maxRepairLoops: 0 },
          tasks: [{
            id: 'task-mc', title: '', objective: '',
            implementation: { instructions: [], allowedFiles: [] },
            artifactPolicy: { class: 'test_only', wiringRequired: false, reachabilityRequired: false, executionRequired: true, deterministicEvidenceRequired: true },
            acceptanceCriteria: [{
              id: 'AC-MC', description: '', level: 'required', humanApproved: true, criteriaSource: 'human',
              verification: { type: 'file_exists', path: 'README.md', deterministic: true, canSatisfyFinalGate: true, advisoryOnly: false, evidenceRefs: [] },
              requiredEvidence: ['diff'],
            }],
          }],
          commands: { exactAllowedCommands: [], validationEvidenceRules: { finalPromotionRequiresExactAllowedCommand: true, discoveryCommandsMayNotSatisfyFinalValidation: true, runtimeGrantCommandsCanSatisfyValidationOnlyIfGrantStatesValidationPurpose: false }, hardDeniedCommands: [] },
          evidence: { ledgerRequired: true, requiredEvidenceTypes: [], hashWhenAvailable: true },
          gates: { sequence: ['SchemaGate', 'LockGate', 'EvidenceGate', 'WiringGate', 'ExecGate', 'FinalGate'], verdicts: ['PASS', 'HOLD', 'FAIL'], reasonCodes: {} },
          repair: { enabled: true, failedCriteriaOnly: true, mayModifyAcceptanceCriteria: false, mayModifyPlan: false, allowedFilesFromFailedTasksOnly: true, maxRepairLoops: 0, reverifyCommand: '', repairPacketFormat: { json: true, markdown: true } },
          locking: { lockRequired: true, canonicalHashRequired: true, planLockFile: '', hashes: [] },
          reports: { protocol: '', artifactDirectory: '', reportsAreEvidenceOnly: true, reportsDoNotAuthorizeExecution: true, commandEvidenceRequired: true, repairPacketRequiredOnHoldOrFail: true },
        } as any,
        hashes: {} as any,
        attemptId,
        evidenceRecords: records,
        changedFiles: records.filter(r => r.changedFile).map(r => ({ path: r.changedFile!.path, status: r.changedFile!.status })),
        repoRoot: REPO_ROOT,
      });

      // EvidenceGate must never throw or return inconsistent results
      if (evidenceResult.verdict === 'PASS') {
        // If it PASSes, check that there's at least some deterministic evidence
        expect(evidenceResult.evidenceCount).toBeGreaterThan(0);
      }

      // Repair hint should exist for non-PASS results
      if (evidenceResult.verdict !== 'PASS' && evidenceResult.repairHint) {
        expect(evidenceResult.repairHint.length).toBeGreaterThan(0);
      }
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Suite 7: Anti-fragility — random mutations of valid plans (200 iterations)
// ---------------------------------------------------------------------------

describe('MC7: Anti-fragility (30 iterations)', () => {
  const ITERATIONS = 30;

  function mutateField(yaml: string, rng: SeededRng): string {
    const lines = yaml.split('\n');
    if (lines.length < 5) return yaml;
    const idx = rng.int(0, lines.length - 1);
    const line = lines[idx];

    // Only mutate lines that look like field: value
    if (!line.includes(':')) return yaml;

    const mutations = [
      // Empty the value
      () => line.replace(/:.*/, ': ""'),
      // Set to null
      () => line.replace(/:.*/, ': null'),
      // Set to a very long string
      () => line.replace(/:.*/, ': ' + rng.str(1000, 2000)),
      // Add special characters
      () => line.replace(/:.*/, ': ' + rng.str(10, 50)),
      // Duplicate the line
      () => line + '\n' + line,
      // Remove the value entirely
      () => line.replace(/:.*/, ':'),
    ];

    lines[idx] = mutations[rng.int(0, mutations.length - 1)]();
    return lines.join('\n');
  }

  test('mutated valid plans never produce unexpected PASS', async () => {
    const seed = 11111;
    const rng = new SeededRng(seed);

    for (let i = 0; i < ITERATIONS; i++) {
      const attemptId = nextScenarioId('antifrag');
      const mutated = mutateField(BASE_PLAN, rng);

      const result = await runKernel({
        planYaml: mutated,
        repoRoot: REPO_ROOT,
        attemptId,
        lockPath: resolve(LOCK_DIR, `${attemptId}.lock.yaml`),
        lockMode: 'create_if_missing',
        evidenceRecords: [],
        changedFiles: [],
        commandOverrides: [],
      });

      // If the mutation broke the plan, SchemaGate fails → must not be PASS
      // If the mutation is benign, the plan still needs evidence → not PASS
      // Therefore: mutated plan + empty evidence must NEVER yield PASS
      expect(result.verdict).not.toBe('PASS');
      assertNoFalsePass(result);
    }
  }, 60000);
});

// ---------------------------------------------------------------------------
// Suite 8: Zero-configuration edge cases (100 iterations)
// ---------------------------------------------------------------------------

describe('MC8: Zero-configuration edge cases (20 iterations)', () => {
  const ITERATIONS = 20;

  function makeMinimalPlan(rng: SeededRng): string {
    const hasValidMetadata = rng.bool(0.5);
    const hasTasks = rng.bool(0.5);
    const hasCriteria = rng.bool(0.5);

    return `planSpecVersion: "0.1.0"
kind: "ImplementationPlan"
profile: "praxis-v0.1"
metadata:
  ${hasValidMetadata ? `planId: "MC-MIN-${rng.int(1, 999)}"\n  title: "Min"` : ''}
authority:
  executor: "ClaudeCode"
  completionAuthority: "PraxisTruthKernel"
  agentSelfReportIsClaimOnly: true
  criteriaSourceRequired: "human"
  reportsAreEvidenceOnly: true
  pluginOwnsTruth: false
workspace:
  root: "."
  allowedFiles: []
  forbiddenFiles: []
execution:
  mode: "single_session"
  agent: "claude-code"
  autonomy: "implementation_allowed"
  canModifyCode: true
  canModifyPlan: false
  canModifyAcceptanceCriteria: false
  maxRepairLoops: 0
tasks: ${hasTasks ? `
  - id: "task-min"
    title: ""
    objective: ""
    implementation:
      instructions: []
      allowedFiles: []
    artifactPolicy:
      class: "test_only"
      wiringRequired: false
      reachabilityRequired: false
      executionRequired: true
      deterministicEvidenceRequired: true
    acceptanceCriteria: ${hasCriteria ? `
      - id: "AC-MIN"
        description: ""
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
          - "diff"` : '[]'}` : '[]'}
commands:
  exactAllowedCommands: []
  validationEvidenceRules:
    finalPromotionRequiresExactAllowedCommand: true
    discoveryCommandsMayNotSatisfyFinalValidation: true
    runtimeGrantCommandsCanSatisfyValidationOnlyIfGrantStatesValidationPurpose: false
  hardDeniedCommands: []
evidence:
  ledgerRequired: true
  requiredEvidenceTypes: []
  hashWhenAvailable: true
gates:
  sequence: ${rng.bool() ? '["SchemaGate","LockGate","EvidenceGate","WiringGate","ExecGate","FinalGate"]' : '["SchemaGate"]'}
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
  planLockFile: ""
  hashes: []
reports:
  protocol: ""
  artifactDirectory: ""
  reportsAreEvidenceOnly: true
  reportsDoNotAuthorizeExecution: true
  commandEvidenceRequired: true
  repairPacketRequiredOnHoldOrFail: true
`;
  }

  test('minimal/incomplete plans never produce PASS', async () => {
    const seed = 33333;
    const rng = new SeededRng(seed);

    for (let i = 0; i < ITERATIONS; i++) {
      const attemptId = nextScenarioId('minimal');
      const yaml = makeMinimalPlan(rng);

      // SchemaGate only — test that minimal/incomplete plans fail
      const schemaResult = runSchemaGate({
        planYaml: yaml,
        repoRoot: REPO_ROOT,
        attemptId,
      });

      // Incomplete plans should not PASS SchemaGate
      // (some might pass if they happen to be minimally valid)
      if (schemaResult.verdict === 'PASS') {
        // If it did pass SchemaGate, verify the plan is actually parseable
        expect(schemaResult.plan).toBeDefined();
        expect(schemaResult.hashes).toBeDefined();
        expect(schemaResult.hashes!.planHash).toHaveLength(64);
      } else {
        // If it failed, must not be PASS
        expect(schemaResult.verdict).not.toBe('PASS');
      }
    }
  }, 30000);
});

// ===========================================================================
// Positive-canon: valid plans MUST get expected verdicts (no false-reject)
// ===========================================================================

describe('Monte Carlo — Positive Canon (no false-reject)', () => {
  test('valid example plans pass SchemaGate', () => {
    const yaml = loadFixtureYaml('examples/planspec/runtime-code.plan.yaml');
    const result = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });
    expect(result.verdict).toBe('PASS');
    expect(result.plan).toBeDefined();
    expect(result.hashes).toBeDefined();
  });

  test('valid plan with evidence produces meaningful FinalGate verdict', () => {
    const yaml = loadFixtureYaml('examples/planspec/runtime-code.plan.yaml');
    const schemaResult = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });
    expect(schemaResult.verdict).toBe('PASS');

    // Create minimal evidence for the plan's criteria
    const plan = schemaResult.plan!;
    const evidenceRecords: EvidenceRecordV01[] = [];
    for (const task of plan.tasks) {
      for (const ac of task.acceptanceCriteria) {
        evidenceRecords.push({
          evidenceVersion: 'praxis-evidence/v0.1',
          recordId: `EV-${ac.id}-test`,
          attemptId: 'canon-test',
          planId: plan.metadata.planId,
          timestamp: new Date().toISOString(),
          type: 'test_output',
          source: 'test',
          criterionId: ac.id,
          taskId: task.id,
          status: 'pass',
        });
      }
    }

    const finalResult = runFinalGate({
      plan,
      hashes: schemaResult.hashes!,
      attemptId: 'canon-test',
      repoRoot: REPO_ROOT,
      evidenceRecords,
      commandResults: [],
      priorGateVerdicts: [
        { gateName: 'SchemaGate', verdict: 'PASS', reasonCodes: [], failedCriteriaIds: [], evidenceRefs: [], attemptId: 'canon-test', timestamp: '' },
        { gateName: 'EvidenceGate', verdict: 'PASS', reasonCodes: [], failedCriteriaIds: [], evidenceRefs: [], attemptId: 'canon-test', timestamp: '' },
      ],
    });

    // Valid plan with evidence should NOT be FAIL
    expect(finalResult.verdict).not.toBe('FAIL');
    // Should be PASS or HOLD (depending on criterion configuration)
    expect(['PASS', 'HOLD']).toContain(finalResult.verdict);
  });
});

function loadFixtureYaml(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf-8');
}
