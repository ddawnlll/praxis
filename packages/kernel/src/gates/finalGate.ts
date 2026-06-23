// @praxis/kernel — FinalGate
// Sixth and final gate in the PRAXIS Truth Kernel pipeline.
// Determines whether acceptance criteria are met based on ALL evidence
// gathered by prior gates. Only FinalGate PASS means the task is complete (Law 1).
//
// Core rules:
// - No advisory-only PASS (all criteria advisory → HOLD NO_DETERMINISTIC_CRITERIA)
// - No agent-only PASS (non-human-approved criteria cannot PASS)
// - No empty PASS (0 criteria → HOLD NO_CRITERIA_DEFINED)
// - No prior-gate-FAIL PASS (any prior gate FAIL → HOLD PRIOR_GATE_NOT_PASS)
// - At least one deterministic criterion must pass
//
// Verdict aggregation:
// - All non-advisory, non-manual criteria PASS, no prior FAIL → PASS (ALL_CRITERIA_MET)
// - Any FAIL criterion → FAIL (CRITERIA_FAILED)
// - Some HOLD → HOLD (CRITERIA_PARTIAL)
// - All advisory → HOLD (NO_DETERMINISTIC_CRITERIA)

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, PlanHashes, AcceptanceCriterion } from '@praxis/contracts';
import type {
  FinalGateInput,
  FinalGateResult,
  CriterionResult,
} from '../final/types';
import { evaluateCriterion } from '../final/criterionEvaluator';
import type { CriterionContext } from '../final/criterionEvaluator';
import type { EvidenceRecordV01 } from '../evidence/types';
import type { CommandResult } from '../executor/types';
import type { WiringGateResult } from '../wiring/types';
import { FINAL_REASON_CODES } from '../diagnostics';
import { kdiag } from '../diagnostics';

// ---------------------------------------------------------------------------
// Prior gate verdict check
// ---------------------------------------------------------------------------

/**
 * Check if any prior gate returned FAIL. If so, FinalGate cannot return PASS.
 * Returns the first prior gate that FAILed, or null if all passed/held.
 */
function findPriorGateFail(
  priorGateVerdicts: FinalGateInput['priorGateVerdicts'],
): { gateName: string; verdict: string } | null {
  for (const gv of priorGateVerdicts) {
    if (gv.verdict === 'FAIL') {
      return { gateName: gv.gateName, verdict: gv.verdict };
    }
  }
  return null;
}

/**
 * Check if any prior gate returned HOLD.
 */
function hasPriorGateHold(
  priorGateVerdicts: FinalGateInput['priorGateVerdicts'],
): boolean {
  return priorGateVerdicts.some(gv => gv.verdict === 'HOLD');
}

// ---------------------------------------------------------------------------
// Criterion traversal
// ---------------------------------------------------------------------------

/**
 * Collect all acceptance criteria from all tasks in the plan.
 */
function collectAllCriteria(plan: PlanSpecV01): Array<{ criterion: AcceptanceCriterion; taskId: string }> {
  const result: Array<{ criterion: AcceptanceCriterion; taskId: string }> = [];
  for (const task of plan.tasks) {
    for (const criterion of task.acceptanceCriteria) {
      result.push({ criterion, taskId: task.id });
    }
  }
  return result;
}

/**
 * Determine if a criterion is deterministic (can contribute to PASS).
 * A criterion is deterministic if it is not advisory, not llm_advisory,
 * not manual_review, and verification.deterministic === true.
 */
function isDeterministic(criterion: AcceptanceCriterion): boolean {
  const v = criterion.verification;
  if (v.advisoryOnly) return false;
  if (v.type === 'llm_advisory') return false;
  if (v.type === 'manual_review') return false;
  return v.deterministic === true;
}

// ---------------------------------------------------------------------------
// Verdict aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate all CriterionResults into a final verdict and reason codes.
 * Applies the precedence rules:
 * 1. Any FAIL criterion → FAIL
 * 2. All non-advisory, non-manual criteria PASS → PASS (if at least one deterministic)
 * 3. All criteria are advisory/manual/not-evaluated → HOLD
 * 4. Some HOLD → HOLD
 */
