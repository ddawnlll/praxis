// @praxis/kernel — Core Types
// Shared types for the Truth Kernel gate runtime.

import type { PlanSpecV01, PlanHashes, Diagnostic } from '@praxis/contracts';

/** Verdict for a single gate evaluation. */
export type GateVerdictValue = 'PASS' | 'HOLD' | 'FAIL';

/** Verdict object produced by each gate. */
export interface GateVerdict {
  gateName: string;
  verdict: GateVerdictValue;
  reasonCodes: string[];
  failedCriteriaIds: string[];
  evidenceRefs: string[];
  attemptId: string;
  timestamp: string;
  repairHint?: string;
  diagnostics?: Diagnostic[];
  /** PlanHashes carried forward from SchemaGate for LockGate. */
  hashes?: PlanHashes;
  /** Lock file path, set by LockGate. */
  lockPath?: string;
  /** Parsed plan, carried forward from SchemaGate. */
  plan?: PlanSpecV01;
}

/** Context passed between gates during a kernel run. */
export interface KernelContext {
  attemptId: string;
  repoRoot: string;
  planPath?: string;
  planYaml?: string;
}

/** PlanLock v0.1 YAML model. */
export interface PlanLockV01 {
  lockVersion: 'praxis-plan-lock/v0.1';
  planSpecVersion: '0.1.0';
  kind: 'ImplementationPlan';
  profile: 'praxis-v0.1';
  planId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  hashes: PlanHashes;
  source: {
    planPath?: string;
    schemaPath: string;
    contractsPackageVersion?: string;
  };
}

/** LockGate operating mode. */
export type LockMode = 'verify_existing' | 'create_if_missing' | 'refresh_explicit';

/** Input for SchemaGate. */
export interface SchemaGateInput {
  planPath?: string;
  planYaml?: string;
  planObject?: PlanSpecV01;
  repoRoot?: string;
  schemaPath?: string;
  attemptId?: string;
}

/** Input for LockGate. */
export interface LockGateInput {
  plan: PlanSpecV01;
  hashes: PlanHashes;
  lockPath?: string;
  mode?: LockMode;
  attemptId?: string;
}

/** Result of runP2Kernel. */
export interface KernelP2Result {
  ok: boolean;
  verdict: GateVerdictValue;
  attemptId: string;
  gateVerdicts: GateVerdict[];
  startedAt: string;
  finishedAt: string;
  plan?: PlanSpecV01;
  hashes?: PlanHashes;
  lock?: PlanLockV01;
  diagnostics: Diagnostic[];
}
