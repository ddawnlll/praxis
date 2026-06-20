> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** Governor and concurrency tiers are FUTURE scope for v0.1. v0.1 is single-session manual verification. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# Governor Contract

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the Governor contract -- the concurrency control authority that determines how many workers can safely run concurrently. The Governor controls concurrency, not truth. It manages worker capacity through tiered promotion, demotion on instability, and state signaling (GREEN/YELLOW/RED) that feeds the Circuit Breaker.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The Governor is the concurrency authority in PRAXIS. It answers "How many workers can safely run concurrently?" by tracking system stability, failure rates, and rate limit signals. It promotes concurrency only after measured clean operation, demotes immediately on instability, and signals RED state to the Circuit Breaker. The Governor does NOT evaluate task correctness or decide completion.

---

## Scope

- Defines concurrency tiers: stable_3, stable_6, stable_8, stable_12, stable_16
- Defines tier promotion rules (48h consecutive clean operation per tier)
- Defines tier demotion rules (sustained failure, rate limit signals)
- Defines color states: GREEN, YELLOW, RED
- Defines the relationship between Governor RED and Circuit Breaker OPEN
- Defines GovernorState fields

---

## Non-Goals

- How the Truth Engine evaluates task completion (Truth Engine territory)
- How the Circuit Breaker blocks admissions (Circuit Breaker territory)
- How workers are scheduled (Wave Scheduler territory)
- How token/time budgets are enforced per-task (TaskSpec budget territory)
- Exact CPU/memory/IO monitoring thresholds (implementation detail)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-083 | Governor controls concurrency, not truth | Governor manages worker count; Truth Engine evaluates completion |
| D-087 | Governor answers: how many workers can safely run? | Concurrency authority defined here |
| D-088 | Truth Engine answers: is this attempt complete? | Separate concern; Governor does not evaluate |
| D-082 | Circuit Breaker can stop new admissions | Governor RED > 15min feeds Circuit Breaker OPEN trigger |
| D-084 | Circuit Breaker is kernel-owned | Governor and Circuit Breaker are separate kernel components |
| D-001 | Local-first execution platform | Governor manages local worker processes, not cloud resources |

---

## Conceptual Model

```
┌────────────────────────────────────────────────────────────────────┐
│                         Governor                                    │
│                                                                     │
│  Question: "How many workers can safely run concurrently?"         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │  Promotion Path (measured stability required):           │      │
│  │                                                          │      │
│  │  stable_3 ──48h clean──► stable_6 ──48h clean──►       │      │
│  │    (3 workers)            (6 workers)                    │      │
│  │                                                          │      │
│  │  stable_8 ──48h clean──► stable_12 ──48h clean──►      │      │
│  │    (8 workers)            (12 workers)                   │      │
│  │                                                          │      │
│  │  stable_16                                             │      │
│  │    (16 workers, architecture review required to go      │      │
│  │     beyond this ceiling)                                │      │
│  └─────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │  Demotion: IMMEDIATE on instability                      │      │
│  │                                                          │      │
│  │  Sustained failure_rate > threshold → demote            │      │
│  │  Rate limit signals from adapters → demote              │      │
│  │  State transitions: GREEN → YELLOW → RED                │      │
│  └─────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │  State Colors:                                            │      │
│  │                                                          │      │
│  │  GREEN  = healthy, normal operation                     │      │
│  │  YELLOW = warning threshold reached                     │      │
│  │  RED    = sustained instability > 15min                 │      │
│  │           → feeds Circuit Breaker OPEN trigger          │      │
│  └─────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `kernel/governor/adaptive-concurrency-governor` | Core Governor: tier management, promotion, demotion, color state transitions |
| `kernel/governor/clean-operation-window` | Tracks consecutive clean operation hours per tier |
| `kernel/governor/demotion-rules` | Evaluates demotion thresholds: failure rate, rate limit signals |
| `kernel/governor/resource-governor` | Tracks token/time budgets (separate from concurrency) |
| `kernel/circuit-breaker/` | Consumes Governor RED > 15min as OPEN trigger |
| `kernel/core/scheduler/` | Consumes Governor tier to cap active workers per wave |

---

## Field Definitions

### GovernorState

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `tier` | TierEnum | Yes | Current concurrency tier | Must be valid tier value |
| `active_workers` | number | Yes | Current number of active workers | Must not exceed tier max |
| `state` | ColorEnum | Yes | Current health color | Must be 'GREEN', 'YELLOW', or 'RED' |
| `clean_operation_hours` | number | Yes | Consecutive hours of clean operation at current tier | Non-negative; resets on demotion |
| `failure_rate` | number | Yes | Current failure rate (rolling window) | 0.0 to 1.0 |
| `rate_limit_signals` | object[] | Yes | Recent rate limit signals from adapters | Each entry: {adapter_id, timestamp, signal_type, retry_after} |
| `last_demotion_reason` | string \| null | No | Why the most recent demotion occurred | Null if never demoted |
| `last_promotion_time` | ISO 8601 string \| null | No | When the most recent promotion occurred | Null if never promoted |
| `last_state_change_time` | ISO 8601 string | Yes | When the color state last changed | Required |
| `red_entered_at` | ISO 8601 string \| null | Yes (if RED) | When the Governor entered RED state | Null when not RED |

### `tier` Enum (TierEnum)

| Value | Max Workers | Promotion Requirement | Ceiling? |
|-------|------------|----------------------|----------|
| `stable_3` | 3 | Initial tier (no promotion needed to reach) | No |
| `stable_6` | 6 | 48h consecutive clean operation at stable_3 | No |
| `stable_8` | 8 | 48h consecutive clean operation at stable_6 | No |
| `stable_12` | 12 | 48h consecutive clean operation at stable_8 | No |
| `stable_16` | 16 | 48h consecutive clean operation at stable_12 + architecture review | Hypothesis (future ceiling candidate) |

### `state` Enum (ColorEnum)

| Value | Meaning | Condition | Action |
|-------|---------|-----------|--------|
| `GREEN` | System healthy; normal operation | failure_rate below warning threshold, no rate limit signals | Normal worker admission |
| `YELLOW` | Warning threshold reached | failure_rate elevated OR rate limit signals detected | Reduce admission rate; monitor closely |
| `RED` | Sustained instability | YELLOW sustained > 15 minutes OR failure_rate exceeds critical threshold | Feed Circuit Breaker OPEN trigger; stop new admissions |

---

## Promotion Rules

### Clean Operation Definition

A "clean operation hour" is an hour where:
- No FAIL verdicts occurred
- No Circuit Breaker OPEN events occurred
- No adapter rate limit signals were received
- No Governor demotion occurred
- System maintained GREEN state for the entire hour

### Promotion Sequence

```
stable_3:  Starting tier. No promotion required.
   ↓      48h consecutive clean operation hours
