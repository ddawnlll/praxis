// @praxis/kernel — SchemaGate
// Validates PlanSpec YAML form and semantics using @praxis/contracts.

import { readFileSync } from 'node:fs';
import {
  validatePlanSpec,
  readPlanSpecSchema,
  validatePlanSpecSchema,
  validatePlanSpecSemantics,
  hashPlanSpec,
  type PlanSpecV01,
  type PlanHashes,
  type Diagnostic,
} from '@praxis/contracts';
import type { SchemaGateInput, GateVerdict } from '../types';
import { SCHEMA_REASON_CODES } from '../diagnostics';

/**
 * Run SchemaGate — validates PlanSpec YAML against the canonical schema,
 * runs semantic checks, and produces deterministic PlanHashes.
 */
export function runSchemaGate(input: SchemaGateInput): GateVerdict {
  const attemptId = input.attemptId ?? `schema-${Date.now()}`;
  const repoRoot = input.repoRoot ?? process.cwd();
  const timestamp = new Date().toISOString();

  const reasonCodes: string[] = [];
  const allDiagnostics: Diagnostic[] = [];
  let plan: PlanSpecV01 | undefined;
  let hashes: PlanHashes | undefined;

  if (input.planObject) {
    // Pre-parsed plan object — validate directly
    const schemaResult = readPlanSpecSchema(repoRoot);
    allDiagnostics.push(...schemaResult.diagnostics);

    if (!schemaResult.ok || !schemaResult.schema) {
      reasonCodes.push(SCHEMA_REASON_CODES.PLAN_SCHEMA_LOAD_ERROR);
    } else {
      const schemaValidation = validatePlanSpecSchema(input.planObject, schemaResult.schema);
      allDiagnostics.push(...schemaValidation.diagnostics);

      if (!schemaValidation.ok) {
        reasonCodes.push(SCHEMA_REASON_CODES.PLAN_SCHEMA_INVALID);
      } else {
        const semResult = validatePlanSpecSemantics(input.planObject as PlanSpecV01);
        allDiagnostics.push(...semResult.diagnostics);

        if (!semResult.ok) {
          reasonCodes.push(SCHEMA_REASON_CODES.PLAN_SEMANTIC_INVALID);
        } else {
          plan = input.planObject as PlanSpecV01;
          try {
            hashes = hashPlanSpec(plan);
          } catch {
            reasonCodes.push(SCHEMA_REASON_CODES.PLAN_HASH_FAILED);
          }
        }
      }
    }
  } else if (input.planPath) {
    // Read file, then use full validation pipeline
    let raw: string;
    try {
      raw = readFileSync(input.planPath, 'utf-8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reasonCodes.push(SCHEMA_REASON_CODES.YAML_PARSE_ERROR);
      allDiagnostics.push({
        code: 'YAML_PARSE_ERROR',
        severity: 'error',
        message: `Failed to read plan file at ${input.planPath}: ${msg}`,
      });
      return buildVerdict('SchemaGate', reasonCodes, allDiagnostics, attemptId, timestamp, plan, hashes);
    }

    const result = validatePlanSpec(raw, repoRoot);
    allDiagnostics.push(...result.diagnostics);

    if (result.ok) {
      plan = result.plan;
      hashes = result.hashes;
    } else {
      mapErrorCodes(result.errors, reasonCodes);
    }
  } else if (input.planYaml) {
    const result = validatePlanSpec(input.planYaml, repoRoot);
    allDiagnostics.push(...result.diagnostics);

    if (result.ok) {
      plan = result.plan;
      hashes = result.hashes;
    } else {
      mapErrorCodes(result.errors, reasonCodes);
    }
  } else {
    reasonCodes.push(SCHEMA_REASON_CODES.PLAN_FILE_EMPTY);
    allDiagnostics.push({
      code: 'PLAN_FILE_EMPTY',
      severity: 'error',
      message: 'No planPath, planYaml, or planObject provided to SchemaGate.',
    });
  }

  return buildVerdict('SchemaGate', reasonCodes, allDiagnostics, attemptId, timestamp, plan, hashes);
}

function mapErrorCodes(errors: Diagnostic[], reasonCodes: string[]): void {
  const codeMap: Record<string, string> = {
    YAML_PARSE_ERROR: SCHEMA_REASON_CODES.YAML_PARSE_ERROR,
    PLAN_FILE_EMPTY: SCHEMA_REASON_CODES.PLAN_FILE_EMPTY,
    PLAN_ROOT_NOT_OBJECT: SCHEMA_REASON_CODES.PLAN_ROOT_NOT_OBJECT,
    PLAN_SCHEMA_INVALID: SCHEMA_REASON_CODES.PLAN_SCHEMA_INVALID,
    PLAN_SCHEMA_LOAD_ERROR: SCHEMA_REASON_CODES.PLAN_SCHEMA_LOAD_ERROR,
    PLAN_SCHEMA_REF_ERROR: SCHEMA_REASON_CODES.PLAN_SCHEMA_REF_ERROR,
  };

  for (const d of errors) {
    const mapped = codeMap[d.code] ?? SCHEMA_REASON_CODES.PLAN_SEMANTIC_INVALID;
    reasonCodes.push(mapped);
  }
}

function buildVerdict(
  gateName: string,
  reasonCodes: string[],
  diagnostics: Diagnostic[],
  attemptId: string,
  timestamp: string,
  plan?: PlanSpecV01,
  hashes?: PlanHashes,
): GateVerdict {
  const uniqueCodes = [...new Set(reasonCodes)];
  const verdict = uniqueCodes.length === 0 ? 'PASS' : 'FAIL';

  return {
    gateName,
    verdict,
    reasonCodes: verdict === 'PASS' ? [SCHEMA_REASON_CODES.SCHEMA_PASS] : uniqueCodes,
    failedCriteriaIds: [],
    evidenceRefs: [],
    attemptId,
    timestamp,
    repairHint: verdict === 'FAIL'
      ? 'Fix PlanSpec YAML syntax, schema violations, or semantic errors listed in diagnostics.'
      : undefined,
    diagnostics,
    hashes,
    plan,
  };
}
