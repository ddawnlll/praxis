# TaskRun Lifecycle

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define every TaskRun lifecycle state, transition trigger, gate position, terminal invariant, and the rules that prevent false completion. This is the authoritative state machine specification for kernel/core.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document specifies the complete TaskRun finite state machine (FSM). Every state, every transition trigger, every gate position, and every terminal invariant is defined here. Any implementation of kernel/core must implement exactly this FSM. If the implementation's behavior differs from this document, the implementation is wrong.

---

## Scope

- All TaskRun states and valid transitions
- Transition triggers (what must happen for state X to become state Y)
- Gate positions (where EvidenceGate, ExecGate, FinalGate run in the lifecycle)
- Terminal state rules (COMPLETE, FAILED, ABORTED)
- Repair loop (HOLD/FAIL → RIM → RUNNING, max 7 attempts)
- False-done protection (empty diff, zero tests, agent claim without evidence)
- RIM routing (how HOLD/FAIL flows into Repair Intelligence Module)
- Circuit Breaker interaction (OPEN blocks new admissions, does not rewrite past verdicts)
- Namespace violation detection during CAPTURING
- Worker self-report handling (evidence only, never marks COMPLETE)

---

## Non-Goals

- Implementation code (this is a specification)
- RIM strategy internals (delegated to RIM spec in kernel/rim)
- Detailed Evidence Gate logic (delegated to Truth Engine spec)
- Assembly workflow details (delegated to Assembler spec)
- ACCP artifact generation details (async, non-blocking, delegated to ACCP spec)
- Worker process management details (delegated to adapters)

---

## Authoritative Decisions Used

| ID | Decision | Relevance |
|----|----------|-----------|
| D-028 | Worker self-report is not completion (Law 1) | Worker exit code, "done" message are evidence, never mark COMPLETE |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | Three gates are the sole completion authority |
| D-033 | EvidenceGate, ExecGate, FinalGate are kernel-owned | Gates live in kernel/truth-engine |
| D-036 | Missing human-authored acceptance criteria blocks completion | FinalGate defaults to FAIL without criteria |
| D-081 | RIM starts only after HOLD/FAIL gate outcomes | Repair loop activation |
| D-082 | Circuit Breaker can stop new admissions | OPEN prevents QUEUED → WORKSPACE_INIT |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN | Affects admission gating |
| D-095 | runtime_events append-only log | Every state transition must emit a runtime_event |
| D-105 | False-done tests are mandatory | Empty diff, zero tests, agent claim without evidence |
| D-106 | Empty diff must not complete | EvidenceGate HOLD on empty diff |
| D-107 | Zero tests ran must not pass ExecGate | ExecGate HOLD on zero tests |
| D-108 | Namespace violation must fail | FAIL verdict, detected during CAPTURING/VERIFYING |

---

## Conceptual Model

A TaskRun is the lifecycle of a single task within a Plan. Each TaskRun is assigned a namespace (exclusive file paths), a wave, a task type, a budget, and acceptance criteria. The TaskRun moves through states as the worker executes, evidence is captured, gates are evaluated, and the outcome is determined.

The FSM has three terminal states:

```
COMPLETE  — FinalGate PASS. Task done. Evidence preserved. FVR job enqueued.
FAILED    — Truth Engine FAIL. Evidence preserved. Human review required.
ABORTED   — Budget exhausted, max repair attempts reached, human abort, or Circuit Breaker OPEN during execution.
```

And one non-terminal loop:

```
REPAIR → RUNNING (retry, max 7 attempts) — structured repair via RIM strategy rotation
```

---

## Control Flow / State Diagram

