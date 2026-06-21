# FinalGate v0.1 Design

> This document defines FinalGate — the sixth and final gate in the PRAXIS Truth Kernel pipeline. FinalGate determines whether the acceptance criteria are met based on ALL evidence gathered by prior gates. Only FinalGate PASS means the task is complete (Law 1).

## Purpose

FinalGate answers: **"Do the acceptance criteria pass based on deterministic evidence from all prior gates?"**

It ensures that:
- Every acceptance criterion is evaluated against available evidence
- Only deterministic evidence can produce PASS (advisory = HOLD)
- All gates have passed before FinalGate can pass
- The final verdict is deterministic and auditable
- Repair is triggered automatically on HOLD/FAIL

## Position in Pipeline

```
SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → [FinalGate]
                                                                ↑ we are here (P6)
```

FinalGate is the LAST gate. After it, the pipeline terminates with one of three outcomes:
- **PASS** → Task complete. Generate success report.
- **HOLD** → Generate RepairPacket. Queue for next attempt.
- **FAIL** → Generate failure report. Human review required.

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| `plan` | SchemaGate (carried through all gates) | Full PlanSpec with tasks and acceptance criteria |
| `gateVerdicts` | All prior gates | Array of all prior gate verdicts |
| `evidenceRecords` | EvidenceGate | All evidence records from the ledger |
| `commandResults` | ExecGate | Results of all executed commands |
| `testResults` | ExecGate | Test pass/fail counts |
| `wiringResults` | WiringGate | Declared unit matching results |

## Core Logic

### Step 1: Verify All Prior Gates Passed

```
FOR EACH priorGate IN gateVerdicts (SchemaGate, LockGate, EvidenceGate, WiringGate, ExecGate):
  IF priorGate.verdict !== 'PASS':
    → FINAL_HOLD (PRIOR_GATE_NOT_PASS, priorGate.gateName)
    → "Cannot evaluate final verdict: ${priorGate.gateName} returned ${priorGate.verdict}"
```

**Exception:** If a prior gate returned HOLD, FinalGate may still produce a verdict but:
- The overall pipeline verdict is HOLD (one HOLD propagates)
- FinalGate evaluates criteria anyway to provide full diagnostic information
- But the repair cycle will address ALL failures, not just FinalGate's

### Step 2: Evaluate Each Acceptance Criterion

```
FOR EACH task IN plan.tasks:
  FOR EACH criterion IN task.acceptanceCriteria:
    
    // Rule 1: Advisory-only criteria cannot satisfy FinalGate PASS
    IF criterion.verification.advisoryOnly === true:
      Mark criterion as ADVISORY_ONLY
      → ADVISORY_CRITERION (criterion.id)
      → Cannot produce PASS — informational only
      Continue to next criterion (do not mark as failed, just informational)
    
    // Rule 2: LLM advisory type cannot satisfy FinalGate PASS
    IF criterion.verification.type === 'llm_advisory':
      Mark criterion as ADVISORY_ONLY
      → ADVISORY_CRITERION (criterion.id)
      Continue to next criterion
    
    // Rule 3: manual_review type cannot satisfy FinalGate PASS
    IF criterion.verification.type === 'manual_review':
      Mark criterion as MANUAL_REVIEW
      → MANUAL_REVIEW_REQUIRED (criterion.id)
      Continue to next criterion (human must verify)
    
    // Rule 4: Human approval required
    IF criterion.humanApproved === false:
      IF criterion.criteriaSource === 'agent_draft':
        Mark criterion as NOT_HUMAN_APPROVED
        → HOLD (CRITERION_NOT_HUMAN_APPROVED, criterion.id)
        Continue to next criterion
    
    // Rule 5: Evaluate criterion based on verification type
    SWITCH criterion.verification.type:
      
      case 'file_exists':
        resolve criterion.verification.path
        IF file exists → PASS_CRITERION
        IF file does not exist → HOLD (FILE_NOT_FOUND, criterion.id)
      
      case 'file_contains':
        resolve criterion.verification.path
        read file
        IF file contains all criterion.verification.patterns → PASS_CRITERION
        ELSE → HOLD (FILE_CONTENT_MISMATCH, criterion.id)
      
      case 'diff_contains':
        search evidence records for kind:'diff'
        IF any diff contains criterion.verification.pattern → PASS_CRITERION
        ELSE → HOLD (DIFF_CONTENT_MISSING, criterion.id)
      
      case 'no_diff_contains':
        search evidence records for kind:'diff'
        IF no diff contains the forbidden pattern → PASS_CRITERION
        ELSE → FAIL (FORBIDDEN_DIFF_CONTENT, criterion.id)
      
      case 'command_output':
        find commandResult matching criterion.verification.commandRef
        IF command output contains expected patterns → PASS_CRITERION
        ELSE → HOLD (COMMAND_OUTPUT_MISMATCH, criterion.id)
      
      case 'test_output':
        find test result matching criterion.verification.commandRef
        IF testResult.passed === testResult.total → PASS_CRITERION
        ELSE → HOLD (TEST_FAILURES, criterion.id)
      
      case 'schema_validation':
        // Use @praxis/contracts to re-validate
        run validatePlanSpec on target file
        IF valid → PASS_CRITERION
        ELSE → HOLD (SCHEMA_VALIDATION_FAILED, criterion.id)
      
      case 'integration_contract':
        // Use WiringGate results
        IF wiringResults for this task are all PASS → PASS_CRITERION
        ELSE → HOLD (INTEGRATION_CONTRACT_FAILED, criterion.id)
      
      case 'static_pattern':
        resolve file path
        IF file matches all patterns → PASS_CRITERION
        ELSE → HOLD (STATIC_PATTERN_MISSING, criterion.id)
      
      case 'coverage':
        // Defer to v0.2 — coverage tool integration is complex
        → INFO (COVERAGE_CHECK_DEFERRED, criterion.id)
        Mark as NOT_EVALUATED
```

