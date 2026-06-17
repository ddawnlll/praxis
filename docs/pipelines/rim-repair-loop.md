# RIM Repair Loop Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the Repair Intelligence Module (RIM) repair loop: how failed verification attempts are analyzed, repair packets are generated with structured strategies, and retries are managed up to the attempt budget.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

When the Truth Engine returns HOLD or FAIL for an attempt, PRAXIS does not give up. RIM analyzes the failure signature, generates a RepairPacket with a structured strategy, and dispatches a new attempt. This loop continues until the attempt passes, the budget is exhausted, or the task is aborted. RIM is the mechanism that makes PRAXIS resilient to worker mistakes without requiring human intervention on every misstep.

## Scope

- RIM activation conditions (HOLD/FAIL only, never PASS)
- FailureSignature extraction from GateVerdict
- RepairPacket structure and strategy selection
- Six-strategy rotation with attempt-based progression
- Budget enforcement and ABORT conditions
- What RIM may and may not change
- Human escalation criteria

## Non-Goals

- Gate evaluation logic (see `docs/pipelines/evidence-to-truth-engine.md`)
- Claude adapter mechanics (see `docs/pipelines/claude-code-adapter.md`)
- Human action queue UI (see Desktop Mission Control)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| D-081 | RIM starts only after HOLD/FAIL gate outcomes |
| Law 1 | Agent says done is not done |
| Law 3 | FinalGate criteria from human-authored TaskSpec only |

---

## Conceptual Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        RIM REPAIR LOOP                           │
│                                                                   │
│  Truth Engine                                                    │
│      │                                                           │
│      ├── PASS ──► COMPLETE (RIM not involved)                    │
│      │                                                           │
│      ├── HOLD ──► RIM activated                                  │
│      │              │                                            │
│      │              ▼                                            │
│      │     ┌──────────────────┐                                  │
│      │     │ FailureSignature │  ← extracted from GateVerdict    │
│      │     │  • which gate    │                                  │
│      │     │  • which criteria│                                  │
│      │     │  • evidence refs │                                  │
│      │     └────────┬─────────┘                                  │
│      │              │                                            │
│      │              ▼                                            │
│      │     ┌──────────────────┐                                  │
│      │     │ Strategy Select  │  ← based on attempt number       │
│      │     │  attempt 1: init │    and failure pattern           │
│      │     │  attempt 3: ctx  │                                  │
│      │     │  attempt 4: restr│                                  │
│      │     │  attempt 5: narrow│                                 │
│      │     │  attempt 6: knowl│                                  │
│      │     └────────┬─────────┘                                  │
│      │              │                                            │
│      │              ▼                                            │
│      │     ┌──────────────────┐                                  │
│      │     │  RepairPacket    │  ← new attempt with strategy     │
│      │     └────────┬─────────┘                                  │
│      │              │                                            │
│      │              ▼                                            │
│      │     ┌──────────────────┐                                  │
│      │     │  New Attempt     │  ← runs through same pipeline    │
│      │     │  (RUNNING state) │                                  │
│      │     └────────┬─────────┘                                  │
│      │              │                                            │
│      │              ▼                                            │
│      │     Truth Engine again ──► PASS / HOLD / FAIL             │
│      │                                                           │
│      └── FAIL ──► RIM activated (same flow)                      │
│                   OR human review if terminal                    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Budget / ABORT:                                             │ │
│  │  • Max 7 attempts per task                                  │ │
│  │  • Attempt 7 ABORT → human review                           │ │
│  │  • Token/time budget exhaustion also ABORT                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## FailureSignature

Extracted from the GateVerdict emitted by the Truth Engine:

| Field | Description |
|-------|-------------|
| `failure_signature_type` | `'empty_diff'`, `'zero_tests'`, `'criterion_failed'`, `'namespace_violation'`, `'missing_evidence'`, `'ehc_break'`, `'crash'`, `'rate_limit'` |
| `failed_gate` | Which gate returned HOLD/FAIL (`EvidenceGate`, `ExecGate`, `FinalGate`) |
| `failed_criteria_ids` | Specific acceptance criteria that failed (for FinalGate failures) |
| `evidence_refs` | Evidence records relevant to the failure |
| `context` | Additional structured context (e.g., "expected file X, not found in diff") |

---

## RepairPacket

| Field | Description |
|-------|-------------|
| `repair_packet_id` | Unique identifier |
| `attempt_id` | The attempt that failed |
| `task_run_id` | The task being repaired |
| `failure_signature` | FailureSignature (see above) |
| `failed_gate` | EvidenceGate / ExecGate / FinalGate |
| `failed_criteria_ids` | Which criteria failed (if FinalGate) |
| `evidence_refs` | Evidence records to include in next prompt |
| `strategy` | One of six strategies (see below) |
| `strategy_context` | Strategy-specific parameters (e.g., files to read, tools to allow) |
| `prior_failures` | Number of previous failed attempts for this task |
| `active_criterion` | Single criterion ID (for scope_narrow strategy) |
| `scope_constraints` | Path restrictions for the next attempt |
| `prompt_additions` | Text added to the worker's prompt to guide repair |