```
                                    ┌──────────────┐
                                    │   DORMANT    │
                                    │              │
                                    │ TaskRun      │
                                    │ exists in    │
                                    │ plan but not │
                                    │ yet admitted │
                                    └──────┬───────┘
                                           │ PSAG: ADMIT + TaskSpec valid
                                           │ PSAG: REJECT → TaskRun never created
                                           ▼
                                    ┌──────────────┐
                                    │   QUEUED     │
                                    │              │
                                    │ Waiting for  │
                                    │ Governor     │
                                    │ slot + CB    │
                                    │ CLOSED       │
                                    └──────┬───────┘
                                           │ Governor: hasAvailableSlot()
                                           │ Circuit Breaker: CLOSED
                                           │ (OPEN → stays QUEUED,
                                           │  may ABORT if OPEN sustained)
                                           ▼
                                    ┌──────────────┐
                                    │ WORKSPACE_   │
                                    │ INIT         │
                                    │              │
                                    │ Creating     │
                                    │ worktree,    │
                                    │ namespace    │
                                    │ locks,       │
                                    │ hook config  │
                                    └──────┬───────┘
                                           │ worktree ready
                                           │ namespace locks acquired
                                           │ hook config installed
                                           │ env prepared
                                           ▼
                                    ┌──────────────┐
                ┌───────────────────│   RUNNING    │◄──────────────────┐
                │                   │              │                   │
                │                   │ Worker       │                   │
                │                   │ executing    │                   │
                │                   │ in isolated  │                   │
                │                   │ workspace    │                   │
                │                   └──────┬───────┘                   │
                │                          │                          │
                │                          │ worker process exits      │
                │                          │ OR adapter returns        │
                │                          │ OR timeout reached        │
                │                          ▼                          │
                │                   ┌──────────────┐                   │
                │                   │  CAPTURING   │                   │
                │                   │              │                   │
                │                   │ git diff     │                   │
                │                   │ changed files│                   │
                │                   │ transcript   │                   │
                │                   │ test output  │                   │
                │                   │ namespace    │                   │
                │                   │ check        │                   │
                │                   │ EHC build    │                   │
                │                   └──────┬───────┘                   │
                │                          │                          │
                │                          │ capture complete          │
                │                          ▼                          │
                │                   ┌──────────────────────────────────┐
                │                   │          VERIFYING               │
                │                   │                                  │
                │                   │  ┌────────────────────────────┐ │
                │                   │  │ Gate 1: EvidenceGate        │ │
                │                   │  │ During CAPTURING→VERIFYING   │ │
                │                   │  │ Did real file changes occur  │ │
                │                   │  │ inside namespace?            │ │
                │                   │  │ Output: CONTINUE / HOLD /    │ │
                │                   │  │          FAIL                │ │
                │                   │  └─────────────┬──────────────┘ │
                │                   │                │                │
                │                   │  CONTINUE      │                │
                │                   │                ▼                │
                │                   │  ┌────────────────────────────┐ │
                │                   │  │ Gate 2: ExecGate            │ │
                │                   │  │ During VERIFYING             │ │
                │                   │  │ Did commands run and did     │ │
                │                   │  │ tests actually pass?         │ │
                │                   │  │ Output: CONTINUE / HOLD /    │ │
                │                   │  │          FAIL                │ │
                │                   │  └─────────────┬──────────────┘ │
                │                   │                │                │
                │                   │  CONTINUE      │                │
                │                   │                ▼                │
                │                   │  ┌────────────────────────────┐ │
                │                   │  │ Gate 3: FinalGate           │ │
                │                   │  │ During VERIFYING             │ │
                │                   │  │ Are all human-authored       │ │
                │                   │  │ acceptance criteria          │ │
                │                   │  │ satisfied?                   │ │
                │                   │  │ Output: PASS / HOLD / FAIL   │ │
                │                   │  └────────────────────────────┘ │
                │                   │                                  │
                │                   └──┬───────────┬───────────┬──────┘
                │                      │           │           │
                │                    PASS        HOLD        FAIL
                │                      │           │           │
                │                      ▼           ▼           ▼
                │               ┌──────────┐ ┌──────────┐ ┌──────────┐
                │               │ COMPLETE │ │  REPAIR  │ │  FAILED  │
                │               │          │ │          │ │          │
                │               │ Terminal │ │ ┌──────┐ │ │ Terminal │
                │               │ FVR      │ │ │ RIM  │ │ │ Human    │
                │               │ enqueued │ │ │acti- │ │ │ review   │
                │               │ Evidence │ │ │vated │ │ │ required │
                │               │ preserved│ │ └──┬───┘ │ │ Evidence │
                │               └──────────┘ │    │    │ │ preserved│
                │                            │    │    │ └──────────┘
                │                            │    ▼    │
                │                            │ attempts │
                │                            │ < 7?     │
                │                            │          │
                │                            │ YES ─────┘
                │                            │   (return to RUNNING
                │                            │    with RepairPacket)
                │                            │
                │                            │ NO (attempt = 7)
                │                            ▼
                │                     ┌──────────┐
                │                     │ ABORTED  │
                │                     │          │
                │                     │ Terminal │
                │                     │ Budget   │
                │                     │ exhausted│
                │                     │ Evidence │
                │                     │ preserved│
                │                     └──────────┘
                │
                │     (During RUNNING — Circuit Breaker OPEN →)
                │
                └────── ABORTED (controlled abort, evidence preserved)
```

