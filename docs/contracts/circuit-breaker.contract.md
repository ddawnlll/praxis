> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** Circuit Breaker is FUTURE scope for v0.1. v0.1 uses manual `/praxis:verify` with no automated admission control. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# Circuit Breaker Contract

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the Circuit Breaker contract -- the safety component that protects the PRAXIS system from sustained instability by blocking new admissions when system-wide safety thresholds are exceeded. The Circuit Breaker is kernel-owned and answers "Is the whole system safe enough to admit work?"

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The Circuit Breaker is PRAXIS's system-level safety guard. While the Truth Engine asks "Is this attempt complete?" and the Governor asks "How many workers can safely run?", the Circuit Breaker asks "Is the system safe enough to continue admitting work?" It protects the system from cascading failures by blocking new work admissions when failure rates, governor instability, or evidence integrity issues cross defined thresholds.

---

## Scope

- Defines the three Circuit Breaker states: CLOSED, OPEN, HALF_OPEN
- Defines all OPEN triggers and their thresholds
- Defines the state machine transitions and cooldown rules
- Defines CircuitBreakerState fields and runtime event types
- Defines the HALF_OPEN probe protocol (exactly one controlled attempt)
- Defines the diagnostic snapshot shape emitted on state transitions
- Defines the relationship to Truth Engine, Governor, and EHC

---

## Non-Goals

- How failure rate is computed (CPU/memory/IO monitoring details)
- How the Governor determines RED state (Governor territory)
- How EHC breaks are classified (Evidence territory)
- Per-worker or per-task circuit breaking (Circuit Breaker is system-level only)
- UI implementation of breaker status panels
- Storage implementation of `circuit_breaker_transitions` table

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-084 | Circuit Breaker is kernel-owned | Ownership is in `kernel/circuit-breaker` |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN | Three-state model is canonical |
| D-086 | Circuit Breaker answers: is the whole system safe enough to admit work? | System-level, not per-task |
| D-082 | Circuit Breaker can stop new admissions | OPEN prevents all new admissions |
| D-089 | Circuit Breaker implementation in kernel/circuit-breaker | Package location |
| D-090 | Circuit Breaker not delayed to production hardening | P3 kernel safety core |
| D-109 | Circuit Breaker transitions must be tested | All states and triggers tested |

---

## Conceptual Model

```
                        ┌──────────────────────┐
                        │       CLOSED         │
                        │                      │
                        │  System healthy.     │
                        │  Admissions allowed. │
                        │  Workers can launch. │
                        └──────────┬───────────┘
                                   │
                     Trigger fires │ (any ONE of):
                     ──────────────┘
                     • failure_rate > 30% in 10min window
                     • governor_RED continuous > 15min
                     • EHC break = CONFIRMED
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │        OPEN          │
                        │                      │
                        │  System unsafe.      │
                        │  Admissions BLOCKED. │
                        │  No new workers.     │
                        │  In-flight: finish   │
                        │  or controlled abort.│
                        └──────────┬───────────┘
                                   │
                     Recovery      │
                     ──────────────┘
                     • Cooldown expires OR
                     • Human reset via API
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │      HALF_OPEN       │
                        │                      │
                        │  Testing recovery.   │
                        │  ONE probe attempt.  │
                        │  Admissions blocked. │
                        └──────────┬───────────┘
                                   │
                     Probe outcome │
                     ──────────────┘
                     • Probe PASS → CLOSED
                     • Probe FAIL → OPEN
```

**Key constraint:** The Circuit Breaker never transitions directly from OPEN to CLOSED. It MUST pass through HALF_OPEN with a successful probe.

---

## State Definitions

### CLOSED

| Property | Value |
|----------|-------|
| Meaning | System is healthy enough to admit new work |
| `allows_new_admissions` | `true` |
| `allows_new_worker_launches` | `true` |
| Exit condition | Any OPEN trigger fires |

While CLOSED, the Circuit Breaker passively monitors:
- Failure rate over 10-minute sliding window
- Governor RED state duration
- EHC break classifications

### OPEN

