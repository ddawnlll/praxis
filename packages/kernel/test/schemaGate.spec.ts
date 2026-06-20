// @praxis/kernel — SchemaGate Tests

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSchemaGate } from '../src/gates/schemaGate';
import { SCHEMA_REASON_CODES } from '../src/diagnostics';

const REPO_ROOT = resolve(import.meta.dir, '../../..');

function loadYaml(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf-8');
}

describe('SchemaGate', () => {
  test('returns PASS for valid runtime-code example (planYaml)', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const verdict = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT, attemptId: 'test-001' });

    expect(verdict.gateName).toBe('SchemaGate');
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.reasonCodes).toContain(SCHEMA_REASON_CODES.SCHEMA_PASS);
    expect(verdict.hashes).toBeDefined();
    expect(verdict.hashes!.planHash).toHaveLength(64);
    expect(verdict.plan).toBeDefined();
  });

  test('returns PASS for valid documentation example (planYaml)', () => {
    const yaml = loadYaml('examples/planspec/documentation.plan.yaml');
    const verdict = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    expect(verdict.verdict).toBe('PASS');
    expect(verdict.hashes).toBeDefined();
  });

  test('returns PASS for valid plan via planPath', () => {
    const planPath = resolve(REPO_ROOT, 'examples/planspec/test-only.plan.yaml');
    const verdict = runSchemaGate({ planPath, repoRoot: REPO_ROOT });

    expect(verdict.verdict).toBe('PASS');
    expect(verdict.hashes).toBeDefined();
  });

  test('returns FAIL for invalid YAML', () => {
    const verdict = runSchemaGate({
      planYaml: '{{{ bad yaml :::',
      repoRoot: REPO_ROOT,
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(SCHEMA_REASON_CODES.YAML_PARSE_ERROR);
  });

  test('returns FAIL for schema-invalid fixture (code artifact mode:none)', () => {
    const yaml = loadYaml('fixtures/planspec/fail/code-artifact-mode-none.plan.yaml');
    const verdict = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    expect(verdict.verdict).toBe('FAIL');
    const hasSchemaInvalid = verdict.reasonCodes.some(c =>
      c === SCHEMA_REASON_CODES.PLAN_SCHEMA_INVALID ||
      c === SCHEMA_REASON_CODES.PLAN_SEMANTIC_INVALID,
    );
    expect(hasSchemaInvalid).toBe(true);
  });

  test('returns FAIL for unapproved FinalGate criterion', () => {
    const yaml = loadYaml('fixtures/planspec/fail/unapproved-finalgate-criterion.plan.yaml');
    const verdict = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    expect(verdict.verdict).toBe('FAIL');
  });

  test('returns FAIL for empty input', () => {
    const verdict = runSchemaGate({ repoRoot: REPO_ROOT });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.reasonCodes).toContain(SCHEMA_REASON_CODES.PLAN_FILE_EMPTY);
  });

  test('returns PASS for valid planObject', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const { parsePlanSpecYaml } = require('@praxis/contracts');
    const parsed = parsePlanSpecYaml(yaml);
    expect(parsed.ok).toBe(true);

    const verdict = runSchemaGate({
      planObject: parsed.data,
      repoRoot: REPO_ROOT,
    });

    expect(verdict.verdict).toBe('PASS');
    expect(verdict.hashes).toBeDefined();
  });

  test('output includes hashes on PASS', () => {
    const yaml = loadYaml('examples/planspec/runtime-code.plan.yaml');
    const verdict = runSchemaGate({ planYaml: yaml, repoRoot: REPO_ROOT });

    expect(verdict.verdict).toBe('PASS');
    expect(verdict.hashes).toBeDefined();
    expect(verdict.hashes!.planHash).toBeTruthy();
    expect(verdict.hashes!.acceptanceCriteriaHash).toBeTruthy();
  });
});