### PAUSED State (human intervention)

```
Any state after RUNNING can transition to PAUSED when a HIR (Human Intervention Required)
threshold is met:

  VERIFYING ──(HIR triggered)──→ PAUSED
  REPAIR    ──(HIR triggered)──→ PAUSED

From PAUSED:
  PAUSED ──(human resume + hint)─────→ RUNNING (with knowledge_inject or hint_inject)
  PAUSED ──(human abort)─────────────→ ABORTED
  PAUSED ──(timeout)─────────────────→ RUNNING (with knowledge_inject)
```

### All Valid Transitions

```
DORMANT       → QUEUED           (PSAG ADMIT)
QUEUED        → WORKSPACE_INIT   (Governor slot + CB CLOSED)
QUEUED        → ABORTED          (CB OPEN sustained, or human cancel)
WORKSPACE_INIT→ RUNNING           (worktree ready, hooks installed)
WORKSPACE_INIT→ ABORTED          (worktree creation failed, namespace lock unavailable)
RUNNING       → CAPTURING        (worker process exits, adapter returns result)
RUNNING       → ABORTED          (CB OPEN during execution, controlled abort)
RUNNING       → PAUSED           (HIR threshold met)
CAPTURING     → VERIFYING        (evidence captured, EHC built)
CAPTURING     → ABORTED          (CB OPEN during capture, controlled abort)
VERIFYING     → COMPLETE         (FinalGate PASS)
VERIFYING     → REPAIR           (any gate HOLD or FinalGate FAIL with attempts < 7)
VERIFYING     → FAILED           (FinalGate FAIL with no repair possible or criteria unfixable)
VERIFYING     → PAUSED           (HIR threshold met)
REPAIR        → RUNNING          (RepairPacket built, retry attempt < 7)
REPAIR        → PAUSED           (HIR threshold met)
REPAIR        → ABORTED          (attempt 7 reached, budget exhausted)
PAUSED        → RUNNING          (human resume with hint/knowledge_inject)
PAUSED        → ABORTED          (human abort)
```

---

## Component Responsibilities

### kernel/core/fsm

- Owns TaskRun state machine
- Applies transitions atomically
- Validates transition legality (e.g., cannot go from COMPLETE to RUNNING)
- Emits `task_run.updated` runtime event on every state change
- Records transition timestamp, trigger, and metadata
- Never marks COMPLETE based on worker self-report

### kernel/core/scheduler

- Decides which QUEUED TaskRun should start next
- Respects wave ordering and dependency graph
- Consults Governor for slot availability
- Consults Circuit Breaker for system safety state
- Queues runs when Circuit Breaker is OPEN (no WORKSPACE_INIT transition)

### kernel/core/workspace

- Creates isolated git worktree per TaskRun
- Acquires namespace locks
- Installs hook config for external tools
- Prepares environment variables (PRAXIS_RUN_ID, PRAXIS_ATTEMPT_ID, etc.)
- Cleans up worktrees after terminal state (or defers to post-assembly cleanup)

### kernel/evidence

- Captures git diff and changed file list during CAPTURING state
- Captures command transcript (KernelOwnedTranscript)
- Parses test output (Jest, Vitest, Pytest, Go test)
- Builds Evidence Hash Chain
- Performs namespace check: all changed files must be within declared namespace
- Classifies EHC breaks

### kernel/truth-engine/gates

- EvidenceGate: runs during CAPTURING → VERIFYING transition
- ExecGate: runs during VERIFYING state
- FinalGate: runs during VERIFYING state, after ExecGate
- All gates produce: CONTINUE (pass), HOLD, or FAIL
- Gate evaluation reads criteria from TaskSpec (human-authored only)

### kernel/rim

- Activated only when VERIFYING produces HOLD or FAIL
- Computes failure signature from gate verdicts
- Selects repair strategy based on attempt number
- Builds RepairPacket with strategy context
- Does not activate on PASS (no repair needed)

