// @praxis/contracts — YAML Parser
// Parses a YAML string into an unknown object.

import YAML from 'yaml';
import { Diagnostic, error } from './diagnostics';

export interface ParseResult {
  /** Parsed object, or undefined if parse failed. */
  data: unknown | undefined;
  /** Diagnostics from parsing. Errors mean parsing failed. */
  diagnostics: Diagnostic[];
  /** Whether parsing succeeded (no YAML errors, not empty, root is object). */
  ok: boolean;
}

/**
 * Parse a PlanSpec YAML string.
 * Returns the parsed unknown object on success, or diagnostics on failure.
 */
export function parsePlanSpecYaml(yamlString: string): ParseResult {
  const diagnostics: Diagnostic[] = [];

  // Check for empty input
  if (!yamlString || yamlString.trim().length === 0) {
    diagnostics.push(error('PLAN_FILE_EMPTY', 'PlanSpec YAML string is empty.'));
    return { data: undefined, diagnostics, ok: false };
  }

  // Parse YAML
  let data: unknown;
  try {
    data = YAML.parse(yamlString);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push(error('YAML_PARSE_ERROR', `Failed to parse YAML: ${msg}`));
    return { data: undefined, diagnostics, ok: false };
  }

  // Check result is not null/undefined
  if (data === null || data === undefined) {
    diagnostics.push(error('PLAN_FILE_EMPTY', 'PlanSpec YAML parsed to null or undefined.'));
    return { data: undefined, diagnostics, ok: false };
  }

  // Root must be an object
  if (typeof data !== 'object' || Array.isArray(data)) {
    diagnostics.push(error('PLAN_ROOT_NOT_OBJECT', `PlanSpec root must be an object, got ${Array.isArray(data) ? 'array' : typeof data}.`));
    return { data: undefined, diagnostics, ok: false };
  }

  return { data, diagnostics, ok: true };
}
