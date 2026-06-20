// @praxis/kernel — Public API
// PRAXIS Truth Kernel — gate runtime for PlanSpec v0.1 validation.
// P2 scope: SchemaGate + LockGate only.

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
} from './types';

// Diagnostics
export {
  SCHEMA_REASON_CODES,
  LOCK_REASON_CODES,
  HASH_FIELD_REASON_MAP,
  now,
  kdiag,
} from './diagnostics';

// Gates
export { runSchemaGate } from './gates/schemaGate';
export { runLockGate } from './gates/lockGate';

// Lock helpers
export { createPlanLock } from './lock/createPlanLock';
export { readPlanLockYaml } from './lock/readPlanLockYaml';
export { writePlanLockYaml } from './lock/writePlanLockYaml';
export { verifyPlanLock } from './lock/verifyPlanLock';
export type { LockReadResult } from './lock/readPlanLockYaml';
export type { LockWriteResult } from './lock/writePlanLockYaml';
export type { LockVerifyResult } from './lock/verifyPlanLock';

// Pipeline
export { runP2Kernel } from './runP2Kernel';
export type { RunP2Options } from './runP2Kernel';