### Step 3: Aggregate Criterion Results

```
totalCriteria = count of all criteria across all tasks
passedCriteria = count of criteria with PASS_CRITERION
failedCriteria = count of criteria with HOLD or FAIL
advisoryCriteria = count of advisory-only criteria
manualReviewCriteria = count of manual_review criteria
notEvaluatedCriteria = count of not-evaluated criteria

IF all non-advisory, non-manual, non-not-evaluated criteria pass:
  AND no prior gate FAIL:
  AND at least one deterministic criterion passed:
    → PASS (ALL_CRITERIA_MET)
  
ELSE IF any criterion FAIL (not HOLD):
  → FAIL (CRITERIA_FAILED, failedCriterionIds)
  
ELSE IF some criteria HOLD:
  → HOLD (CRITERIA_PARTIAL, failedCriterionIds)
  
ELSE IF ALL criteria are advisory-only or manual_review:
  → HOLD (NO_DETERMINISTIC_CRITERIA)
  → "All criteria are advisory or manual — final gate cannot produce PASS without deterministic evidence"
```

### Step 4: Deterministic Evidence Rule

**The core rule that prevents false PASS:**

```
IF no criterion was evaluated with deterministic evidence:
  verdict = HOLD
  reason = NO_DETERMINISTIC_CRITERIA
```

"Deterministic evidence" means `criterion.verification.deterministic === true` AND `criterion.verification.type !== 'llm_advisory'` AND `criterion.verification.type !== 'manual_review'`.

This rule prevents:
- LLM-based criteria claiming PASS without actual verification
- Manual review criteria being auto-satisfied
- Advisory criteria being treated as hard evidence

## Outputs

### FinalGateResult

```
interface FinalGateResult {
  gateName: 'FinalGate'
  verdict: 'PASS' | 'HOLD' | 'FAIL'
  reasonCodes: string[]
  diagnostics: Diagnostic[]
  failedCriteriaIds: string[]
  evidenceRefs: string[]        // All evidence refs supporting this verdict
  repairHint?: string
  
  contextUpdates: {
    criterionResults: CriterionResult[]     // Per-criterion evaluation
    overallVerdict: 'PASS' | 'HOLD' | 'FAIL'
    totalCriteria: number
    passedCriteria: number
    failedCriteria: number
    advisoryCriteria: number
    reportPath?: string                     // Path to generated report
    repairPacketPath?: string               // Path to generated repair packet
  }
  
  timestamp: string
  attemptId: string
}

interface CriterionResult {
  criterionId: string
  taskId: string
  verdict: 'PASS' | 'HOLD' | 'FAIL' | 'ADVISORY_ONLY' | 'MANUAL_REVIEW' | 'NOT_EVALUATED'
  evidenceRefs: string[]
  reasonCodes: string[]
  detail: string    // Human-readable explanation
}
```

## Reason Codes

| Code | Verdict | Condition |
|------|---------|-----------|
| `ALL_CRITERIA_MET` | PASS | All deterministic criteria pass |
| `CRITERIA_PARTIAL` | HOLD | Some criteria pass, some fail |
| `CRITERIA_FAILED` | FAIL | Criteria definitively failed |
| `NO_DETERMINISTIC_CRITERIA` | HOLD | All criteria are advisory or manual |
| `PRIOR_GATE_NOT_PASS` | HOLD | A prior gate did not pass |
| `FILE_NOT_FOUND` | HOLD | Expected file does not exist |
| `FILE_CONTENT_MISMATCH` | HOLD | File does not contain expected patterns |
| `DIFF_CONTENT_MISSING` | HOLD | Diff does not contain expected patterns |
| `FORBIDDEN_DIFF_CONTENT` | FAIL | Diff contains forbidden patterns |
| `COMMAND_OUTPUT_MISMATCH` | HOLD | Command output missing expected patterns |
| `TEST_FAILURES` | HOLD | Tests failed |
| `SCHEMA_VALIDATION_FAILED` | FAIL | Schema validation failed |
| `INTEGRATION_CONTRACT_FAILED` | HOLD | Integration contract not satisfied |
| `STATIC_PATTERN_MISSING` | HOLD | Static pattern not found |
| `CRITERION_NOT_HUMAN_APPROVED` | HOLD | Criterion not human-approved |
| `ADVISORY_CRITERION` | INFO | Criteria is advisory-only (informational) |
| `MANUAL_REVIEW_REQUIRED` | INFO | Criteria requires manual review |