function aggregateVerdict(
  results: CriterionResult[],
  totalCriteria: number,
  priorFail: { gateName: string; verdict: string } | null,
  priorHold: boolean,
): {
  verdict: 'PASS' | 'HOLD' | 'FAIL';
  reasonCodes: string[];
  repairHint?: string;
} {
  const reasonCodes: string[] = [];

  // Rule: No criteria → HOLD
  if (totalCriteria === 0) {
    reasonCodes.push(FINAL_REASON_CODES.NO_CRITERIA_DEFINED);
    return {
      verdict: 'HOLD',
      reasonCodes,
      repairHint: 'No acceptance criteria defined in the plan. Add at least one deterministic criterion.',
    };
  }

  // Rule: Prior gate FAIL → HOLD (cannot PASS, escalated to HOLD not FAIL since
  // FinalGate itself may still evaluate correctly — but prior gate failure
  // means the pipeline cannot complete)
  if (priorFail) {
    reasonCodes.push(FINAL_REASON_CODES.PRIOR_GATE_NOT_PASS);
    // Also collect criterion-level reason codes for diagnostics
    for (const r of results) {
      if (!r.advisory && !r.skipped) {
        for (const rc of r.reasonCodes) {
          reasonCodes.push(rc);
        }
      }
    }
    return {
      verdict: 'HOLD',
      reasonCodes,
      repairHint: `Prior gate "${priorFail.gateName}" returned ${priorFail.verdict}. All prior gates must PASS before FinalGate can PASS.`,
    };
  }

  // Separate results by verdict type
  const passResults = results.filter(r => r.verdict === 'PASS');
  const failResults = results.filter(r => r.verdict === 'FAIL');
  const holdResults = results.filter(r => r.verdict === 'HOLD');
  const infoResults = results.filter(r => r.verdict === 'INFO');

  // Collect unique reason codes from all results
  for (const r of results) {
    for (const rc of r.reasonCodes) {
      reasonCodes.push(rc);
    }
  }

  // Any FAIL criterion → FAIL
  if (failResults.length > 0) {
    reasonCodes.push(FINAL_REASON_CODES.CRITERIA_FAILED);
    return {
      verdict: 'FAIL',
      reasonCodes,
      repairHint: `${failResults.length} criteria definitively failed. Human review required.`,
    };
  }

  // Identify deterministic results (non-advisory, non-manual, non-not-evaluated)
  const deterministicResults = results.filter(r => !r.advisory && !r.skipped);

  // All criteria are advisory/manual/not-evaluated → HOLD
  if (deterministicResults.length === 0) {
    reasonCodes.push(FINAL_REASON_CODES.NO_DETERMINISTIC_CRITERIA);
    return {
      verdict: 'HOLD',
      reasonCodes,
      repairHint: 'All criteria are advisory or manual — FinalGate cannot produce PASS without deterministic evidence.',
    };
  }

  // Check if there is at least one deterministic PASS
  const deterministicPassCount = deterministicResults.filter(r => r.verdict === 'PASS').length;

  if (deterministicPassCount === 0) {
    // Some HOLD, none PASS → HOLD
    reasonCodes.push(FINAL_REASON_CODES.CRITERIA_PARTIAL);
    return {
      verdict: 'HOLD',
      reasonCodes,
      repairHint: `No deterministic criteria passed. ${holdResults.length} criteria returned HOLD, ${infoResults.length} returned INFO.`,
    };
  }

  // At least one deterministic PASS, check if ALL are PASS
  const allDeterministicPassed = deterministicResults.every(r => r.verdict === 'PASS');

  if (allDeterministicPassed && !priorHold) {
    // All non-advisory, non-manual criteria PASS, no prior HOLD → PASS
    reasonCodes.push(FINAL_REASON_CODES.ALL_CRITERIA_MET);
    return {
      verdict: 'PASS',
      reasonCodes,
      repairHint: undefined,
    };
  }

  if (allDeterministicPassed && priorHold) {
    // All criteria pass but prior gate held → HOLD (prior gate must be resolved)
    reasonCodes.push(FINAL_REASON_CODES.CRITERIA_PARTIAL);
    return {
      verdict: 'HOLD',
      reasonCodes,
      repairHint: 'All criteria passed but one or more prior gates returned HOLD. Resolve prior gate issues first.',
    };
  }

  // Some pass, some hold → HOLD
  reasonCodes.push(FINAL_REASON_CODES.CRITERIA_PARTIAL);
  return {
    verdict: 'HOLD',
    reasonCodes,
    repairHint: `${deterministicPassCount}/${deterministicResults.length} deterministic criteria passed. ${holdResults.length} criteria returned HOLD.`,
  };
}