| Property | Value |
|----------|-------|
| Meaning | System is unsafe; new admissions are blocked |
| `allows_new_admissions` | `false` |
| `allows_new_worker_launches` | `false` |
| `in_flight_attempt_policy` | `finish_current_attempt_or_controlled_abort` |
| Exit condition | Cooldown expires OR human reset via API |

While OPEN:
- Reject all new plan admissions (PSAG returns REJECT with reason `circuit_breaker_open`)
- Reject all new task run starts
- Prevent new worker process launches
- Allow in-flight attempts to finish their current command or perform controlled abort
- Emit `circuit_breaker.opened` runtime event with diagnostic snapshot
- Persist state transition to `circuit_breaker_transitions` table

### HALF_OPEN

| Property | Value |
|----------|-------|
| Meaning | System is testing recovery with one controlled attempt |
| `allows_new_admissions` | `false` |
| `allows_new_worker_launches` | `one_controlled_probe_only` |
| `pass_transition` | `CLOSED` |
| `fail_transition` | `OPEN` |
| Exit condition | Probe PASS (-> CLOSED) or probe FAIL (-> OPEN) |

While HALF_OPEN:
- Block all new admissions EXCEPT exactly one probe attempt
- Probe must use a low-risk or health-check task
- Emit `circuit_breaker.half_opened` runtime event
- Emit `circuit_breaker.probe_started` when the probe attempt begins
- If probe passes all safety gates: emit `circuit_breaker.probe_passed`, transition to CLOSED
- If probe fails any safety gate: emit `circuit_breaker.probe_failed`, transition to OPEN
- All transitions are persisted and emitted as runtime events

---

## OPEN Triggers

The Circuit Breaker opens when ANY ONE of the following thresholds is exceeded:

### Trigger 1: Failure Rate

| Parameter | Value |
|-----------|-------|
| Threshold | `failure_rate > 30%` |
| Window | 10-minute sliding window |
| Metric | Ratio of FAIL verdicts to total attempt completions (PASS + FAIL) within window |
| Note | HOLD verdicts are excluded from failure rate (they are incomplete, not failed) |

### Trigger 2: Governor RED Sustained

| Parameter | Value |
|-----------|-------|
| Threshold | Governor state RED continuous for > 15 minutes |
| Metric | Duration since Governor entered RED state |
| Note | If Governor fluctuates between YELLOW and RED, the timer resets on each GREEN or YELLOW entry |

### Trigger 3: EHC CONFIRMED

| Parameter | Value |
|-----------|-------|
| Threshold | EHC break classified as CONFIRMED |
| Note | NOISE and SUSPECTED EHC breaks do NOT automatically open Circuit Breaker. Only CONFIRMED does. |

---

## Field Definitions

### CircuitBreakerState

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `state` | 'CLOSED' \| 'OPEN' \| 'HALF_OPEN' | Yes | Current Circuit Breaker state | Must be valid enum value |
| `open_since` | ISO 8601 string \| null | Yes (if OPEN) | When breaker entered OPEN state | Null when CLOSED or HALF_OPEN |
| `trigger_reason` | string \| null | Yes (if OPEN) | Which trigger caused the OPEN | One of: 'failure_rate', 'governor_red', 'ehc_confirmed' |
| `failure_rate_window` | object | Yes | Current failure rate statistics | Contains `failure_rate` (float), `window_start`, `window_end`, `total_attempts`, `failed_attempts` |
| `governor_state` | 'GREEN' \| 'YELLOW' \| 'RED' | Yes | Current Governor state (used for trigger monitoring) | Must be valid Governor state |
| `last_probe_attempt_id` | string \| null | Yes (if HALF_OPEN) | The attempt_id of the current probe | Null when not in HALF_OPEN |
| `cooldown_remaining_ms` | number \| null | Yes (if OPEN) | Milliseconds remaining in cooldown before HALF_OPEN allowed | Null when not in OPEN or cooldown expired |

### Diagnostic Snapshot (emitted with OPEN event)

