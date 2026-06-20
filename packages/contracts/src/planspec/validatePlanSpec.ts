// @praxis/contracts — Combined Validation Pipeline
// Runs parse → schema validate → semantic validate → canonicalize → hash.

import { parsePlanSpecYaml } from './parsePlanSpecYaml';
import { readPlanSpecSchema } from './readPlanSpecSchema';
import { validatePlanSpecSchema } from './validatePlanSpecSchema';
import { validatePlanSpecSemantics } from './validatePlanSpecSemantics';
import { canonicalizePlanSpec } from './canonicalizePlanSpec';
import { hashPlanSpec, type PlanHashes } from './hashPlanSpec';
import type { PlanSpecV01 } from './types';
import type { Diagnostic } from './diagnostics';

export type { PlanHashes } from './hashPlanSpec';

export interface ValidationResult {
  /** True when all stages pass (no errors). */
  ok: boolean;
  /** The validated PlanSpec (set when ok, may be partial on error). */
  plan?: PlanSpecV01;
  /** All diagnostics across all stages. */
  diagnostics: Diagnostic[];
  /** Warnings only (severity='warning'). */
  warnings: Diagnostic[];
  /** Errors only (severity='error'). Non-empty means ok=false. */
  errors: Diagnostic[];
  /** Computed hashes (set when canonicalization succeeds). */
  hashes?: PlanHashes;
}

/**
 * Full validation pipeline:
 * 1. Parse YAML string
 * 2. Load and validate against canonical schema
 * 3. Run semantic rules
 * 4. Canonicalize and hash
 *
 * @param yamlString — raw YAML content of a PlanSpec file.
 * @param repoRoot — path to repo root for schema resolution.
 */
export function validatePlanSpec(yamlString: string, repoRoot?: string): ValidationResult {
  const allDiagnostics: Diagnostic[] = [];

  // Stage 1: PARSE_YAML
  const parseResult = parsePlanSpecYaml(yamlString);
  allDiagnostics.push(...parseResult.diagnostics);

  if (!parseResult.ok || !parseResult.data) {
    return buildResult(allDiagnostics);
  }

  // Stage 2: SCHEMA_VALIDATE
  const root = repoRoot ?? process.cwd();
  const schemaResult = readPlanSpecSchema(root);
  allDiagnostics.push(...schemaResult.diagnostics);

  if (!schemaResult.ok || !schemaResult.schema) {
    return buildResult(allDiagnostics);
  }

  const schemaValidation = validatePlanSpecSchema(parseResult.data, schemaResult.schema);
  allDiagnostics.push(...schemaValidation.diagnostics);

  if (!schemaValidation.ok) {
    return buildResult(allDiagnostics);
  }

  // At this point, we have a schema-valid plan
  const plan = parseResult.data as PlanSpecV01;

  // Stage 3: SEMANTIC_VALIDATE
  const semanticResult = validatePlanSpecSemantics(plan);
  allDiagnostics.push(...semanticResult.diagnostics);

  if (!semanticResult.ok) {
    return buildResult(allDiagnostics, plan);
  }

  // Stage 4: CANONICALIZE_AND_HASH
  let hashes: PlanHashes | undefined;
  try {
    canonicalizePlanSpec(plan); // Verify canonicalization works
    hashes = hashPlanSpec(plan);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    allDiagnostics.push({
      code: 'CANONICALIZATION_FAILED',
      severity: 'error',
      message: `Canonicalization or hashing failed: ${msg}`,
    });
    return buildResult(allDiagnostics, plan);
  }

  // All stages passed
  return buildResult(allDiagnostics, plan, hashes);
}

function buildResult(
  diagnostics: Diagnostic[],
  plan?: PlanSpecV01,
  hashes?: PlanHashes,
): ValidationResult {
  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity === 'warning');

  return {
    ok: errors.length === 0,
    plan,
    diagnostics,
    warnings,
    errors,
    hashes,
  };
}
