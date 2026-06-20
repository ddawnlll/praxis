// @praxis/contracts — Loader (file read + parse + schema validate)
// Convenience: reads a PlanSpec YAML file from disk, parses it,
// loads the canonical schema, and runs schema validation.

import { readFileSync } from 'node:fs';
import { parsePlanSpecYaml } from './parsePlanSpecYaml';
import { readPlanSpecSchema } from './readPlanSpecSchema';
import { validatePlanSpecSchema } from './validatePlanSpecSchema';
import { Diagnostic } from './diagnostics';
import type { PlanSpecV01 } from './types';

export interface LoadResult {
  /** Whether the full load+parse+schema-validate pipeline passed. */
  ok: boolean;
  /** Parsed and typed plan (only set if ok). */
  plan?: PlanSpecV01;
  /** All diagnostics from all stages. */
  diagnostics: Diagnostic[];
}

/**
 * Load a PlanSpec YAML file, parse it, load the schema, and validate.
 *
 * @param filePath — absolute or relative path to the .plan.yaml file.
 * @param repoRoot — path to repo root for schema resolution (default: process.cwd()).
 */
export function loadPlanSpecYaml(filePath: string, repoRoot?: string): LoadResult {
  const allDiagnostics: Diagnostic[] = [];

  // 1. Read file
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    allDiagnostics.push({
      code: 'YAML_PARSE_ERROR',
      severity: 'error',
      message: `Failed to read file ${filePath}: ${msg}`,
      path: filePath,
    });
    return { ok: false, diagnostics: allDiagnostics };
  }

  // 2. Parse YAML
  const parseResult = parsePlanSpecYaml(raw);
  allDiagnostics.push(...parseResult.diagnostics);

  if (!parseResult.ok || !parseResult.data) {
    return { ok: false, diagnostics: allDiagnostics };
  }

  // 3. Load schema
  const root = repoRoot ?? process.cwd();
  const schemaResult = readPlanSpecSchema(root);
  allDiagnostics.push(...schemaResult.diagnostics);

  if (!schemaResult.ok || !schemaResult.schema) {
    return { ok: false, diagnostics: allDiagnostics };
  }

  // 4. Schema validate
  const schemaValidation = validatePlanSpecSchema(parseResult.data, schemaResult.schema);
  allDiagnostics.push(...schemaValidation.diagnostics);

  if (!schemaValidation.ok) {
    return { ok: false, diagnostics: allDiagnostics };
  }

  // Success — cast to PlanSpecV01
  return {
    ok: true,
    plan: parseResult.data as PlanSpecV01,
    diagnostics: allDiagnostics,
  };
}
