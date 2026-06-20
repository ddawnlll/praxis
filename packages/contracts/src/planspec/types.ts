// @praxis/contracts — PlanSpec v0.1 TypeScript Types
// Mirrors schemas/planspec.v0.1.schema.yaml $defs

/** Top-level PlanSpec v0.1 document. */
export interface PlanSpecV01 {
  planSpecVersion: '0.1.0';
  kind: 'ImplementationPlan';
  profile: 'praxis-v0.1';
  metadata: PlanMetadata;
  authority: Authority;
  workspace: Workspace;
  execution: Execution;
  tasks: Task[];
  commands: Commands;
  evidence: Evidence;
  gates: Gates;
  repair: Repair;
  locking: Locking;
  reports: Reports;
}

export interface PlanMetadata {
  planId: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  humanId: string;
  status: 'draft' | 'locked' | 'running' | 'held' | 'failed' | 'passed' | 'superseded';
}

export interface Authority {
  executor: 'ClaudeCode' | 'Human' | 'OtherAgent';
  completionAuthority: 'PraxisTruthKernel';
  agentSelfReportIsClaimOnly: true;
  criteriaSourceRequired: 'human' | 'imported_human';
  reportsAreEvidenceOnly: true;
  pluginOwnsTruth: false;
}

export interface Workspace {
  root: string;
  allowedFiles: string[];
  forbiddenFiles: string[];
}

export interface Execution {
  mode: 'single_session';
  agent: 'claude-code';
  autonomy: 'implementation_allowed' | 'analysis_only';
  canModifyCode: boolean;
  canModifyPlan: false;
  canModifyAcceptanceCriteria: false;
  maxRepairLoops: number;
}

export interface Task {
  id: string;
  title: string;
  objective: string;
  implementation: Implementation;
  artifactPolicy: ArtifactPolicy;
  integrationContract?: IntegrationContract;
  acceptanceCriteria: AcceptanceCriterion[];
}

export interface Implementation {
  instructions: string[];
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  suggestedSteps?: string[];
  antiPatterns?: string[];
  dependencies?: string[];
  expectedOutputs?: string[];
}

export interface ArtifactPolicy {
  class:
    | 'runtime_code'
    | 'library_code'
    | 'cli_command'
    | 'test_only'
    | 'documentation'
    | 'config'
    | 'schema'
    | 'migration'
    | 'script'
    | 'generated_report'
    | 'fixture';
  wiringRequired: boolean | 'consumer_or_export' | 'runner_discovery' | 'conditional' | 'optional_or_test_usage';
  reachabilityRequired: boolean;
  executionRequired: boolean;
  deterministicEvidenceRequired: boolean;
  advisoryReviewAllowed?: boolean;
}

export interface IntegrationContract {
  mode: 'none' | 'required' | 'consumer_or_export' | 'runner_discovery' | 'runtime_probe' | 'manual_only';
  reason: string;
  declaredUnits?: DeclaredUnit[];
  integrationPoints?: IntegrationPoint[];
  entrypoints?: Entrypoint[];
  exportSurfaces?: ExportSurface[];
  usageProofs?: UsageProof[];
  runtimeProbes?: RuntimeProbe[];
  runnerDiscovery?: RunnerDiscovery[];
  forbiddenOrphanModules?: boolean;
}

export interface DeclaredUnit {
  id: string;
  path: string;
  kind:
    | 'runtime_module'
    | 'library_module'
    | 'cli_module'
    | 'test_module'
    | 'config_file'
    | 'schema_file'
    | 'migration_file'
    | 'script_file'
    | 'documentation_file'
    | 'fixture_file';
  expectedExports?: string[];
  requiredPatterns?: string[];
  language?: string;
}

export interface IntegrationPoint {
  id: string;
  path: string;
  requiredPatterns?: string[];
  expectedImports?: string[];
  expectedRegistrationPatterns?: string[];
}

export interface Entrypoint {
  id: string;
  path: string;
  kind?: string;
  requiredReachabilityFrom?: string[];
}

export interface ExportSurface {
  id: string;
  path: string;
  requiredExports: string[];
}

export interface UsageProof {
  id: string;
  commandRef: string;
  expectedOutputPatterns?: string[];
  proves?: string[];
}

