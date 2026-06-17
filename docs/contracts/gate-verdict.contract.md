# Gate Verdict Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the GateVerdict contract -- the shape, semantics, and routing rules for every verdict produced by the Truth Engine's three gates (EvidenceGate, ExecGate, FinalGate). The FinalGate PASS is the sole completion signal in PRAXIS per Law 1.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

A GateVerdict is the atomic output of a gate evaluation. It declares whether an attempt has PASSED, is on HOLD (incomplete but repairable), or has FAILED (terminal for this attempt). The three gates evaluate in sequence: EvidenceGate -> ExecGate -> FinalGate. Only FinalGate PASS = attempt complete. This contract defines what each verdict means, how it routes to downstream components (RIM, HIR, Circuit Breaker), and what is forbidden from producing verdicts.

---

## Scope

- Defines the GateVerdict shape and all fields
- Defines the `gate_name` enum values
- Defines the `verdict` enum values (PASS, HOLD, FAIL)
- Defines verdict routing: PASS -> proceed, HOLD -> RIM, FAIL -> human review
- Defines reason_codes taxonomy
- Defines FinalGate PASS as the sole completion signal (Law 1)

---

## Non-Goals

- How the Truth Engine decides a verdict (gate implementation logic)
- How repair packets are built (delegated to `repair-packet.contract.md`)
- How human intervention requests are surfaced (HIR territory)
- How Circuit Breaker tracks failure rates (CB territory)
- Storage schema for verdicts (storage territory)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-028 | Worker self-report is not completion | Worker output is evidence, not a verdict |
| D-029 | UI never decides completion | GateVerdict are produced only by kernel/truth-engine |
| D-030 | Adapter never decides completion | Adapters do not emit GateVerdict |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | This contract defines the verdict shape |
| D-033 | EvidenceGate, ExecGate, FinalGate are kernel-owned | Verdicts originate in kernel/truth-engine only |
| D-081 | RIM starts only after HOLD/FAIL | Verdict routing: HOLD/FAIL -> RIM |
| D-082 | Circuit Breaker can stop new admissions | Failure rate tracked from FAIL verdicts |
| D-106 | Empty diff must not complete | FinalGate must catch empty-diff attempts |
| D-107 | Zero tests ran must not pass ExecGate | ExecGate must detect zero-test scenarios |

---

## Conceptual Model