---

## Strategy Rotation

| Attempt | Strategy | What Changes | Rationale |
|---------|----------|-------------|-----------|
| 1-2 | **initial** | Standard repair packet with failure context. Worker sees what failed and evidence. | First retry with failure information; often enough for simple mistakes. |
| 3 | **context_expand** | Worker reads 5+ additional related files beyond namespace. Import graph, callers, callees included. | Expand context to help worker understand broader system. |
| 4 | **tool_restrict** | 4a: Read-only analysis pass (no writes). 4b: Write-enabled pass. | Force worker to analyze before changing; prevent impulsive edits. |
| 5 | **scope_narrow** | Focus on a single failing acceptance criterion. Reduce namespace to files directly relevant to that criterion. | Narrow focus to eliminate distraction; single-criterion repair. |
| 6 | **knowledge_inject** or **hint_inject** | Inject documentation, known patterns, or human-provided hints into prompt. | External knowledge when worker lacks domain context. |
| 7 | **ABORT** | No new attempt. Task marked ABORTED. Human review required. | Budget exhausted; human must decide. |

---

## What RIM May Change

- Worker prompt (add failure context, strategy instructions)
- Context scope (expand files readable, narrow writable files)
- Tool restrictions (read-only pass, restricted tool set)
- Active criterion focus (single criterion mode)
- Injected knowledge (docs, patterns, hints)

## What RIM Must NOT Change

- Human-authored acceptance criteria (Law 3)
- Task namespace (core task definition)
- TaskSpec structure or dependencies
- Gate verdicts (RIM receives verdicts, does not override them)
- Budget limits (cannot extend max attempts beyond 7)

---

## Human Escalation

| Condition | Action |
|-----------|--------|
| Attempt 7 reached (ABORT) | Create human_action in queue; task marked ABORTED |
| Same criterion fails 3+ times | Create human_action with pattern alert |
| Budget exhausted (time/tokens) | Create human_action; task paused pending budget adjustment |
| CONFIRMED EHC break during repair | Escalate immediately; possible integrity issue |
| Repair strategy exhausted all options | Create human_action suggesting human review of TaskSpec |

---

## MUST / MUST NOT Rules

### MUST

- RIM MUST activate only on HOLD or FAIL gate outcomes (never PASS)
- RIM MUST respect the max attempt limit (7 per task)
- RIM MUST rotate strategy based on attempt number
- RIM MUST include prior failure evidence in repair context
- RIM MUST escalate to human when budget is exhausted
- Failed attempt evidence MUST be preserved for audit

### MUST NOT

- RIM MUST NOT rewrite human-authored acceptance criteria
- RIM MUST NOT expand the task namespace beyond original assignment
- RIM MUST NOT override Truth Engine gate verdicts
- RIM MUST NOT skip strategy levels (must progress through rotation)
- RIM MUST NOT start repair on PASS outcomes
- Repair MUST NOT reduce evidence capture quality

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Same failure across multiple strategies | FailureSignature unchanged after 2+ attempts | Escalate to human; possible TaskSpec issue |
| Worker ignores repair context | Diff unchanged from previous attempt | Escalate strategy earlier (force scope_narrow) |
| Strategy 6 exhausted | All knowledge sources tried, still failing | ABORT → human review |
| Worker crashes during repair | CrashSignal in RunAttemptResult | Retry with same strategy (doesn't count as strategy advance) |
| Rate limit during repair | RateLimitSignal | Pause, wait, retry; does not advance strategy counter |

---

## Test/Gate Implications

- Test: RIM generates RepairPacket on HOLD, new attempt runs with repair context
- Test: RIM rotates through all 6 strategies correctly
- Test: RIM ABORTs at attempt 7
- Test: RIM does NOT activate on PASS
- Test: RIM preserves human acceptance criteria across repairs
- Test: Repair context includes evidence from prior failed attempts
- Test: Human action created on ABORT

---

## Decision Compliance Checklist

| Decision | Requirement | Compliant? |
|----------|-------------|------------|
| D-081 | RIM starts only after HOLD/FAIL | Yes |
| Law 3 | Does not rewrite human criteria | Yes — RIM cannot modify acceptance_criteria |
| Law 1 | Does not treat repair retry as completion | Yes — each retry goes through full Truth Engine |

---

## Open Questions

- Should RIM track failure patterns across tasks (cross-task learning)?
- Can strategy rotation be adaptive (skip strategies based on failure signature)?
- Should human be able to inject custom strategies?
- What constitutes a "crash during repair" vs "strategy failed" for attempt counting?

## Audit Notes

- RIM is the operationalization of PRAXIS resilience: structured, bounded, and escalating
- The fixed strategy rotation prevents RIM from getting stuck in loops
- Human escalation is built-in, not an afterthought — PRAXIS knows when to ask for help
