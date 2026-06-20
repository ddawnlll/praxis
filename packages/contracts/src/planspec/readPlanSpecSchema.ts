// @praxis/contracts — Schema Reader
// Loads the canonical PlanSpec v0.1 schema from disk.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { Diagnostic, error } from './diagnostics';

export interface SchemaLoadResult {
  /** The loaded schema object, or undefined. */
  schema: unknown | undefined;
  /** Diagnostics from loading. */
  diagnostics: Diagnostic[];
  /** Whether loading succeeded. */
  ok: boolean;
}

/**
 * Load the canonical PlanSpec v0.1 schema from the default path.
 * The schema is at <repoRoot>/schemas/planspec.v0.1.schema.yaml.
 *
 * @param basePath — repo root path (defaults to process.cwd()).
 *   From the contracts package at packages/contracts, this should be '../..'.
 */
export function readPlanSpecSchema(basePath?: string): SchemaLoadResult {
  const diagnostics: Diagnostic[] = [];
  const root = basePath ?? process.cwd();
  const schemaPath = resolve(root, 'schemas', 'planspec.v0.1.schema.yaml');

  let raw: string;
  try {
    raw = readFileSync(schemaPath, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push(error('PLAN_SCHEMA_LOAD_ERROR', `Failed to read schema file at ${schemaPath}: ${msg}`));
    return { schema: undefined, diagnostics, ok: false };
  }

  if (!raw || raw.trim().length === 0) {
    diagnostics.push(error('PLAN_SCHEMA_LOAD_ERROR', `Schema file at ${schemaPath} is empty.`));
    return { schema: undefined, diagnostics, ok: false };
  }

  let schema: unknown;
  try {
    schema = YAML.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push(error('PLAN_SCHEMA_LOAD_ERROR', `Failed to parse schema YAML at ${schemaPath}: ${msg}`));
    return { schema: undefined, diagnostics, ok: false };
  }

  if (schema === null || schema === undefined || typeof schema !== 'object') {
    diagnostics.push(error('PLAN_SCHEMA_LOAD_ERROR', `Schema at ${schemaPath} is not a valid object.`));
    return { schema: undefined, diagnostics, ok: false };
  }

  return { schema, diagnostics, ok: true };
}