stable_6:  Up to 6 concurrent workers.
   ↓      48h consecutive clean operation hours
stable_8:  Up to 8 concurrent workers.
   ↓      48h consecutive clean operation hours
stable_12: Up to 12 concurrent workers.
   ↓      48h consecutive clean operation hours + architecture review
stable_16: Up to 16 concurrent workers. **HYPOTHESIS / future ceiling candidate.** Not proven for MVP.
```

### Promotion upon Tier Achievement

When a promotion condition is met:
1. Validate that the current tier has the required clean operation hours
2. For stable_16: validate that architecture review has been completed
3. Set new tier
4. Set `clean_operation_hours` to 0 (counter resets for new tier)
5. Emit `governor.tier_promoted` runtime event
6. New worker capacity is immediately available

---

## Demotion Rules

### Demotion Triggers

| Trigger | Condition | Severity |
|---------|-----------|----------|
| Sustained failure rate | failure_rate > (tier-specific threshold) sustained for > 5 minutes | Demote one tier |
| Rate limit signals | Rate limit signals from > 50% of active adapters | Demote one tier |
| Critical failure rate | failure_rate > 50% | Demote two tiers immediately |
| EHC CONFIRMED | EHC break classified as CONFIRMED | Demote one tier |

### Demotion Action

When a demotion trigger fires:
1. Determine new tier (one or two tiers below current, minimum stable_3)
2. Set new tier immediately (no waiting period)
3. If active_workers > new tier max: finish current attempts; do not start new ones until count drops
4. Set `clean_operation_hours` to 0
5. Set `last_demotion_reason` to the trigger that caused demotion
6. Emit `governor.tier_demoted` runtime event

---

## Color State Transitions

```
GREEN ──────────────────────────────────────────────────────────────►
  │
  │ failure_rate > warning threshold
  │ OR rate_limit_signals detected
  │ OR demotion occurs
  ▼
YELLOW ─────────────────────────────────────────────────────────────►
  │
  │ YELLOW sustained > 15 minutes
  │ OR failure_rate > critical threshold (50%)
  ▼
RED ────────────────────────────────────────────────────────────────►
  │
  │ After demotion completed AND failure_rate < threshold
  │ AND no rate_limit_signals for 5 minutes
  ▼
YELLOW ─────────────────────────────────────────────────────────────►
  │
  │ clean_operation_hours > 1 (one hour of clean YELLOW)
  ▼
