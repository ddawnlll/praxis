// @praxis/kernel — LockGate Tests

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync, existsSync, unlinkSync, rmdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSchemaGate } from '../src/gates/schemaGate';
import { runLockGate } from '../src/gates/lockGate';
import { createPlanLock } from '../src/lock/createPlanLock';
import { readPlanLockYaml } from '../src/lock/readPlanLockYaml';
import { writePlanLockYaml } from '../src/lock/writePlanLockYaml';
import { verifyPlanLock } from '../src/lock/verifyPlanLock';
import { LOCK_REASON_CODES } from '../src/diagnostics';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const TEST_LOCK_DIR = resolve(REPO_ROOT, '.praxis/locks/test');
const TEST_LOCK_PATH = resolve(TEST_LOCK_DIR, 'test.lock.yaml');

function loadYaml(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf-8');
}

function cleanupLockDir(): void {
  if (existsSync(TEST_LOCK_PATH)) unlinkSync(TEST_LOCK_PATH);
  try { rmdirSync(TEST_LOCK_DIR); } catch {}
}

beforeAll(() => { cleanupLockDir(); mkdirSync(TEST_LOCK_DIR, { recursive: true }); });
afterAll(() => { cleanupLockDir(); });

describe('LockGate — create_if_missing', () => {
  const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
  const schemaVerdict = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

  test('creates lock file and returns PASS with LOCK_CREATED', () => {
    // Clean up first
    if (existsSync(TEST_LOCK_PATH)) unlinkSync(TEST_LOCK_PATH);

    const verdict = runLockGate({
      plan: schemaVerdict.plan!,
      hashes: schemaVerdict.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'create_if_missing',
    });

    expect(verdict.gateName).toBe('LockGate');
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.LOCK_CREATED);
    expect(existsSync(TEST_LOCK_PATH)).toBe(true);
  });

  test('verify_existing returns PASS when hashes match', () => {
    const verdict = runLockGate({
      plan: schemaVerdict.plan!,
      hashes: schemaVerdict.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('PASS');
  });
});

describe('LockGate — verify_existing', () => {
  test('returns HOLD when lock is missing', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const nonexistentPath = resolve(TEST_LOCK_DIR, 'nonexistent.lock.yaml');
    if (existsSync(nonexistentPath)) unlinkSync(nonexistentPath);

    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: nonexistentPath,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('HOLD');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.MISSING_PLAN_LOCK);
  });

  test('returns FAIL when planHash mismatches', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    // Create a lock first
    runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'create_if_missing',
    });

    // Tamper with hashes
    const badHashes = { ...sv.hashes!, planHash: '0'.repeat(64) };
    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: badHashes,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.PLAN_LOCK_HASH_MISMATCH);
  });

  test('returns FAIL with specific code when acceptanceCriteriaHash mismatches', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'create_if_missing',
    });

    const badHashes = { ...sv.hashes!, acceptanceCriteriaHash: '0'.repeat(64) };
    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: badHashes,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.CRITERIA_CHANGED_AFTER_LOCK);
  });

  test('returns FAIL when artifactPolicyHash mismatches', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'create_if_missing',
    });

    const badHashes = { ...sv.hashes!, artifactPolicyHash: '0'.repeat(64) };
    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: badHashes,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.ARTIFACT_POLICY_CHANGED_AFTER_LOCK);
  });

  test('returns FAIL when integrationContractHash mismatches', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'create_if_missing',
    });

    const badHashes = { ...sv.hashes!, integrationContractHash: '0'.repeat(64) };
    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: badHashes,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.INTEGRATION_CONTRACT_CHANGED_AFTER_LOCK);
  });

  test('returns FAIL with planId mismatch', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const lock = createPlanLock(sv.plan!, sv.hashes!);
    lock.planId = 'DIFFERENT-PLAN-ID';
    writePlanLockYaml(lock, TEST_LOCK_PATH);

    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.PLAN_ID_MISMATCH);
  });
});

describe('LockGate — bad lock YAML', () => {
  test('returns FAIL with PLAN_LOCK_PARSE_ERROR for bad YAML', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    writePlanLockYaml({ broken: 'not a lock' } as any, TEST_LOCK_PATH);

    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.PLAN_LOCK_PARSE_ERROR);
  });

  test('returns FAIL for version mismatch', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const lock = createPlanLock(sv.plan!, sv.hashes!);
    (lock as any).lockVersion = 'praxis-plan-lock/v0.0';
    writePlanLockYaml(lock, TEST_LOCK_PATH);

    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'verify_existing',
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(LOCK_REASON_CODES.PLAN_LOCK_VERSION_MISMATCH);
  });
});

describe('LockGate — refresh_explicit', () => {
  test('overwrites lock and returns PASS', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const verdict = runLockGate({
      plan: sv.plan!,
      hashes: sv.hashes!,
      lockPath: TEST_LOCK_PATH,
      mode: 'refresh_explicit',
    });

    expect(verdict.verdict).toBe('PASS');
    expect(existsSync(TEST_LOCK_PATH)).toBe(true);

    // Verify the lock is valid
    const readResult = readPlanLockYaml(TEST_LOCK_PATH);
    expect(readResult.ok).toBe(true);
    expect(readResult.lock!.planId).toBe(sv.plan!.metadata.planId);
  });
});

describe('PlanLock helpers', () => {
  test('createPlanLock produces valid YAML-serializable lock', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const lock = createPlanLock(sv.plan!, sv.hashes!, {
      planPath: 'examples/planspec/runtime-code.plan.yaml',
    });

    expect(lock.lockVersion).toBe('praxis-plan-lock/v0.1');
    expect(lock.planId).toBe(sv.plan!.metadata.planId);
    expect(lock.hashes.planHash).toBe(sv.hashes!.planHash);
    expect(lock.source.schemaPath).toBe('schemas/archive/v0.1/planspec.v0.1.schema.yaml');
  });

  test('readPlanLockYaml reads a valid lock', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const lock = createPlanLock(sv.plan!, sv.hashes!);
    writePlanLockYaml(lock, TEST_LOCK_PATH);

    const readResult = readPlanLockYaml(TEST_LOCK_PATH);
    expect(readResult.ok).toBe(true);
    expect(readResult.lock!.planId).toBe(sv.plan!.metadata.planId);
  });

  test('verifyPlanLock detects hash mismatches', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const lock = createPlanLock(sv.plan!, sv.hashes!);
    const badHashes = { ...sv.hashes!, allowedFilesHash: '0'.repeat(64) };

    const result = verifyPlanLock(badHashes, lock);
    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain(LOCK_REASON_CODES.ALLOWED_FILES_CHANGED_AFTER_LOCK);
  });

  test('lock file is YAML format, not JSON', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const sv = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    const lock = createPlanLock(sv.plan!, sv.hashes!);
    writePlanLockYaml(lock, TEST_LOCK_PATH);

    const raw = readFileSync(TEST_LOCK_PATH, 'utf-8');
    // YAML files start with key: value, not { or [
    expect(raw.trim().startsWith('{')).toBe(false);
    expect(raw).toContain('lockVersion:');
    expect(raw).toContain('planId:');
    expect(raw).toContain('planHash:');
  });
});
