// @praxis/contracts — Public API
// PRAXIS PlanSpec v0.1 canonical parser, validator, hasher, and fixture runner.

// Types
export type { PlanSpecV01, PlanMetadata, Authority, Workspace, Execution, Task, Implementation, ArtifactPolicy, IntegrationContract, DeclaredUnit, IntegrationPoint, Entrypoint, ExportSurface, UsageProof, RuntimeProbe, RunnerDiscovery, AcceptanceCriterion, Verification, Commands, ExactAllowedCommand, DeniedCommand, ValidationEvidenceRules, Evidence, Gates, Repair, Locking, Reports } from './planspec/types';

// Diagnostics
export type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from './planspec/diagnostics';
export { error, warning, info, bySeverity, hasErrors, hasWarnings } from './planspec/diagnostics';

// Parser
export { parsePlanSpecYaml } from './planspec/parsePlanSpecYaml';
export type { ParseResult } from './planspec/parsePlanSpecYaml';

// Schema reader
export { readPlanSpecSchema } from './planspec/readPlanSpecSchema';
export type { SchemaLoadResult } from './planspec/readPlanSpecSchema';

// Schema validator
export { validatePlanSpecSchema } from './planspec/validatePlanSpecSchema';
export type { SchemaValidationResult } from './planspec/validatePlanSpecSchema';

// Semantic validator
export { validatePlanSpecSemantics } from './planspec/validatePlanSpecSemantics';
export type { SemanticValidationResult } from './planspec/validatePlanSpecSemantics';

// Combined pipeline
export { validatePlanSpec } from './planspec/validatePlanSpec';
export type { ValidationResult, PlanHashes } from './planspec/validatePlanSpec';

// Loader
export { loadPlanSpecYaml } from './planspec/loadPlanSpecYaml';
export type { LoadResult } from './planspec/loadPlanSpecYaml';

// Canonicalization and hashing
export { canonicalizePlanSpec } from './planspec/canonicalizePlanSpec';
export { hashPlanSpec } from './planspec/hashPlanSpec';

// Fixture runner
export { runPlanSpecFixtureSuite } from './planspec/runPlanSpecFixtureSuite';
export type { FixtureResult, FixtureSuiteResult } from './planspec/runPlanSpecFixtureSuite';