GREEN
```

### RED State Effects

When Governor enters RED:
1. All new worker launches are paused
2. Governor emits `governor.state_red` runtime event
3. `red_entered_at` is set to current timestamp
4. If RED persists > 15 minutes: Circuit Breaker OPEN trigger fires
5. In-flight workers are allowed to finish current attempts
6. No new task run starts are admitted

### Recovery from RED

```
RED -> demotion completed + conditions improving -> YELLOW
YELLOW -> 1 hour clean -> GREEN
GREEN -> resume normal promotion tracking
```

---

## MUST Rules

1. **MUST** manage concurrency tiers as defined: stable_3, stable_6, stable_8, stable_12, stable_16.
2. **MUST** require 48h consecutive clean operation at current tier before promotion.
3. **MUST** demote immediately (no waiting period) when demotion triggers fire.
4. **MUST** set `clean_operation_hours` to 0 on any demotion.
5. **MUST** require architecture review to promote to stable_16.
6. **SHOULD** treat stable_16 as aspirational ceiling; only stable_3 is the proven MVP-C target.
7. **MUST** signal RED state to Circuit Breaker after > 15 minutes continuous RED.
8. **MUST** pause new worker launches when RED.
9. **MUST** reset RED timer if state returns to YELLOW or GREEN before 15 minutes.
10. **MUST NOT** allow active workers to exceed current tier maximum once demotion is complete.

## MUST NOT Rules

1. **MUST NOT** produce completion verdicts (Truth Engine territory).
2. **MUST NOT** evaluate truth or acceptance criteria.
3. **MUST NOT** modify gate verdicts.
4. **MUST NOT** override Circuit Breaker state.
5. **MUST NOT** promote tier without meeting clean operation requirements.
6. **MUST NOT** promote beyond stable_3 without measured stability proof; stable_16 is an unproven hypothesis.
7. **MUST NOT** demote below stable_3.
8. **MUST NOT** allow unbounded concurrency.
9. **MUST NOT** ignore rate limit signals from adapters.
10. **MUST NOT** decide which tasks get admitted (PSAG/Wave Scheduler territory).

---

## Forbidden Authority Fields

| Forbidden | Reason |
|-----------|--------|
| `completion_verdict` | Governor controls concurrency, not truth (D-083) |
| `truth_evaluation` | Truth Engine territory (D-032) |
| `gate_verdict_override` | Gates are kernel/truth-engine only (D-033) |
| `circuit_breaker_override` | Circuit Breaker is independent kernel component (D-084) |
| `tier='stable_32'` or higher | stable_16 is concurrency ceiling |
| `auto_promote_without_clean_hours` | Violates 48h clean operation requirement |
| `per_worker_governor` | Governor is system-level, not per-worker |

---

## Failure Modes

| Failure | Detection | Consequence |
|---------|-----------|-------------|
| Governor stuck in RED | RED persists indefinitely without demotion completing | Circuit Breaker opens after 15 minutes; human must investigate |
| Promotion loop (promote-demote rapidly) | Tier changes repeatedly within short window | Increase clean operation requirement or add hysteresis |
| Active workers exceed tier | Count check on every admission; overshoot can happen during demotion transient | Finish current attempts; don't start new ones until count drops below new tier |
| Governor crash during promotion | On restart, reload last persisted state; verify clean operation hours from storage | Resume at last known tier; restart promotion counter |
| Rate limit signals flood | Many adapters reporting rate limits simultaneously | Immediate demotion; could cascade to RED state |

---

## Test / Gate Implications

### Tests Required

- Governor starts at stable_3
- 48h clean operation at stable_3 promotes to stable_6
- 48h clean operation at stable_6 promotes to stable_8
- Promotion to stable_16 requires architecture review flag
- Failure rate > threshold demotes one tier immediately
- Rate limit signals demote one tier immediately
- clean_operation_hours resets to 0 on demotion
- Governor RED > 15 minutes feeds Circuit Breaker OPEN trigger
- Governor RED < 15 minutes does NOT feed Circuit Breaker
- GREEN -> YELLOW on warning threshold
- YELLOW -> RED after 15 minutes sustained
- YELLOW -> GREEN after 1 hour clean (not 15 minutes sustained)
- Active workers never exceed tier maximum (after demotion transient)
- Governor does not evaluate gate verdicts
- Governor does not override Circuit Breaker

### Gate Implications

- **PSAG**: Uses Governor tier to determine how many tasks can be admitted per wave
- **Wave Scheduler**: Caps active workers per wave at Governor tier maximum
- **Circuit Breaker**: Governor RED > 15min is an OPEN trigger

---

## Decision Compliance Checklist

- [ ] D-083: Governor controls concurrency, not truth
- [ ] D-087: Governor answers "how many workers can safely run?"
- [ ] D-088: Truth Engine answers "is this attempt complete?" (separate concern)
- [ ] D-082: Governor RED feeds Circuit Breaker OPEN trigger
- [ ] D-084: Circuit Breaker is separate kernel component
- [ ] D-001: Local-first; Governor manages local workers

---

## Open Questions

1. What are the tier-specific failure rate thresholds for YELLOW and RED warnings? Suggested: >10% = YELLOW, >25% = sustained YELLOW -> RED.
2. How is "clean operation" verified during a runtime restart? Are clean_operation_hours persisted and reloaded?
3. Should the demotion be configurable (1 tier vs 2 tiers for critical failure)?
4. How does the Governor interact with PRAXIS running across multiple machines (future, not MVP)?

---

## Audit Notes

- This contract is DRAFT_FOR_AUDIT. Tier thresholds, clean operation durations, and failure rate windows should be validated during P3 kernel safety core testing.
- stable_16 is an OPEN hypothesis for a future concurrency ceiling. MVP-C targets stable_3.
- Governor and Circuit Breaker are distinct kernel components. Their interaction (Governor RED -> Circuit Breaker OPEN) must be tested as an integration path.
- Ensure the Governor's state is recoverable from storage after a runtime restart -- promotion progress must not be lost.