## Verdict Ladder

```
All criteria pass, deterministic evidence present      → PASS
Some criteria pass, some fail (HOLD)                    → HOLD
All criteria are advisory or manual                      → HOLD
Prior gate returned HOLD                                 → HOLD
Prior gate returned FAIL                                 → FAIL (escalated)
Criteria definitively failed (forbidden content)         → FAIL
Criterion not human-approved                             → HOLD
All criteria pass but all through advisory evidence      → HOLD (NO_DETERMINISTIC_CRITERIA)
```

## HOLD vs FAIL Semantics

| Verdict | Meaning | Next Step |
|---------|---------|-----------|
| PASS | All deterministic criteria met | Task complete. Generate success report. |
| HOLD | Some criteria not met, or no deterministic evidence | Generate RepairPacket. Queue for next attempt. |
| FAIL | Criteria definitively violated, or prior gate FAIL | Human review required. Cannot auto-repair. |

FAIL is reserved for:
- Forbidden patterns found where they should not exist
- Schema validation failures
- Prior gate FAIL (escalated)
- Criteria with verification.type=import_graph when wiring is broken (v0.2+)

HOLD is the default for "not quite there yet" scenarios.

## Preventing False PASS

### Rule 1: No Advisory-Only PASS

Advisory criteria (`advisoryOnly: true`) and LLM/Manual criteria cannot produce PASS. If ALL criteria are advisory, the verdict is HOLD. If some criteria are advisory and some are deterministic, only the deterministic ones count toward PASS.

### Rule 2: No Agent-Only PASS

Criteria with `humanApproved: false` and `criteriaSource: agent_draft` cannot produce PASS. At least `humanApproved: true` or `criteriaSource: human/imported_human` is required.

### Rule 3: No Empty PASS

If `totalCriteria === 0` (no criteria in the plan), FinalGate returns HOLD (NO_CRITERIA_DEFINED). A plan without acceptance criteria cannot produce PASS.

### Rule 4: No Prior-Gate-FAIL PASS

If any prior gate returned FAIL, FinalGate cannot return PASS. The FAIL from the earlier gate propagates. This prevents FinalGate from "overriding" a safety failure.

## Repair Trigger

On HOLD or FAIL, the kernel:

1. Collects all failed criterion IDs
2. Collects all HOLD/FAIL gate verdicts
3. Generates a RepairPacket (see [RepairPacket Contract](08-repairpacket-v0.1.contract.yaml))
4. Generates an ACCP report
5. Returns the repair packet for the next attempt

On PASS, the kernel:
1. Generates a success ACCP report
2. Task is marked complete
3. No repair packet is generated

## Report Generation

On verdict (any outcome), FinalGate triggers report generation:
- ACCP YAML report with full verdict details
- Summary markdown for human reading
- Both stored in `.praxis/reports/<run-id>/`

See [Report Model](09-report-model.md) for full specification.

## Example Scenarios

| Scenario | Result |
|----------|--------|
| All 5 ACs pass, file_exists + test_output deterministic | PASS |
| 4/5 ACs pass, 1 file not found | HOLD |
| All ACs pass but none have deterministic verification | HOLD (NO_DETERMINISTIC_CRITERIA) |
| All ACs pass, but ExecGate FAIL (forbidden command) | FAIL (escalated) |
| 2 ACs are advisory, 2 are deterministic and PASS | PASS |
| Criterion has forbidden diff content | FAIL |
| No criteria in plan | HOLD |
| Agent-draft criteria not human-approved | HOLD |
| All ACs manual_review type | HOLD (MANUAL_REVIEW_REQUIRED) |
| All ACs pass, Test Gate HOLD (40/42 tests pass) | HOLD (TEST_FAILURES propagated) |

## Implementation Guidance

### File Structure

```
packages/kernel/src/
  gates/
    finalGate.ts               ← Main gate logic
  final/
    criterionEvaluator.ts      ← Per-criterion evaluation
    verdictAggregator.ts       ← Verdict ladder logic
    deterministicFilter.ts     ← Advisory evidence filter
```

### Key Constraints

1. FinalGate MUST NOT override prior gate verdicts
2. FinalGate MUST reject advisory-only criteria for PASS
3. FinalGate MUST reject non-human-approved criteria for PASS
4. FinalGate MUST require at least one deterministic criterion for PASS
5. FinalGate MUST evaluate ALL criteria even if some fail (provide full picture)
6. FinalGate MUST reference evidence records for each criterion verdict
7. FinalGate MUST NOT modify acceptance criteria or the plan
8. FinalGate MUST NOT execute any commands
9. FinalGate MUST produce a reason code for every criterion
10. FinalGate MUST generate a report on any verdict
