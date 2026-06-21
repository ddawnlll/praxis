// @praxis/kernel — Public API
// PRAXIS Truth Kernel — gate runtime for PlanSpec v0.1 validation.
// P3 scope: SchemaGate + LockGate + EvidenceGate.

// Types
export type {
  KernelContext,
  GateVerdict,
  GateVerdictValue,
  KernelP2Result,
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
} from './types';

// Diagnostics
export {
  SCHEMA_REASON_CODES,
  LOCK_REASON_CODES,
  EVIDENCE_REASON_CODES,
  HASH_FIELD_REASON_MAP,
  now,
  kdiag,
} from './diagnostics';

// Gates
export { runSchemaGate } from './gates/schemaGate';
export { runLockGate } from './gates/lockGate';
export { runEvidenceGate } from './gates/evidenceGate';

// Lock helpers
export { createPlanLock } from './lock/createPlanLock';
export { readPlanLockYaml } from './lock/readPlanLockYaml';
export { writePlanLockYaml } from './lock/writePlanLockYaml';
export { verifyPlanLock } from './lock/verifyPlanLock';
export type { LockReadResult } from './lock/readPlanLockYaml';
export type { LockWriteResult } from './lock/writePlanLockYaml';
export type { LockVerifyResult } from './lock/verifyPlanLock';

// Evidence helpers
export { readEvidenceLedgerJsonl, parseEvidenceRecord } from './evidence/readEvidenceLedgerJsonl';
export { writeEvidenceLedgerJsonl } from './evidence/writeEvidenceLedgerJsonl';
export { appendEvidenceRecordJsonl } from './evidence/appendEvidenceRecordJsonl';
export { validateEvidenceLedger } from './evidence/validateEvidenceLedger';
export type { EvidenceValidationResult } from './evidence/validateEvidenceLedger';

// Pipeline
export { runP2Kernel } from './runP2Kernel';
export type { RunP2Options } from './runP2Kernel';
export { runP3Kernel } from './runP3Kernel';
export type { RunP3Options } from './runP3Kernel';