```
┌───────────────────────────────────────────────────────────┐
│                    Truth Engine                            │
│                                                           │
│  Evidence ──► EvidenceGate ──► GateVerdict                 │
│                 │                                          │
│                 ├─ PASS ──► ExecGate ──► GateVerdict       │
│                 ├─ HOLD ──► RIM (repair)                  │
│                 └─ FAIL ──► Human Review                  │
│                               │                            │
│                 PASS ──► FinalGate ──► GateVerdict         │
│                          │                                │
│                          ├─ PASS ──► ATTEMPT COMPLETE      │
│                          │           (the ONLY signal)     │
│                          ├─ HOLD ──► RIM (repair)         │
│                          └─ FAIL ──► Human Review         │
│                                                           │
│  FinalGate PASS = attempt complete. Nothing else.         │
└───────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `kernel/truth-engine/gates/evidence-gate` | Produces GateVerdict for EvidenceGate evaluation |
| `kernel/truth-engine/gates/exec-gate` | Produces GateVerdict for ExecGate evaluation |
| `kernel/truth-engine/gates/final-gate` | Produces GateVerdict for FinalGate evaluation; FinalGate PASS is THE completion signal |
| `kernel/truth-engine/verdict/verdict-router` | Routes verdicts: PASS continues pipeline, HOLD triggers RIM, FAIL triggers human review |
| `kernel/rim/` | Consumes HOLD/FAIL verdicts to build repair packets |
| `kernel/circuit-breaker/` | Consumes aggregate failure rate from FAIL verdicts |
| `interface/desktop/` | Renders verdicts for operator visibility; does NOT create verdicts |

---

## Field Definitions

### GateVerdict

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `gate_name` | GateNameEnum | Yes | Which gate produced this verdict | Must be 'EvidenceGate', 'ExecGate', or 'FinalGate' |
| `verdict` | VerdictEnum | Yes | The outcome of gate evaluation | Must be 'PASS', 'HOLD', or 'FAIL' |
| `reason_codes` | string[] | Yes | Machine-readable reasons for the verdict | At least one reason code required |
| `failed_criteria_ids` | string[] | Yes | IDs of acceptance criteria that failed | Empty array for PASS; referenced from TaskSpec |
| `evidence_refs` | string[] | Yes | EvidenceRecord IDs supporting this verdict | At least one evidence ref required |
| `repair_hint` | string \| null | No | Human-readable hint for repair (HOLD only) | Null for PASS or FAIL; non-null recommended for HOLD |
| `attempt_id` | string | Yes | The attempt this verdict evaluates | Must reference a valid attempt |
| `timestamp` | ISO 8601 string | Yes | When the verdict was produced | Must be after all referenced evidence timestamps |

### `gate_name` Enum

| Value | Gate Order | Question Answered |
|-------|-----------|-------------------|
| `EvidenceGate` | 1st | Did real file changes occur inside the declared namespace? |
| `ExecGate` | 2nd | Did commands run, and did tests actually pass? |
| `FinalGate` | 3rd | Are all required human-authored acceptance criteria satisfied? |

### `verdict` Enum

| Value | Meaning | Routing | Reversible? |
|-------|---------|---------|-------------|
| `PASS` | Criteria met; proceed to next gate or completion | Next gate in sequence (or COMPLETE if FinalGate) | No; once PASS, cannot be reversed for same attempt |
| `HOLD` | Incomplete; repair possible | RIM builds RepairPacket for next attempt | Yes; next attempt may PASS or FAIL |
| `FAIL` | Criteria violated; terminal for this attempt | Human review queue; attempt ends | Yes; human may override with repair context |

---

## Verdict Routing Rules

### PASS Routing

```
EvidenceGate PASS --> ExecGate evaluation
ExecGate PASS      --> FinalGate evaluation
FinalGate PASS     --> ATTEMPT COMPLETE (sole completion signal)
```

A PASS verdict:
- Permits the next gate to evaluate (or declares completion if FinalGate)
- Does NOT trigger RIM
- Does NOT trigger human review
- Is appended to the attempt's verdict history
- Is emitted as a runtime event

### HOLD Routing

```
AnyGate HOLD --> RIM (Repair Intelligence Module)
```

A HOLD verdict:
- Indicates the attempt is incomplete but repairable
- Triggers RIM to build a RepairPacket for the next attempt
- Does NOT terminate the TaskRun (repair retry loop continues)
- Contains a `repair_hint` to guide the repair strategy
- Does NOT decrement the attempt budget (repair is expected)

### FAIL Routing

```
AnyGate FAIL --> Human Review (terminal for this attempt)
```

A FAIL verdict:
- Indicates criteria were violated, not merely unmet
- Terminates the current attempt (does not retry automatically)
- Places the TaskRun in human review state
- Does NOT trigger automatic RIM (human decides next action)
- Is emitted as a runtime event with full diagnostic context

---

## Reason Codes Taxonomy

The `reason_codes` array uses a flat namespace of machine-readable codes. Each gate has its own set of known codes.

### EvidenceGate Reason Codes

| Code | Meaning | Typical Verdict |
|------|---------|----------------|
| `EVIDENCE_EMPTY` | No evidence records for this attempt | HOLD |
| `EVIDENCE_CHAIN_BROKEN` | EHC integrity check failed | FAIL |
| `DIFF_EMPTY` | Git diff is empty (no changes made) | HOLD |
| `DIFF_NOT_EMPTY` | Git diff has content | PASS |
| `NAMESPACE_OK` | All changes within declared namespace | PASS |
| `NAMESPACE_VIOLATION` | Changes detected outside declared namespace | FAIL |
| `FILES_CHANGED_MISMATCH` | Claimed changed files list != actual diff | HOLD |

### ExecGate Reason Codes

| Code | Meaning | Typical Verdict |
|------|---------|----------------|
| `TRANSCRIPT_MISSING` | No kernel-owned transcript available | HOLD |
| `NO_COMMANDS_RAN` | Worker ran zero commands | HOLD |
| `EXIT_CODE_ZERO` | All commands exited successfully | PASS |
| `EXIT_CODE_NONZERO` | At least one command exited non-zero | HOLD |
| `TESTS_RAN_ZERO` | Test runner detected but zero tests executed | HOLD |
| `TESTS_PASSED` | All tests passed (tests_ran > 0, failures = 0) | PASS |
| `TESTS_FAILURES` | Tests ran but some failed (failures > 0) | HOLD |
| `DIVERGENCE_CONFIRMED` | Confirmed divergence between hook output and worker claim | FAIL |
| `FORBIDDEN_COMMAND` | Worker ran a forbidden/prohibited command | FAIL |

### FinalGate Reason Codes

| Code | Meaning | Typical Verdict |
|------|---------|----------------|
| `ALL_CRITERIA_MET` | All required acceptance criteria satisfied | PASS |
| `CRITERIA_PARTIAL` | Some criteria met, some not met | HOLD |
| `CRITERIA_NONE_MET` | No acceptance criteria met | FAIL |
| `CRITERIA_MISSING` | TaskSpec has no human-authored acceptance criteria | FAIL |
| `FILE_NOT_FOUND` | Required file (file_exists criterion) missing | HOLD |
| `TEST_FAILURE` | Test output does not satisfy test_passes criterion | HOLD |
| `COMMAND_OUTPUT_MISMATCH` | Command output does not match expected | HOLD |
| `DIFF_CONTAINS_UNEXPECTED` | Diff contains patterns that violate no_diff_contains criterion | HOLD |
| `DIFF_MISSING_EXPECTED` | Diff does not contain patterns required by diff_contains criterion | HOLD |

---

## MUST Rules

1. **MUST** produce a GateVerdict for every gate evaluation (no silent gate passage).
2. **MUST** only produce GateVerdict from within `kernel/truth-engine/gates/`.
3. **MUST** include at least one `reason_code` in every verdict.
4. **MUST** reference at least one EvidenceRecord in `evidence_refs`.
5. **MUST** route PASS verdicts to the next gate in sequence.
6. **MUST** route HOLD verdicts to RIM for repair packet generation.
7. **MUST** route FAIL verdicts to human review.
8. **MUST** treat FinalGate PASS as the sole completion signal (Law 1).
9. **MUST** produce verdict timestamps that are after all referenced evidence timestamps.
10. **MUST** persist every verdict before routing to downstream components.

## MUST NOT Rules

1. **MUST NOT** produce a GateVerdict from an adapter (D-030).
2. **MUST NOT** produce a GateVerdict from the UI (D-029).
3. **MUST NOT** produce a GateVerdict from a hook (D-031).
4. **MUST NOT** allow a worker to produce or influence a GateVerdict directly.
5. **MUST NOT** produce a PASS verdict for FinalGate if any required criteria are unmet.
6. **MUST NOT** produce a PASS verdict for EvidenceGate if namespace violation is detected.
7. **MUST NOT** produce a PASS verdict for ExecGate if divergence is confirmed.
8. **MUST NOT** skip a gate in the sequence (EvidenceGate -> ExecGate -> FinalGate is mandatory).
9. **MUST NOT** emit an empty `reason_codes` array.
10. **MUST NOT** emit a verdict without corresponding evidence references.

---

## Forbidden Authority Fields

The following fields or behaviors are explicitly forbidden in a GateVerdict:

| Forbidden | Reason |
|-----------|--------|
| `produced_by='adapter'` | Adapters never decide completion (D-030) |
| `produced_by='ui'` | UI never decides completion (D-029) |
| `produced_by='hook'` | Hooks never decide truth (D-031) |
| `produced_by='worker'` | Workers never verify themselves |
| `confidence` field | The Truth Engine does not guess; criteria are deterministic |
| `overrides` field | No component can override a gate verdict without human action |
| `auto_retry` field | Retry is decided by RIM strategy rotation, not the verdict itself |
| UI-generated verdict | No "Mark Complete" button produces a GateVerdict |

---

## Failure Modes

| Failure | Detection | Consequence |
|---------|-----------|-------------|
| Missing gate in sequence | Pipeline invariant check: EvidenceGate must have verdict before ExecGate | Attempt HOLD; pipeline blocked |
| Contradictory verdicts for same gate | Two GateVerdict with same attempt_id and gate_name | Latest verdict wins; earlier discarded with warning |
| Verdict without evidence | evidence_refs is empty or references non-existent EvidenceRecords | Verdict invalidated; gate re-evaluation |
| UI-originated verdict | Verdict source validation fails | Rejected with security event |
| Adapter-originated verdict | Verdict source validation fails | Rejected with security event |
| FinalGate PASS with unmet criteria | failed_criteria_ids non-empty but verdict is PASS | Verdict invalid; this is a kernel bug |

---

## Test / Gate Implications

### Tests Required

- EvidenceGate produces PASS when diff non-empty and namespace OK
- EvidenceGate produces HOLD when diff empty
- EvidenceGate produces FAIL when namespace violated
- ExecGate produces PASS when tests ran > 0 and failures = 0
- ExecGate produces HOLD when zero tests ran
- ExecGate produces FAIL when divergence confirmed
- FinalGate produces PASS only when all required criteria met
- FinalGate produces HOLD when some criteria unmet (repairable)
- FinalGate produces FAIL when criteria violated (terminal)
- FinalGate PASS is the only signal that marks attempt complete
- Verdict routing: PASS goes to next gate, HOLD goes to RIM, FAIL goes to human review
- Adapter-emitted verdict is rejected
- UI-emitted verdict is rejected
- Verdict with empty reason_codes is rejected

---

## Decision Compliance Checklist

- [ ] D-028: Worker self-report is not completion; verdicts come from Truth Engine only
- [ ] D-029: UI never decides completion; no UI-generated GateVerdict
- [ ] D-030: Adapter never decides completion; no adapter-generated GateVerdict
- [ ] D-032: Truth Engine owns attempt-level PASS/HOLD/FAIL
- [ ] D-033: EvidenceGate, ExecGate, FinalGate are kernel-owned
- [ ] D-081: RIM starts only after HOLD/FAIL gate outcomes
- [ ] D-106: Empty diff must not complete; EvidenceGate must catch this
- [ ] D-107: Zero tests ran must not pass ExecGate; ExecGate must catch this

---

## Open Questions

1. Should verdicts support a `superseded_by` field for idempotent re-evaluation (e.g., after evidence correction)?
2. Should there be a verdict severity level within HOLD (e.g., minor incompleteness vs. major gap)?
3. Should FinalGate cache partial criteria evaluations across repair attempts, or re-evaluate all criteria from scratch each time?

---

## Audit Notes

- This contract is DRAFT_FOR_AUDIT. Reason codes are a living taxonomy and will expand during implementation.
- The three-gate sequence (EvidenceGate -> ExecGate -> FinalGate) is non-negotiable per Law 1.
- FinalGate PASS as the sole completion signal means no other event, state transition, or component claim can declare an attempt complete.
- All verdict routing must be verified end-to-end: PASS chains correctly, HOLD triggers RIM correctly, FAIL triggers human review correctly.