### kernel/circuit-breaker

- Checks system safety before QUEUED → WORKSPACE_INIT
- OPEN: blocks new TaskRun starts
- Does NOT modify state of already-RUNNING TaskRuns (cannot rewrite past)
- In-flight TaskRuns in RUNNING can be controlled-aborted if OPEN is sustained

### Server (server/event-bus)

- Persists `task_run.updated` runtime events
- Streams events to Desktop Mission Control via SSE
- Does not change TaskRun state (that is kernel-only)

---

## MUST / MUST NOT Rules

### MUST

- Every state transition MUST emit a `task_run.updated` runtime event
- Worker exit code 0 and "done" claims MUST be treated only as evidence input to capture
- EvidenceGate MUST run as part of the CAPTURING → VERIFYING transition
- ExecGate MUST run during VERIFYING, after EvidenceGate returns CONTINUE
- FinalGate MUST run during VERIFYING, after ExecGate returns CONTINUE
- COMPLETE MUST only be reachable via FinalGate PASS
- RIM MUST activate on HOLD/FAIL only; must not activate on PASS
- Repair attempts MUST be capped at 7 (attempt 7 → ABORTED)
- Namespace check MUST run during CAPTURING before any gate evaluation
- All gate verdicts MUST be recorded and preserved
- Evidence MUST be preserved for all terminal states (COMPLETE, FAILED, ABORTED)
- FVR job MUST be enqueued when TaskRun reaches COMPLETE
- Circuit Breaker OPEN MUST prevent QUEUED → WORKSPACE_INIT transition

### MUST NOT

- Worker self-report MUST NOT trigger COMPLETE state transition
- Worker exit code 0 alone MUST NOT trigger COMPLETE
- Adapter message "task completed" MUST NOT trigger COMPLETE
- UI MUST NOT trigger state transitions or gate verdicts
- Repaired attempts MUST NOT skip gate re-evaluation (every attempt goes through all gates)
- EvidenceGate MUST NOT pass on an empty diff
- ExecGate MUST NOT pass when zero tests ran
- FinalGate MUST NOT pass without human-authored acceptance criteria
- RIM MUST NOT activate on PASS outcomes

---

## False-Done Protection

The following scenarios are false-completion signals. They must be detected and must prevent COMPLETE.

### Empty Diff

```
Signal: Worker exits with code 0, claims "task completed", but git diff is empty.

Detection: EvidenceGate checks: is git diff non-empty? Are any files changed?

Response:
  EvidenceGate: HOLD (insufficient evidence)
  FinalGate: cannot PASS (no changes to evaluate against criteria)
  RIM: activated with failure signature "diff_empty = true"

Worker self-report "done" is ignored as completion authority.
```

### Zero Tests Ran

```
Signal: Worker exits with code 0, claims "all tests passed", but transcript shows
        no test runner was invoked, or TestOutputParser finds tests_ran = 0.

Detection: ExecGate checks: commands_ran > 0? tests_ran > 0?

Response:
  ExecGate: HOLD (zero tests ran)
  RIM: activated with failure signature "commands_ran = 0" or "suite_empty = true"

Worker claim "all tests passed" is evidence to be checked, not accepted as fact.
```

### Agent Claim Without Evidence

```
Signal: Worker claims completion (exit 0, stdout "done") but:
  - No files changed
  - No commands ran
  - No test output
  - Transcript may be missing or empty

Detection: EvidenceGate finds no evidence of work performed.

Response:
  EvidenceGate: FAIL (no evidence, possible fabrication)
  This flows to FAILED terminal state (human review required).
```

### Namespace Violation

```
Signal: Worker wrote files outside its declared namespace (e.g., worker
        namespace_a wrote to namespace_b's file).

Detection: Namespace check during CAPTURING enumerates changed files and
           verifies each is within the declared namespace[].

Response:
  EvidenceGate: FAIL (namespace violation)
  Attempt FAILED or REPAIR depending on severity and attempt count.
  Namespace violation is a critical safety signal.
```

---

## Failure Modes