// ---------------------------------------------------------------------------
// Gate entry point
// ---------------------------------------------------------------------------

/**
 * Run FinalGate — evaluate all acceptance criteria against available evidence.
 *
 * Checks (in order):
 * 1. Verify all prior gates are not FAIL
 * 2. Collect all acceptance criteria from all tasks
 * 3. Evaluate each criterion against evidence (advisory filter, human approval,
 *    deterministic verification type evaluation)
 * 4. Aggregate criterion results into final verdict
 * 5. Apply core safety rules (no advisory-only PASS, no agent-only PASS,
 *    no empty PASS, no prior-gate-FAIL PASS)
 *
 * Returns FinalGateResult with verdict PASS/HOLD/FAIL.
 */
export function runFinalGate(input: FinalGateInput): FinalGateResult {
  const {
    plan,
    hashes,
    attemptId,
    repoRoot,
    evidenceRecords,
    commandResults,
    wiringResult,
    priorGateVerdicts,
    lock,
  } = input;

  const timestamp = new Date().toISOString();
  const allDiagnostics: Diagnostic[] = [];
  const allEvidenceRefs: string[] = [];

  // --- Step 1: Check prior gate verdicts ---
  const priorFail = findPriorGateFail(priorGateVerdicts);
  const priorHold = hasPriorGateHold(priorGateVerdicts);

  if (priorFail) {
    allDiagnostics.push(kdiag(
      FINAL_REASON_CODES.PRIOR_GATE_NOT_PASS,
      'error',
      `Prior gate "${priorFail.gateName}" returned FAIL. FinalGate cannot produce PASS.`,
    ));
  }

  if (priorHold) {
    allDiagnostics.push(kdiag(
      'PRIOR_GATE_HOLD',
      'warning',
      'One or more prior gates returned HOLD. FinalGate will evaluate criteria but overall pipeline is HOLD.',
    ));
  }

  // --- Step 2: Collect all criteria ---
  const allCriteria = collectAllCriteria(plan);
  const totalCriteria = allCriteria.length;

  // Rule: No criteria → immediate HOLD
  if (totalCriteria === 0) {
    return buildResult({
      verdict: 'HOLD',
      reasonCodes: [FINAL_REASON_CODES.NO_CRITERIA_DEFINED],
      diagnostics: [kdiag(
        FINAL_REASON_CODES.NO_CRITERIA_DEFINED,
        'warning',
        'No acceptance criteria defined in the plan. Cannot evaluate FinalGate.',
      )],
      failedCriteriaIds: [],
      evidenceRefs: [],
      criterionResults: [],
      totalCriteria: 0,
      passedCriteria: 0,
      failedCriteria: 0,
      advisoryCriteria: 0,
      manualReviewCriteria: 0,
      notEvaluatedCriteria: 0,
      attemptId,
      timestamp,
      repairHint: 'No acceptance criteria defined in the plan. Add at least one deterministic criterion.',
      plan,
      hashes,
      lock,
      evidenceRecords,
    });
  }

  // --- Step 3: Evaluate each criterion ---
  const criterionResults: CriterionResult[] = [];
  const failedCriterionIds: string[] = [];

  for (const { criterion, taskId } of allCriteria) {
    const evalCtx: CriterionContext = {
      criterion,
      taskId,
      repoRoot,
      evidenceRecords: evidenceRecords ?? [],
      commandResults: commandResults ?? [],
      wiringResult,
      planYaml: undefined, // Plan YAML not stored in input; schema_validation criteria will need it
    };

    const result = evaluateCriterion(evalCtx);
    criterionResults.push(result);

    // Collect evidence refs
    for (const ref of result.evidenceRefs) {
      allEvidenceRefs.push(ref);
    }

    // Collect diagnostics
    if (result.verdict !== 'PASS') {
      const severity = result.verdict === 'FAIL' ? 'error' : 'warning';
      allDiagnostics.push(kdiag(
        result.reasonCodes[0] ?? 'CRITERION_NOT_PASS',
        severity,
        result.detail,
      ));
    }

    // Track failed criteria (non-PASS, non-advisory)
    if (result.verdict === 'FAIL' || result.verdict === 'HOLD') {
      failedCriterionIds.push(result.criterionId);
    }
  }

  // --- Step 4: Aggregate verdict ---
  const counts = {
    passedCriteria: criterionResults.filter(r => r.verdict === 'PASS').length,
    failedCriteria: criterionResults.filter(r => r.verdict === 'FAIL' || r.verdict === 'HOLD').length,
    advisoryCriteria: criterionResults.filter(r => r.advisory).length,
    manualReviewCriteria: criterionResults.filter(r =>
      r.reasonCodes.includes(FINAL_REASON_CODES.MANUAL_REVIEW_REQUIRED),
    ).length,
    notEvaluatedCriteria: criterionResults.filter(r => r.skipped && !r.advisory).length,
  };

  const aggregate = aggregateVerdict(criterionResults, totalCriteria, priorFail, priorHold);

  // Combine all reason codes
  const allReasonCodes = [...aggregate.reasonCodes];

  // --- Build result ---
  return buildResult({
    verdict: aggregate.verdict,
    reasonCodes: [...new Set(allReasonCodes)],
    diagnostics: allDiagnostics,
    failedCriteriaIds: failedCriterionIds,
    evidenceRefs: [...new Set(allEvidenceRefs)],
    criterionResults,
    totalCriteria,
    ...counts,
    attemptId,
    timestamp,
    repairHint: aggregate.repairHint,
    plan,
    hashes,
    lock,
    evidenceRecords,
  });
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

interface BuildParams {
  verdict: 'PASS' | 'HOLD' | 'FAIL';
  reasonCodes: string[];
  diagnostics: Diagnostic[];
  failedCriteriaIds: string[];
  evidenceRefs: string[];
  criterionResults: CriterionResult[];
  totalCriteria: number;
  passedCriteria: number;
  failedCriteria: number;
  advisoryCriteria: number;
  manualReviewCriteria: number;
  notEvaluatedCriteria: number;
  attemptId: string;
  timestamp: string;
  repairHint?: string;
  plan?: PlanSpecV01;
  hashes?: PlanHashes;
  lock?: FinalGateInput['lock'];
  evidenceRecords?: EvidenceRecordV01[];
}

function buildResult(params: BuildParams): FinalGateResult {
  return {
    gateName: 'FinalGate',
    verdict: params.verdict,
    reasonCodes: params.reasonCodes,
    diagnostics: params.diagnostics,
    failedCriteriaIds: params.failedCriteriaIds,
    evidenceRefs: params.evidenceRefs,
    attemptId: params.attemptId,
    timestamp: params.timestamp,
    repairHint: params.repairHint,
    criterionResults: params.criterionResults,
    totalCriteria: params.totalCriteria,
    passedCriteria: params.passedCriteria,
    failedCriteria: params.failedCriteria,
    advisoryCriteria: params.advisoryCriteria,
    manualReviewCriteria: params.manualReviewCriteria,
    notEvaluatedCriteria: params.notEvaluatedCriteria,
    plan: params.plan,
    hashes: params.hashes,
    lock: params.lock,
    evidenceRecords: params.evidenceRecords,
  };
}