export interface RuntimeProbe {
  id: string;
  commandRef: string;
  expectedOutputPatterns?: string[];
  expectedExitCode?: number;
  proves?: string[];
}

export interface RunnerDiscovery {
  id: string;
  commandRef: string;
  expectedOutputPatterns?: string[];
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  level: 'required' | 'optional' | 'advisory';
  humanApproved: boolean;
  criteriaSource: 'human' | 'imported_human' | 'agent_draft';
  verification: Verification;
  requiredEvidence: EvidenceType[];
  artifactPolicyOverride?: ArtifactPolicy;
}

export interface Verification {
  type:
    | 'file_exists'
    | 'file_contains'
    | 'static_pattern'
    | 'diff_contains'
    | 'no_diff_contains'
    | 'command_output'
    | 'test_output'
    | 'schema_validation'
    | 'integration_contract'
    | 'import_graph'
    | 'entrypoint_reachability'
    | 'runtime_probe'
    | 'runner_discovery'
    | 'coverage'
    | 'manual_review'
    | 'llm_advisory';
  path?: string;
  patterns?: string[];
  commandRef?: string;
  deterministic: boolean;
  canSatisfyFinalGate: boolean;
  advisoryOnly: boolean;
  evidenceRefs: string[];
}

export type EvidenceType =
  | 'diff'
  | 'source'
  | 'wiring'
  | 'command'
  | 'test_output'
  | 'runtime_probe'
  | 'schema_validation'
  | 'manual_review'
  | 'llm_advisory'
  | 'report';

export interface Commands {
  exactAllowedCommands: ExactAllowedCommand[];
  validationEvidenceRules: ValidationEvidenceRules;
  hardDeniedCommands: DeniedCommand[];
}

export interface ExactAllowedCommand {
  id: string;
  kind: 'final_validation' | 'targeted_test' | 'typecheck' | 'lint' | 'build' | 'runtime_probe' | 'discovery';
  command: string;
  cwd?: string;
  evidenceRequired: boolean;
  timeoutSeconds: number;
  noTestsFoundIsFailure?: boolean;
  watchModeForbidden?: boolean;
  expectedExitCode?: number;
  networkAllowed?: boolean;
  shellAllowed?: boolean;
  expectedOutputPatterns?: string[];
}

export interface DeniedCommand {
  id?: string;
  kind?:
    | 'final_validation'
    | 'targeted_test'
    | 'typecheck'
    | 'lint'
    | 'build'
    | 'runtime_probe'
    | 'discovery';
  command: string;
  pattern?: string;
  reason: string;
}

export interface ValidationEvidenceRules {
  finalPromotionRequiresExactAllowedCommand: true;
  discoveryCommandsMayNotSatisfyFinalValidation: true;
  runtimeGrantCommandsCanSatisfyValidationOnlyIfGrantStatesValidationPurpose: boolean;
}

export interface Evidence {
  ledgerRequired: true;
  requiredEvidenceTypes: EvidenceType[];
  hashWhenAvailable: boolean;
}

export interface Gates {
  sequence: [
    'SchemaGate',
    'LockGate',
    'EvidenceGate',
    'WiringGate',
    'ExecGate',
    'FinalGate',
  ];
  verdicts: ('PASS' | 'HOLD' | 'FAIL')[];
  reasonCodes: Record<string, string[]>;
}

export interface Repair {
  enabled: boolean;
  failedCriteriaOnly: true;
  mayModifyAcceptanceCriteria: false;
  mayModifyPlan: false;
  allowedFilesFromFailedTasksOnly: boolean;
  maxRepairLoops: number;
  reverifyCommand: string;
  repairPacketFormat: {
    json: boolean;
    markdown: boolean;
  };
}

export interface Locking {
  lockRequired: true;
  canonicalHashRequired: true;
  planLockFile: string;
  hashes: HashField[];
}

export type HashField =
  | 'planHash'
  | 'acceptanceCriteriaHash'
  | 'artifactPolicyHash'
  | 'integrationContractHash'
  | 'commandPolicyHash'
  | 'allowedFilesHash'
  | 'forbiddenFilesHash';

export interface Reports {
  protocol: 'ACCP';
  artifactDirectory: string;
  reportsAreEvidenceOnly: true;
  reportsDoNotAuthorizeExecution: true;
  commandEvidenceRequired: boolean;
  repairPacketRequiredOnHoldOrFail: boolean;
}