| Failure | Detection Point | Response | Terminal? |
|---------|----------------|----------|-----------|
| PSAG rejects TaskSpec | DORMANT (never created) | TaskRun not created. Plan rejected. | N/A |
| Circuit Breaker OPEN | QUEUED | Cannot transition to WORKSPACE_INIT. Stays QUEUED or ABORTED. | Potentially (if OPEN sustained) |
| Worktree creation fails | WORKSPACE_INIT | ABORTED. Evidence: worktree creation log. | Yes (ABORTED) |
| Namespace lock unavailable | WORKSPACE_INIT | ABORTED or retry with delay. | Potentially |
| Worker process crashes during RUNNING | RUNNING (adapter detects) | Transition to CAPTURING with partial evidence. No transcript = evidence of crash. | No (evidence captured, may repair) |
| Worker rate limit hit | RUNNING (adapter detects) | Attempt paused. If retry possible, REPAIR → RUNNING. If not, ABORTED. | Potentially |
| Worker times out (budget exceeded) | RUNNING (timer) | CAPTURING with partial evidence. May ABORT if budget fully exhausted. | Potentially |
| Empty diff | EvidenceGate during CAPTURING→VERIFYING | HOLD. RIM repair or ABORT. | No (repairable) |
| Zero tests ran | ExecGate during VERIFYING | HOLD. RIM repair or ABORT. | No (repairable) |
| Test failures detected | ExecGate during VERIFYING | HOLD. RIM repair strategy: scope_narrow, context_expand. | No (repairable) |
| Namespace violation | EvidenceGate during CAPTURING | FAIL. RIM or human review. | Potentially FAILED |
| Divergence detected | CAPTURING (divergence detector) | ExecGate FAIL (CONFIRMED divergence). Circuit Breaker may open on CONFIRMED. | Potentially FAILED |
| EHC integrity break | CAPTURING (EHC verifier) | Evidence chain broken. EHC classification. CONFIRMED → Circuit Breaker opens. | Depends on classification |
| HIR threshold reached (attempt 5, scope_narrow + HIR) | VERIFYING or REPAIR | PAUSED. Human action required: resume with hint or abort. | No (paused) |
| Attempt 7 reached | REPAIR | ABORTED. Budget exhausted. Evidence preserved. | Yes (ABORTED) |
| Human abort during PAUSED | PAUSED | ABORTED. Evidence preserved. | Yes (ABORTED) |
| FVR generation fails | Post-COMPLETE (async) | ACCP job marked pending. Retry on next ACCP worker cycle. Does NOT affect TaskRun COMPLETE. | No (async) |

---

## Terminal Invariants

### COMPLETE

```
- FinalGate: PASS
- EvidenceGate: PASS (real changes, inside namespace)
- ExecGate: PASS (commands ran, tests passed)
- All required human-authored acceptance criteria satisfied
- Evidence Hash Chain intact and verified
- Evidence records preserved
- FVR job enqueued (async, non-blocking)
- Circuit Breaker state does not affect this verdict (past verdict, immutable)
```

### FAILED

```
- Truth Engine: FAIL (at least one gate)
- For FinalGate FAIL: acceptance criteria not met, or criteria unfixable
- For EvidenceGate FAIL: namespace violation, EHC CONFIRMED break
- For ExecGate FAIL: forbidden command, confirmed divergence
- Evidence preserved (audit trail intact)
- Human review required (HIR queued in desktop)
- NOT the same as repairable HOLD — FAILED means uncorrectable by RIM
```

### ABORTED

```
- Budget exhausted (attempt 7 reached)
- OR human abort (via HIR resolution)
- OR Circuit Breaker OPEN during RUNNING (controlled abort)
- OR worktree creation failure (unrecoverable environment issue)
- Evidence preserved (whatever was captured before abort)
- No FVR job enqueued (never reached COMPLETE)
```

---

## Test / Gate Implications

