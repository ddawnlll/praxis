// @praxis/kernel — Core Types
// Shared types for the Truth Kernel gate runtime.

import type { PlanSpecV01, PlanHashes, Diagnostic } from '@praxis/contracts';
import type { EvidenceGateResult } from './evidence/types';
import type { WiringGateResult } from './wiring/types';
import type { ExecGateResult } from './executor/types';
import type { FinalGateResult } from './final/types';

// Re-export P3 evidence types from a single barrel
export type {
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
} from './evidence/types';

// Re-export P4 wiring types from a single barrel
export type {
  WiringGateInput,
  WiringGateResult,
  DeclaredUnitResult,
  ExportSurfaceResult,
  EntrypointResult,
  IntegrationPointResult,
} from './wiring/types';

// Re-export P5 executor types from a single barrel
export type {
  ExecGateInput,
  ExecGateResult,
  CommandResult,
  CommandVerdict,
} from './executor/types';

// Re-export P6 final types from a single barrel
export type {
  FinalGateInput,
  FinalGateResult,
  CriterionResult,
  CriterionVerdict,
} from './final/types';

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


/** Union of all gate result types that can appear in gateVerdicts. */
export type AnyGateResult = GateVerdict | EvidenceGateResult | WiringGateResult | ExecGateResult | FinalGateResult;

/** Result of runP4Kernel (SchemaGate → LockGate → EvidenceGate → WiringGate). */
export interface KernelP4Result {
  ok: boolean;
  verdict: GateVerdictValue;
  attemptId: string;
  gateVerdicts: AnyGateResult[];
  startedAt: string;
  finishedAt: string;
  plan?: PlanSpecV01;
  hashes?: PlanHashes;
  lock?: PlanLockV01;
  evidence?: EvidenceGateResult;
  wiring?: WiringGateResult;
  diagnostics: Diagnostic[];
}

/** Result of runP5Kernel (SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate). */
export interface KernelP5Result {
  ok: boolean;
  verdict: GateVerdictValue;
  attemptId: string;
  gateVerdicts: AnyGateResult[];
  startedAt: string;
  finishedAt: string;
  plan?: PlanSpecV01;
  hashes?: PlanHashes;
  lock?: PlanLockV01;
  evidence?: EvidenceGateResult;
  wiring?: WiringGateResult;
  exec?: ExecGateResult;
  diagnostics: Diagnostic[];
}

/** Result of runKernel / runP6Kernel (full 6-gate pipeline). */
export interface KernelResult {
  ok: boolean;
  verdict: GateVerdictValue;
  attemptId: string;
  gateVerdicts: AnyGateResult[];
  startedAt: string;
  finishedAt: string;
  plan?: PlanSpecV01;
  hashes?: PlanHashes;
  lock?: PlanLockV01;
  evidence?: EvidenceGateResult;
  wiring?: WiringGateResult;
  exec?: ExecGateResult;
  final?: FinalGateResult;
  diagnostics: Diagnostic[];
}
