// @praxis/kernel — FinalGate Types
// FinalGateInput, FinalGateResult, CriterionResult types for FinalGate v0.1.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type { GateVerdictValue, GateVerdict, PlanLockV01 } from '../types';
import type { EvidenceRecordV01 } from '../evidence/types';
import type { CommandResult } from '../executor/types';
import type { WiringGateResult } from '../wiring/types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Input for FinalGate — the sixth and final gate in the Truth Kernel pipeline. */
export interface FinalGateInput {
  /** Parsed PlanSpec v0.1 with tasks and acceptance criteria. */
  plan: PlanSpecV01;
  /** PlanHashes carried forward from SchemaGate/LockGate. */
  hashes: PlanHashes;
  /** Unique attempt identifier. */
  attemptId: string;
  /** Repository root for resolving relative file paths. */
  repoRoot: string;
  /** Evidence records from EvidenceGate (all evidence types). */
  evidenceRecords: EvidenceRecordV01[];
  /** Command results from ExecGate. */
  commandResults: CommandResult[];
  /** WiringGate result (context for integration_contract criteria). */
  wiringResult?: WiringGateResult;
  /** All prior gate verdicts (SchemaGate, LockGate, EvidenceGate, WiringGate, ExecGate). */
  priorGateVerdicts: GateVerdict[];
  /** PlanLock carried forward from LockGate. */
  lock?: PlanLockV01;
}

// ---------------------------------------------------------------------------
// Per-criterion evaluation result
// ---------------------------------------------------------------------------

/** Verdict for a single acceptance criterion evaluation. */
export type CriterionVerdict = 'PASS' | 'HOLD' | 'FAIL' | 'INFO';

/** Result of evaluating a single acceptance criterion against all available evidence. */
export interface CriterionResult {
  /** criterion.id from the plan. */
  criterionId: string;
  /** task.id from the plan (owner task of this criterion). */
  taskId: string;
  /** Per-criterion verdict. */
  verdict: CriterionVerdict;
  /** Reason codes produced by this criterion's evaluation. */
  reasonCodes: string[];
  /** Evidence record references used to evaluate this criterion. */
  evidenceRefs: string[];
  /** Human-readable explanation of the evaluation. */
  detail: string;
  /** Whether the criterion was skipped entirely (advisory, manual, not-evaluated). */
  skipped: boolean;
  /** Whether the criterion is advisory-only (does not affect PASS/HOLD/FAIL verdict). */
  advisory: boolean;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** FinalGate result — the terminal verdict in the Truth Kernel pipeline. */
export interface FinalGateResult {
  gateName: 'FinalGate';
  verdict: GateVerdictValue;
  reasonCodes: string[];
  diagnostics: Diagnostic[];
  failedCriteriaIds: string[];
  evidenceRefs: string[];
  attemptId: string;
  timestamp: string;
  repairHint?: string;

  // --- FinalGate-specific fields ---

  /** Per-criterion evaluation results for all criteria across all tasks. */
  criterionResults: CriterionResult[];
  /** Total number of acceptance criteria evaluated (including advisory/manual). */
  totalCriteria: number;
  /** Number of criteria that resulted in PASS. */
  passedCriteria: number;
  /** Number of criteria that resulted in HOLD or FAIL (excluding advisory/manual). */
  failedCriteria: number;
  /** Number of advisory-only criteria (advisoryOnly=true or llm_advisory type). */
  advisoryCriteria: number;
  /** Number of manual_review criteria. */
  manualReviewCriteria: number;
  /** Number of criteria that could not be evaluated (deferred to v0.2). */
  notEvaluatedCriteria: number;

  // --- Carry-forward fields ---

  /** Plan carried forward. */
  plan?: PlanSpecV01;
  /** Hashes carried forward. */
  hashes?: PlanHashes;
  /** Lock carried forward. */
  lock?: PlanLockV01;
  /** Evidence records carried forward. */
  evidenceRecords?: EvidenceRecordV01[];
}