| Field | Type | Description |
|-------|------|-------------|
| `opened_at` | ISO 8601 string | When the breaker opened |
| `opened_reason` | string | Which trigger fired |
| `failure_rate` | number | Failure rate at time of OPEN |
| `total_attempts_in_window` | number | Total attempts in sliding window |
| `failed_attempts_in_window` | number | Failed attempts in sliding window |
| `top_failing_gates` | {gate_name: string, fail_count: number}[] | Gates with most failures in window |
| `governor_state_at_open` | string | Governor state when breaker opened |
| `governor_red_duration_seconds` | number | How long Governor was RED (if governor_red trigger) |
| `ehc_break_details` | object \| null | EHC break details (if ehc_confirmed trigger) |
| `last_failed_verdicts` | string[] | Last N failed verdict attempt_ids for context |

---

## Runtime Events

The Circuit Breaker emits the following runtime events via the event bus and SSE stream:

| Event Type | Emitted When | Payload |
|-----------|-------------|---------|
| `circuit_breaker.opened` | State transitions from CLOSED to OPEN | `state`, `previous_state`, `reason`, `timestamp`, `diagnostic_snapshot`, `correlation_id` |
| `circuit_breaker.half_opened` | State transitions from OPEN to HALF_OPEN | `state`, `previous_state`, `reason`, `timestamp`, `correlation_id` |
| `circuit_breaker.closed` | State transitions from HALF_OPEN to CLOSED | `state`, `previous_state`, `reason`, `timestamp`, `correlation_id` |
| `circuit_breaker.reset_requested` | Human requests reset via API | `requested_by`, `timestamp`, `correlation_id` |
| `circuit_breaker.probe_started` | Probe attempt begins in HALF_OPEN | `probe_attempt_id`, `state`, `timestamp`, `correlation_id` |
| `circuit_breaker.probe_passed` | Probe attempt passes all safety gates | `probe_attempt_id`, `state`, `verdict`, `timestamp`, `correlation_id` |
| `circuit_breaker.probe_failed` | Probe attempt fails a safety gate | `probe_attempt_id`, `state`, `verdict`, `failed_gate`, `timestamp`, `correlation_id` |

---

## MUST Rules

1. **MUST** own Circuit Breaker logic in `kernel/circuit-breaker` (D-084).
2. **MUST** support all three states: CLOSED, OPEN, HALF_OPEN (D-085).
3. **MUST** block all new admissions when OPEN (D-082).
4. **MUST** open breaker when failure_rate > 30% in 10-minute sliding window.
5. **MUST** open breaker when Governor RED continuous > 15 minutes.
6. **MUST** open breaker when EHC break classified as CONFIRMED.
7. **MUST NOT** open breaker on NOISE or SUSPECTED EHC breaks.
8. **MUST** transition OPEN -> HALF_OPEN (not directly to CLOSED).
9. **MUST** permit exactly ONE probe attempt in HALF_OPEN.
10. **MUST** emit a runtime event on every state transition.
11. **MUST** persist every state transition to `circuit_breaker_transitions`.
12. **MUST** include a diagnostic snapshot with every OPEN event.
13. **MUST** use a cooldown period before allowing OPEN -> HALF_OPEN transition.
14. **MUST** reject plan admission (PSAG returns REJECT) with reason `circuit_breaker_open` when OPEN.

## MUST NOT Rules

1. **MUST NOT** allow UI-owned reset without human/action policy confirmation.
2. **MUST NOT** self-recover from OPEN to CLOSED directly (must go through HALF_OPEN).
3. **MUST NOT** evaluate per-attempt truth (Truth Engine territory).
4. **MUST NOT** decide worker concurrency (Governor territory).
5. **MUST NOT** evaluate acceptance criteria (FinalGate territory).
6. **MUST NOT** modify evidence records.
7. **MUST NOT** skip state persistence before emitting events.
8. **MUST NOT** allow multiple simultaneous probe attempts in HALF_OPEN.
9. **MUST NOT** close the breaker during a probe attempt before the probe completes.
10. **MUST NOT** apply circuit breaking per-worker or per-task (system-level only).

---

## Forbidden Authority Fields

