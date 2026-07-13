// @praxis/kernel — Public API
// PRAXIS Truth Kernel — gate runtime for PlanSpec v0.1 validation.
// P6 scope: SchemaGate + LockGate + EvidenceGate + WiringGate + ExecGate + FinalGate.

// Types
export type {
  KernelContext,
  GateVerdict,
  GateVerdictValue,
  KernelP2Result,
  KernelP4Result,
  KernelP5Result,
  KernelResult,
  AnyGateResult,
  PlanLockV01,
  LockMode,
  SchemaGateInput,
  LockGateInput,
  // P3 evidence types
  EvidenceRecordV01,
  EvidenceLedgerReadResult,
  EvidenceGateInput,
  EvidenceGateResult,
  KernelP3Result,
  ChangedFile,
  ChangedFileStatus,
  EvidenceTypeV01,
  EvidenceSourceV01,
  EvidenceRungV01,
  // P4 wiring types
  WiringGateInput,
  WiringGateResult,
  DeclaredUnitResult,
  ExportSurfaceResult,
  EntrypointResult,
  IntegrationPointResult,
  // P5 executor types
  ExecGateInput,
  ExecGateResult,
  CommandResult,
  CommandVerdict,
  // P6 final types
  FinalGateInput,
  FinalGateResult,
  CriterionResult,
  CriterionVerdict,
} from './types';

// Diagnostics & evidence helpers
export {
  SCHEMA_REASON_CODES,
  LOCK_REASON_CODES,
  EVIDENCE_REASON_CODES,
  WIRING_REASON_CODES,
  EXEC_REASON_CODES,
  FINAL_REASON_CODES,
  HASH_FIELD_REASON_MAP,
  now,
  kdiag,
} from './diagnostics';
export {
  sourceToRung,
  resolveRung,
  believeUnderFloor,
} from './evidence/types';

// Gates
export { runSchemaGate } from './gates/schemaGate';
export { runLockGate } from './gates/lockGate';
export { runEvidenceGate } from './gates/evidenceGate';
export { runWiringGate } from './gates/wiringGate';
export { runExecGate } from './gates/execGate';
export { runFinalGate } from './gates/finalGate';

// Lock helpers
export { createPlanLock } from './lock/createPlanLock';
export { readPlanLockYaml } from './lock/readPlanLockYaml';
export { writePlanLockYaml } from './lock/writePlanLockYaml';
export { verifyPlanLock } from './lock/verifyPlanLock';
export { resolveLockPath, ensureLockDir } from './lock/resolveLockPath';
export type { LockReadResult } from './lock/readPlanLockYaml';
export type { LockWriteResult } from './lock/writePlanLockYaml';
export type { LockVerifyResult } from './lock/verifyPlanLock';

// Evidence helpers
export { readEvidenceLedgerJsonl, parseEvidenceRecord } from './evidence/readEvidenceLedgerJsonl';
export { writeEvidenceLedgerJsonl } from './evidence/writeEvidenceLedgerJsonl';
export { appendEvidenceRecordJsonl } from './evidence/appendEvidenceRecordJsonl';
export { validateEvidenceLedger } from './evidence/validateEvidenceLedger';
export type { EvidenceValidationResult } from './evidence/validateEvidenceLedger';

// Attestation (PEL-1)
export { signEvidenceRecord, verifyAttestation, extractRecord, isAttestedDeterministicSource } from './evidence/attestation';
export type { DsseEnvelope } from './evidence/attestation';

// Pipeline
export { runP2Kernel } from './runP2Kernel';
export type { RunP2Options } from './runP2Kernel';
export { runP3Kernel } from './runP3Kernel';
export type { RunP3Options } from './runP3Kernel';
export { runP4Kernel } from './runP4Kernel';
export type { RunP4Options } from './runP4Kernel';
export { runP5Kernel } from './runP5Kernel';
export type { RunP5Options } from './runP5Kernel';
export { runP6Kernel, runKernel } from './runP6Kernel';
export type { RunKernelOptions } from './runP6Kernel';

// Report
export { generateReport, formatReportMarkdown } from './report/reportGenerator';
export type { VerificationReport, GateReportEntry, CriterionSummary } from './report/reportGenerator';
export { formatReportAccpYaml, formatReportAccpSummary } from './report/accpReport';
export type { AccpYamlReport } from './report/accpReport';

// Repair
export { generateRepairPacket } from './repair/repairPacketGenerator';
export type {
  RepairPacket,
  RepairGateEntry,
  RepairCriterionEntry,
  RepairStrategy,
  RepairStrategyKind,
} from './repair/repairPacketGenerator';

// Circuit Breaker
export {
  createCircuitBreaker,
  recordFailure as cbRecordFailure,
  recordSuccess as cbRecordSuccess,
  allowRequest as cbAllowRequest,
  getStatus as cbGetStatus,
  reset as cbReset,
  computeFailureRate,
} from './circuit-breaker';
export type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerStatus,
  CircuitBreakerResult,
} from './circuit-breaker';

// Test Parser
export {
  parseTestOutput,
  detectFramework,
} from './test-parser';
export type {
  TestResult,
  TestEntry,
} from './test-parser';

// Governor
export {
  createGovernor,
  canAdmitWorker,
  admitWorker,
  completeWorker,
  getGovernorState,
  setWorkerQueue,
} from './governor';
export type {
  Governor,
  GovernorConfig,
  GovernorState,
  GovernorTier,
} from './governor';

// Assembler
export { assemble } from './assembler';
export type {
  AssemblyInput,
  AssemblyFile,
  ConflictReport,
  AssemblyResult,
} from './assembler';

// Wave Scheduler
export {
  scheduleWaves,
  validateNoNamespaceCollisions,
} from './wave-scheduler';
export type {
  WavePlan,
  WaveTask,
  Wave,
  ScheduleResult,
} from './wave-scheduler';

// Import Analyzer
export { analyzeImports } from './wiring/importAnalyzer';
export type {
  ImportEdge,
  ExportSymbol,
  ImportGraphResult,
} from './wiring/importAnalyzer';

// Coverage Parser
export { parseCoverageJson, parseCoverageFile } from './coverage';
export type { CoverageResult, CoverageTotals, FileCoverage } from './coverage';

// Network Sandbox
export { checkNetworkAccess, createNetworkPolicy } from './executor/networkSandbox';
export type { NetworkPolicy, SandboxResult } from './executor/networkSandbox';

// Daemon
export { createDaemon, autoSpawnDaemon } from './daemon/praxisDaemon';
export type {
  DaemonConfig,
  DaemonServer,
  VerifyRequest,
  VerifyResponse,
  ValidateRequest,
  ValidateResponse,
} from './daemon/praxisDaemon';

// Gate Cache
export { GateCache, createGateCache, CACHE_NAMESPACES } from './daemon/gateCache';
export type { GateCacheStats, CacheNamespace } from './daemon/gateCache';

// Daemon State
export { createWarmState, indexEvidence, mergeEvidence } from './daemon/state';
export type { WarmState } from './daemon/state';
