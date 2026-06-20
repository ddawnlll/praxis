> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** Wave Scheduler and multi-worker orchestration are FUTURE scope for v0.1. v0.1 is single-session manual verification. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# Wave Scheduler Pipeline

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define how PlanSpec waves are scheduled, how task dependencies are resolved, and how Governor and Circuit Breaker control wave admission.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The Wave Scheduler decomposes a PlanSpec into execution waves, resolves task dependencies, assigns workers, and respects Governor concurrency limits and Circuit Breaker admission control.

## Scope

- Wave decomposition from PlanSpec
- Task dependency resolution
- Namespace admission per wave
- Governor concurrency enforcement
- Circuit Breaker admission blocking
- Worker assignment
- Wave completion conditions

## Non-Goals

- Worker lifecycle (see `docs/pipelines/worker-adapter.md`)
- Namespace isolation details (see `docs/pipelines/namespace-ownership.md`)
- Assembler (see `docs/pipelines/deterministic-assembler.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| D-082 | Circuit Breaker can stop new admissions |
| D-087 | Governor controls concurrency |
| D-111 | Parallel work allowed only with namespace ownership |
| Law 2 | No worker writes shared integration files |

---

## Conceptual Model

```
PlanSpec
    │
    ▼
┌──────────────────────────────────────────────┐
│                WAVE SCHEDULER                 │
│                                               │
│  1. Parse PlanSpec waves                      │
│  2. Build dependency graph per wave           │
│  3. Check namespace partitions (PSAG)         │
│  4. Check Circuit Breaker state               │
│     └─ OPEN → BLOCK wave admission            │
│  5. Check Governor concurrency                │
│     └─ current_active < tier → ADMIT          │
│     └─ current_active >= tier → QUEUE         │
│  6. Assign workers to admitted tasks          │
│  7. Monitor wave completion                   │
│     └─ All tasks PASS → wave complete         │
│     └─ Any task FAIL/ABORT → wave partial     │
└──────────────────────────────────────────────┘
```

---

## Wave Lifecycle

```
Wave created (from PlanSpec)
    │
    ▼
WAVE_PENDING ────── dependency check ──────► WAVE_READY
    │                                              │
    │ (deps not met)                               │ (admission check)
    ▼                                              ▼
  WAIT                                         WAVE_ADMITTED
                                                  │
                                          ┌───────┴───────┐
                                          │               │
                                    CB CLOSED        CB OPEN
                                    tasks run        tasks wait
                                          │               │
                                          ▼               ▼
                                    WAVE_RUNNING    WAVE_BLOCKED
                                          │
                              ┌───────────┼───────────┐
                              │           │           │
                          all PASS   some FAIL    all ABORT
                              │           │           │
                              ▼           ▼           ▼
                        WAVE_COMPLETE WAVE_PARTIAL WAVE_ABORTED
```

---

## Task Dependency Resolution

- Each task declares `dependencies: string[]` (task_ids that must complete before this task)
- Dependency graph is checked for cycles at PSAG time
- A task is admitted only when ALL its dependencies have COMPLETE status
- If a dependency FAILs, dependent task is blocked (human intervention required)

---

## Governor Concurrency Control

- Governor defines current tier (stable_3 → stable_16, where stable_16 is an OPEN hypothesis / aspirational ceiling; MVP-C targets stable_3 only)
- Max concurrent workers = Governor current tier
- When active workers < tier: admit next ready task
- When active workers >= tier: queue task until slot opens
- When Governor demotes: running tasks complete; no new admissions until active < new tier

---

## Circuit Breaker Admission Blocking

- CB CLOSED: normal admission
- CB OPEN: ALL new wave/task admissions rejected; running tasks complete naturally; no new repair attempts
- CB HALF_OPEN: exactly ONE task admitted as probe; others wait

---

## MUST / MUST NOT Rules

### MUST
- Wave scheduler MUST check Circuit Breaker state before admitting any task
- Wave scheduler MUST enforce Governor concurrency limits
- Task dependencies MUST be satisfied before task admission
- All tasks in a wave MUST have non-overlapping namespaces (verified at PSAG)
- Wave completion MUST require all tasks to PASS FinalGate

### MUST NOT
- Workers MUST NOT write shared integration files (assembler-only)
- Wave scheduler MUST NOT admit tasks when CB is OPEN
- Wave scheduler MUST NOT exceed Governor tier concurrency

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Dependency cycle | PSAG graph check | Reject PlanSpec |
| All workers at capacity | Governor limit reached | Queue tasks |
| CB OPEN during wave | Admission check | Pause wave, running tasks complete |
| Dependency FAILs | Task status check | Block dependent tasks; human review |

---

## Test/Gate Implications

- Test: dependency graph with valid and cyclic cases
- Test: wave admission blocked when CB OPEN
- Test: concurrency limit enforced (3 tasks, stable_3 tier, 4th queued)
- Test: wave marked complete when all tasks PASS
- Test: wave partial when some tasks FAIL

---

## Decision Compliance Checklist

| Decision | Compliant? |
|----------|------------|
| D-082: CB stops new admissions | Yes |
| D-087: Governor controls concurrency | Yes |
| D-111: Parallel only with namespace ownership | Yes |
| Law 2: No worker shared writes | Yes |

---

## Open Questions

- Should waves be auto-sized based on namespace analysis?
- Can a wave be partially re-admitted if only one task failed?
- Should there be a max wave size?

## Audit Notes

- Wave scheduling is the operational layer between planning (PlanSpec) and execution (worker runs)
- The scheduler must coordinate with three safety authorities: PSAG (namespace), Governor (concurrency), Circuit Breaker (admission)
