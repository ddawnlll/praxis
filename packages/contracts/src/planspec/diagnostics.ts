// @praxis/contracts — Diagnostic types for validation results

/** Severity level for diagnostics. */
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

/** Diagnostic codes for all validation stages. */
export type DiagnosticCode =
  // Parse errors
  | 'YAML_PARSE_ERROR'
  | 'PLAN_FILE_EMPTY'
  | 'PLAN_ROOT_NOT_OBJECT'
  // Schema validation errors
  | 'PLAN_SCHEMA_INVALID'
  | 'PLAN_SCHEMA_REF_ERROR'
  | 'PLAN_SCHEMA_LOAD_ERROR'
  // Semantic validation errors/warnings
  | 'DUPLICATE_TASK_ID'
  | 'DUPLICATE_ACCEPTANCE_CRITERION_ID'
  | 'DUPLICATE_COMMAND_ID'
  | 'COMMAND_REF_NOT_FOUND'
  | 'MISSING_REQUIRED_HASH_FIELD'
  | 'INVALID_GATE_SEQUENCE'
  | 'FINAL_GATE_UNSUPPORTED_BY_REQUIRED_CRITERION'
  | 'REQUIRED_EVIDENCE_NOT_DECLARED'
  | 'CONTRACT_MODE_ARTIFACT_POLICY_MISMATCH'
  | 'SEMANTIC_IDENTITY_MISMATCH'
  | 'UNAPPROVED_FINALGATE_CRITERION'
  | 'ADVISORY_FINALGATE_CRITERION'
  | 'AGENT_DRAFT_FINALGATE_CRITERION'
  | 'REPAIR_REPORT_INCONSISTENT'
  | 'HASH_FIELD_MISMATCH'
  // Canonicalization/hashing errors
  | 'CANONICALIZATION_FAILED'
  | 'HASH_FAILED'
  // Generic
  | 'UNKNOWN_ERROR';

/** A single diagnostic — error, warning, or info. */
export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  gate?: string;
  taskId?: string;
  criterionId?: string;
  commandRef?: string;
  details?: unknown;
}

/** Creates a diagnostic with severity 'error'. */
export function error(
  code: DiagnosticCode,
  message: string,
  extra?: Partial<Pick<Diagnostic, 'path' | 'gate' | 'taskId' | 'criterionId' | 'commandRef' | 'details'>>,
): Diagnostic {
  return { code, severity: 'error', message, ...extra };
}

/** Creates a diagnostic with severity 'warning'. */
export function warning(
  code: DiagnosticCode,
  message: string,
  extra?: Partial<Pick<Diagnostic, 'path' | 'gate' | 'taskId' | 'criterionId' | 'commandRef' | 'details'>>,
): Diagnostic {
  return { code, severity: 'warning', message, ...extra };
}

/** Creates a diagnostic with severity 'info'. */
export function info(
  code: DiagnosticCode,
  message: string,
  extra?: Partial<Pick<Diagnostic, 'path' | 'gate' | 'taskId' | 'criterionId' | 'commandRef' | 'details'>>,
): Diagnostic {
  return { code, severity: 'info', message, ...extra };
}

/** Filters diagnostics by severity. */
export function bySeverity(diags: Diagnostic[], severity: DiagnosticSeverity): Diagnostic[] {
  return diags.filter(d => d.severity === severity);
}

/** Returns true if there's at least one error. */
export function hasErrors(diags: Diagnostic[]): boolean {
  return diags.some(d => d.severity === 'error');
}

/** Returns true if there's at least one warning. */
export function hasWarnings(diags: Diagnostic[]): boolean {
  return diags.some(d => d.severity === 'warning');
}