| Test Category | Specific Tests |
|---------------|---------------|
| State transitions | All valid transitions work. Invalid transitions (COMPLETE → RUNNING) are rejected. |
| Transition events | Every transition emits `task_run.updated` runtime event with correct payload. |
| Empty diff | EvidenceGate returns HOLD. RIM activates. Does not reach COMPLETE. |
| Zero tests ran | ExecGate returns HOLD. RIM activates. Does not reach COMPLETE. |
| Agent claim without evidence | EvidenceGate returns FAIL. Goes to FAILED (not repairable). |
| Namespace violation | EvidenceGate returns FAIL. Goes to FAILED or REPAIR depending on context. |
| Repair loop | HOLD → REPAIR → RUNNING (1-6 attempts). Attempt 7 → ABORTED. |
| Strategy rotation | RIM selects correct strategy per attempt number. |
| Circuit Breaker OPEN | QUEUED TaskRun not started. In-flight: controlled abort. |
| Circuit Breaker HALF_OPEN | Exactly one probe allowed. No other new runs. |
| Gate order | EvidenceGate always runs before ExecGate. ExecGate always before FinalGate. |
| PASS → COMPLETE | FinalGate PASS always yields COMPLETE. FVR enqueued. |
| FAIL → FAILED | FinalGate FAIL (unfixable criteria) yields FAILED. Human action queued. |
| HOLD → REPAIR | Any gate HOLD yields REPAIR (with attempts < 7). |
| HIR trigger | PAUSED state entered. Human action appears in queue. |
| Worker self-report | Worker exit 0 + "done" does not shortcut gates. All evidence evaluated. |
| Terminal invariants | COMPLETE: FinalGate PASS + EHC intact. FAILED: evidence preserved, human review required. ABORTED: evidence preserved, budget/human/CB reason. |

---

## Decision Compliance Checklist

- [x] Worker self-report never marks COMPLETE (D-028, Law 1)
- [x] Truth Engine owns attempt-level PASS/HOLD/FAIL (D-032)
- [x] EvidenceGate, ExecGate, FinalGate are kernel-owned (D-033)
- [x] Missing acceptance criteria blocks completion (D-036)
- [x] RIM starts only after HOLD/FAIL (D-081)
- [x] Circuit Breaker OPEN blocks new admissions (D-082)
- [x] Circuit Breaker does not rewrite past verdicts (D-082)
- [x] Circuit Breaker states: CLOSED, OPEN, HALF_OPEN (D-085)
- [x] UI never decides completion (D-029)
- [x] Adapter never decides completion (D-030)
- [x] False-done tests mandatory: empty diff (D-106), zero tests (D-107), namespace violation (D-108)
- [x] Repair loop capped at 7 attempts
- [x] All state transitions produce runtime_event (D-095)

---

## Open Questions

| ID | Question | Relevance |
|----|----------|-----------|
| Q1 | Should CAPTURING happen while worker is still running (streaming), or only after worker exits? Streaming capture enables earlier gate evaluation but adds complexity. | P3 implementation |
| Q2 | What is the exact HIR threshold? At attempt 5 (scope_narrow), always? Or configurable based on failure severity? | RIM design (P3) |
| Q3 | How long should QUEUED TaskRuns wait when Circuit Breaker is OPEN before being auto-ABORTED? Indefinitely? Timeout-based? | CB design (P3) |
| Q4 | Should there be a TERMINATING state between RUNNING and ABORTED when CB opens mid-run? A grace period for controlled abort? | CB + FSM interaction (P3) |
| Q5 | When a TaskRun is PAUSED awaiting human action, does the Governor count it as an active worker? (Probably not — it is not consuming compute.) | Governor design (P3) |
| Q6 | Should the EHC be built incrementally during RUNNING (as hook events arrive) or atomically during CAPTURING? Incremental building enables earlier detection of chain breaks. | Evidence design (P3) |

---

## Audit Notes

- The state diagram uses WORKSPACE_INIT as a distinct state, not a substate of RUNNING. This gives operators visibility into whether a TaskRun is still acquiring resources or actively executing.
- PAUSED is a distinct state for human intervention visibility. It is not a substate of REPAIR because human action fundamentally differs from automated RIM strategies.
- The repair loop (REPAIR → RUNNING) always re-enters RUNNING so that a new attempt starts fresh: the worker is re-invoked with the RepairPacket context, produces new output, and goes through full capture → verify again. No gate is skipped on repair.
- FAILED is reserved for cases where RIM strategies cannot fix the problem (e.g., acceptance criteria are fundamentally unmet, namespace violation is severe, or divergence is CONFIRMED). FAILED requires human review. HOLD is for cases where RIM can attempt structured repair.
- Circuit Breaker OPEN during RUNNING triggers a controlled abort. The in-flight attempt is terminated. The evidence captured so far is preserved. The TaskRun goes to ABORTED. This is not a FAILED state because the worker did not necessarily fail — the system became unsafe.
- The document was written against `docs/decisions.md` as the canonical source. Any conflict is resolved in favor of decisions.md.