| Forbidden | Reason |
|-----------|--------|
| `reset_source='ui_auto'` | UI cannot reset without human action |
| `reset_source='worker'` | Workers cannot reset safety guard |
| `probe_count > 1` during HALF_OPEN | Exactly one probe only |
| Direct OPEN -> CLOSED transition | Must pass through HALF_OPEN with successful probe |
| `state='CLOSED'` while trigger conditions are still met | Cannot close while triggers are active |
| `per_worker_breaker` | Circuit Breaker is system-level only |

---

## Failure Modes

| Failure | Detection | Consequence |
|---------|-----------|-------------|
| Circuit Breaker stuck OPEN | Cooldown expires but no HALF_OPEN transition | Human must investigate and manually reset |
| Circuit Breaker flapping (OPEN <-> HALF_OPEN <-> CLOSED rapidly) | Transition count exceeds threshold in time window | System is unstable; escalate to human; consider longer cooldown |
| Probe started but never completes | Probe timeout without verdict | HALF_OPEN holds until timeout; then transitions back to OPEN |
| Race condition: new admission during transition | Admission gate checks state atomically | State change and admission gate are serialized |
| Circuit Breaker crashes mid-transition | State persisted before event emission; on restart, reload from `circuit_breaker_transitions` | Last persisted state is authoritative |
| Multiple OPEN triggers simultaneously | All triggers evaluated; first to fire wins | Diagnostic snapshot records all active trigger conditions |

---

## Test / Gate Implications

### Tests Required

- CLOSED allows new admissions
- OPEN rejects new plan admissions
- OPEN rejects new task run starts
- OPEN prevents new worker launches
- HALF_OPEN permits exactly one probe attempt
- HALF_OPEN rejects second probe attempt while first is in flight
- failure_rate > 30% over 10 minutes opens breaker
- Governor RED > 15 minutes continuous opens breaker
- EHC CONFIRMED opens breaker
- EHC NOISE does NOT open breaker
- EHC SUSPECTED does NOT open breaker
- OPEN -> HALF_OPEN after cooldown expires
- HALF_OPEN -> CLOSED when probe passes
- HALF_OPEN -> OPEN when probe fails
- Direct OPEN -> CLOSED is not possible
- State transition events are emitted via runtime events
- State survives runtime restart via `circuit_breaker_transitions` table
- repeated ExecGate failures open breaker by failure-rate policy

### Gate Implications

- **PSAG**: When Circuit Breaker is OPEN, PSAG returns REJECT with reason `circuit_breaker_open` for all plan admissions
- **EvidenceGate/ExecGate/FinalGate**: Continue evaluating in-flight attempts even when breaker is OPEN
- **Governor**: Governor RED state feeds Circuit Breaker trigger; but breaker and governor operate independently

---

## Decision Compliance Checklist

- [ ] D-084: Circuit Breaker is kernel-owned (`kernel/circuit-breaker`)
- [ ] D-085: Three states: CLOSED, OPEN, HALF_OPEN
- [ ] D-086: System-level safety: blocks all new admissions when OPEN
- [ ] D-082: Circuit Breaker can stop new admissions
- [ ] D-089: Implementation in `kernel/circuit-breaker`
- [ ] D-090: Not delayed to P6; implemented in P3 kernel safety core
- [ ] D-109: All state transitions are tested

---

## Open Questions

1. What is the default cooldown duration for OPEN -> HALF_OPEN? Suggested: 5 minutes initial, configurable.
2. What constitutes a "low-risk probe task" for HALF_OPEN? Is it a synthetic health-check task, or the smallest queued real task?
3. Should there be a maximum HALF_OPEN duration (probe timeout) after which it auto-fails back to OPEN?
4. Should the failure rate window size (10 minutes) and threshold (>30%) be configurable per deployment, or hard-coded?

---

## Audit Notes

- This contract is DRAFT_FOR_AUDIT. Trigger thresholds (30% failure rate, 15min RED, 5min cooldown) are initial values that should be calibrated with real-world data during P3 testing.
- The diagnostic snapshot shape should be validated against what operators actually need to diagnose OPEN events.
- Ensure the probe protocol cannot be abused to bypass the safety guard (e.g., probe tasks that always pass trivially).
- The relationship between Circuit Breaker OPEN and Governor should be clarified: does Governor freeze tier during OPEN, or continue monitoring?
