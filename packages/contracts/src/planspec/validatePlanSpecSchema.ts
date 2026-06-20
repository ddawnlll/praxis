// @praxis/contracts — Schema Validator
// Validates a YAML-loaded object against the canonical PlanSpec v0.1 schema using AJV.

import Ajv2020, { ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { Diagnostic, error } from './diagnostics';

export interface SchemaValidationResult {
  /** Whether schema validation passed (no errors). */
  ok: boolean;
  /** Schema validation diagnostics. */
  diagnostics: Diagnostic[];
}

/**
 * Validate a parsed PlanSpec object against the given JSON Schema.
 *
 * @param planData — the unknown object from YAML parsing.
 * @param schema — the loaded PlanSpec v0.1 schema object.
 */
export function validatePlanSpecSchema(
  planData: unknown,
  schema: unknown,
): SchemaValidationResult {
  const diagnostics: Diagnostic[] = [];

  // Guard: schema must be provided
  if (!schema || typeof schema !== 'object') {
    diagnostics.push(
      error('PLAN_SCHEMA_LOAD_ERROR', 'Schema is not a valid object; cannot validate.'),
    );
    return { ok: false, diagnostics };
  }

  // Guard: plan data must be an object
  if (!planData || typeof planData !== 'object') {
    diagnostics.push(
      error('PLAN_SCHEMA_INVALID', 'Plan data is not an object.'),
    );
    return { ok: false, diagnostics };
  }

  // Build AJV instance with Draft 2020-12 support
  const ajv = new Ajv2020({
    strict: false,          // Allow Draft 2020-12 keywords without strict mode errors
    allErrors: true,        // Collect all errors, not just first
    verbose: true,          // Include schemaPath, parentSchema, etc.
    allowUnionTypes: true,  // Allow union types in schemas
  });

  addFormats(ajv);

  // Compile and validate
  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema as object);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push(
      error('PLAN_SCHEMA_REF_ERROR', `Failed to compile schema: ${msg}`),
    );
    return { ok: false, diagnostics };
  }

  const valid = validate(planData);

  if (!valid && validate.errors) {
    for (const err of validate.errors) {
      diagnostics.push(ajvErrorToDiagnostic(err));
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

/** Convert an AJV ErrorObject to a Diagnostic. */
function ajvErrorToDiagnostic(err: ErrorObject): Diagnostic {
  const path = err.instancePath || undefined;
  const keyword = err.keyword;
  const params = err.params;
  const msg = err.message ?? `Schema validation error: ${keyword}`;

  let message = msg;
  if (path) {
    message = `${path}: ${msg}`;
  }

  return error('PLAN_SCHEMA_INVALID', message, {
    path: path || undefined,
    details: { keyword, params, schemaPath: err.schemaPath },
  });
}
