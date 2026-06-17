# ACCP Artifact Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the async ACCP artifact generation pipeline — how FVR and PRR are produced without blocking the execution critical path.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

ACCP (Autonomous Coding Compiler Protocol) artifacts — the Final Verification Report (FVR) and Phase Review Report (PRR) — are generated asynchronously after execution completes. They must never block the execution critical path. This pipeline defines how artifacts are enqueued, generated, stored, and surfaced in the UI.

## Scope

- Async artifact job queue
- FVR per TaskRun
- PRR per wave
- ACCP compiler role (kernel/accp, ported from pi/packages/accp-compiler)
- Artifact failure handling (does not roll back execution)
- Artifact visibility in Desktop Mission Control

## Non-Goals

- ACCP compiler internals (port in P0.3)
- Execution pipeline (see `docs/pipelines/overview.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| D-037 | ACCP artifacts are async and non-blocking |
| D-038 | ACCP must not block execution critical path |
| D-039 | accp-compiler ported to kernel/accp |
| D-040 | ACCP compiler is not the Truth Engine |
| D-042 | FVR and PRR produced later as async artifacts |
| D-043 | Do not expand ACCP report types in MVP unless evidence requires |

---

## Conceptual Model

```
                    Execution Critical Path
 ┌─────────────────────────────────────────────────────────────────┐
 │ ADMIT → EXECUTE → CAPTURE → VERIFY → ASSEMBLE                  │
 │                                 │                                │
 │                          TaskRun COMPLETE                        │
 │                          Wave COMPLETE                           │
 └──────────────────────────┬──────────────────────────────────────┘
                            │
                            │ Enqueue artifact job (non-blocking)
                            ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                    ACCP ASYNC JOB QUEUE                          │
 │                                                                   │
 │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
 │  │ FVR Job      │    │ PRR Job      │    │ (future)     │       │
 │  │ per TaskRun  │    │ per Wave     │    │ RAR, etc.    │       │
 │  └──────┬───────┘    └──────┬───────┘    └──────────────┘       │
 │         │                   │                                     │
 │         ▼                   ▼                                     │
 │  ┌──────────────────────────────────────────────────────┐       │
 │  │              ACCP COMPILER (kernel/accp)              │       │
 │  │                                                       │       │
 │  │  • Compiles evidence → structured report              │       │
 │  │  • Validates evidence completeness                    │       │
 │  │  • Does NOT evaluate truth (Truth Engine did that)    │       │
 │  └──────────────────┬───────────────────────────────────┘       │
 │                     │                                             │
 │                     ▼                                             │
 │  ┌──────────────────────────────────────────────────────┐       │
 │  │              ARTIFACT STORAGE                          │       │
 │  │                                                       │       │
 │  │  • Stored in DB                                       │       │
 │  │  • Surfaced in Desktop Mission Control                │       │
 │  │  • Available for audit/human review                   │       │
 │  └──────────────────────────────────────────────────────┘       │
 └─────────────────────────────────────────────────────────────────┘
```

Key principle: The arrow from execution to artifact generation is one-directional. Execution never waits for ACCP. ACCP failure never rolls back execution verdicts.

---

## FVR (Final Verification Report)

Produced per TaskRun after the task reaches COMPLETE.

| Section | Content |
|---------|---------|
| Task metadata | task_id, plan_id, wave, namespace, task_type |
| Attempt history | All attempts with gate verdicts, timestamps, strategy used |
| Acceptance criteria | All criteria with PASS/FAIL per criterion |
| Evidence summary | Evidence record count, EHC chain status, divergence flags |
| Final verdict | COMPLETE (FinalGate PASS), with timestamp |
| Repair history | If any attempts were HOLD/FAIL, what was repaired and how |

FVR enqueued when: TaskRun transitions to COMPLETE.

## PRR (Phase Review Report)

Produced per wave after all tasks in the wave reach terminal state.

| Section | Content |
|---------|---------|
| Wave metadata | wave_id, plan_id, task count, worker count |
| Task summaries | Per-task final status, attempt count, strategy history |
| Assembly result | Assembly success or ConflictReport summary |
| Timeline | Start-to-finish timeline with key events |
| Metrics | Duration, total attempts, repair count, failure rate |

PRR enqueued when: Wave transitions to WAVE_COMPLETE or WAVE_PARTIAL.

---

## ACCP Compiler Role

The ACCP compiler (`kernel/accp`, ported from `pi/packages/accp-compiler`):
- Compiles evidence and verdict data into structured reports
- Validates evidence completeness (are all required evidence types present?)
- Does NOT evaluate truth (the Truth Engine already did that)
- Is NOT the Truth Engine — it produces documentation, not completion verdicts
- Runs as an async job, never on the execution critical path

---

## MUST / MUST NOT Rules

### MUST
- ACCP artifact generation MUST be async and non-blocking
- FVR MUST be enqueued when TaskRun reaches COMPLETE
- PRR MUST be enqueued when wave reaches terminal state
- Artifact failure MUST NOT roll back or modify gate verdicts
- Artifacts MUST be surfaced in Desktop Mission Control
- ACCP compiler port (P0.3) MUST keep the compiler separate from Truth Engine

### MUST NOT
- Execution MUST NOT wait for ACCP artifact completion
- Artifact failure MUST NOT fail the TaskRun
- ACCP compiler MUST NOT be treated as Truth Engine replacement
- Artifact generation MUST NOT block the critical path
- Do NOT expand ACCP report types beyond FVR and PRR in MVP unless evidence requires it

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| FVR job fails | Job queue error | Retry; if persistent, log error; TaskRun stays COMPLETE |
| PRR job fails | Job queue error | Retry; if persistent, log error; wave status unchanged |
| ACCP compiler bug | Validation error in generated artifact | Log; fix compiler; regenerate artifact |
| Artifact storage failure | DB write error | Retry; persistent failure alerts in Mission Control |

---

## MVP Scope

- MVP-A (mock): No real ACCP — mock artifacts in UI
- MVP-B (single worker): FVR generation after COMPLETE
- MVP-C (parallel): FVR + PRR generation

---

## Test/Gate Implications

- Test: FVR enqueued on COMPLETE transition
- Test: PRR enqueued on wave completion
- Test: Artifact job failure does not affect TaskRun status
- Test: ACCP compiler does not emit gate verdicts
- Test: FVR contains all required sections

---

## Decision Compliance Checklist

| Decision | Compliant? |
|----------|------------|
| D-037/D-038: ACCP async, non-blocking | Yes — async job queue, one-directional |
| D-040: ACCP compiler is not Truth Engine | Yes — produces reports, not verdicts |
| D-042: FVR/PRR produced later | Yes — enqueued after execution |
| D-043: Minimal ACCP types in MVP | Yes — FVR + PRR only |

---

## Open Questions

- What is the artifact storage retention policy?
- Should FVR/PRR be exportable (PDF, JSON)?
- Should ACCP support custom report templates?
- What is the performance overhead of FVR generation for tasks with many attempts?

## Audit Notes

- ACCP artifacts are the audit trail that proves PRAXIS operated correctly
- The async design prevents ACCP from becoming a bottleneck or single point of failure
- The separation from Truth Engine is critical — the compiler documents truth, it does not decide it
