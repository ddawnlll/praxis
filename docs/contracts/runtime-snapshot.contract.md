# RuntimeSnapshot Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the RuntimeSnapshot contract — the point-in-time summary of all PRAXIS runtime state. The snapshot is the initial state source for the UI (loaded once, then incrementally updated via RuntimeEvent replay) and the restart state source for runtime recovery.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The RuntimeSnapshot is a complete point-in-time representation of the PRAXIS runtime. It serves two critical functions:

1. **UI bootstrap**: The UI loads a snapshot on first render, then applies incremental `RuntimeEvent` updates via SSE. If gaps are detected, a fresh snapshot is requested.
2. **Runtime recovery**: On server restart, the last persisted snapshot is loaded, then events after `lastEventSeq` are replayed to reconstruct the current state.

The snapshot is derived from the event log, not independently generated. It is a materialized view of the append-only event stream at a specific sequence number.

---

## Scope

- Defines the `RuntimeSnapshot` top-level shape
- Defines sub-types: `RuntimeStatus`, `GovernorSummary`, `CircuitBreakerSummary`, `TaskRunSummary`, `WorkerSummary`, `HumanAction`
- Defines the UI consumption model: snapshot → SSE replay → gap → re-snapshot
- Defines what the snapshot must NOT contain (UI-generated state, overridden verdicts)

---

## Non-Goals

- How snapshots are generated from the event log (server implementation)
- How often snapshots are persisted (configurable, server territory)
- The SSE streaming mechanism (server territory)
- How the UI renders snapshot data (interface territory)
- Event shape details (see `runtime-event.contract.md`)
- Detailed gate verdict structure (see `run-attempt.contract.md` and future `gate-verdict.contract.md`)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-026 | UI state from snapshot + RuntimeEvent replay | This contract is the snapshot shape; UI loads this first |
| D-029 | UI never decides completion | Forbidden: UI-generated state, user_overridden_verdicts |
| D-065 | Desktop renders runtime state from server/client contracts | Snapshot is the primary server → client state contract |
| D-066 | Desktop must not own truth | Snapshot displays kernel-derived state; never UI-authored state |
| D-096 | Snapshot + event replay is UI state source | `lastEventSeq` enables gap detection and replay range |
| D-095 | `runtime_events` append-only log | Snapshot is a materialized view of the event log |
| D-091 | Durable event log is required | Snapshot enables recovery after restart |

---

## Conceptual Model

```
┌──────────────────────────────────────────────────────────────┐
│                     Runtime Snapshot                          │
│                                                              │
│  A point-in-time summary at sequence number N                │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  runtime                  System state                │    │
│  │  governor                 Concurrency status          │    │
│  │  circuit_breaker          Safety state               │    │
│  │  active_runs[]            All active TaskRuns         │    │
│  │  workers[]                All registered workers      │    │
│  │  pending_human_actions[]  Actions awaiting human      │    │
│  │  last_event_seq           Latest seq in event log    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  UI Consumption Model:                                       │
│                                                              │
│  ┌──────────┐     ┌──────────────────────────────┐          │
│  │ Snapshot │────→│ Render initial UI state       │          │
│  │ seq: N   │     │ lastAppliedSeq = N            │          │
│  └──────────┘     └───────────┬──────────────────┘          │
│                               │                             │
│                               ▼                             │
│                    ┌──────────────────────┐                  │
│                    │ SSE: events after N  │                  │
│                    │ Apply each event     │                  │
│                    │ lastAppliedSeq++     │                  │
│                    └───────────┬──────────┘                  │
│                               │                             │
│                         GAP DETECTED?                       │
│                         (previous_seq != lastAppliedSeq)    │
│                               │                             │
│                               ▼                             │
│                    ┌──────────────────────┐                  │
│                    │ Re-request snapshot  │                  │
│                    │ Re-render from new N │                  │
│                    └──────────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

### What the Snapshot IS

- A materialized view of all relevant runtime state at a specific event sequence number
- Derived entirely from the append-only event log
- The single authoritative state source for UI bootstrap and recovery
- A read-only summary (the UI never writes back to the snapshot)

### What the Snapshot IS NOT

- Not a real-time stream (events provide incremental updates)
- Not a database of record (the event log is the record)
- Not a UI-authored view (no UI-generated state)
- Not a replacement for individual entity queries (GET /api/task-runs/:id etc.)

---

## Field Definitions

### RuntimeSnapshot (Top Level)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `runtime` | RuntimeStatus | **Yes** | Overall runtime system status. See sub-type below. |
| `governor` | GovernorSummary | **Yes** | Current concurrency governor state. See sub-type below. |
| `circuit_breaker` | CircuitBreakerSummary | **Yes** | Current circuit breaker state. See sub-type below. |
| `active_runs` | TaskRunSummary[] | **Yes** | All currently active (non-terminal) TaskRuns. May be empty. |
| `workers` | WorkerSummary[] | **Yes** | All registered workers and their current status. May be empty. |
| `pending_human_actions` | HumanAction[] | **Yes** | All unresolved human actions requiring operator attention. May be empty. |
| `last_event_seq` | number | **Yes** | The `seq` of the last event included in this snapshot. Used by the UI as the starting point for SSE `?after=` parameter. Must be >= 0. `0` indicates no events have been emitted yet. |

### RuntimeStatus

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `status` | enum string | **Yes** | One of: `'running'`, `'paused'`, `'stopped'`. `'running'` = accepting and executing plans. `'paused'` = accepting plans but not executing (Circuit Breaker OPEN or manual pause). `'stopped'` = runtime server shut down. |
| `started_at` | string (ISO 8601) | **Yes** | When the runtime server started. |
| `uptime_ms` | number | **Yes** | Milliseconds since `started_at`. Must be >= 0. |
| `version` | string | No | PRAXIS version string (e.g., `"0.1.0"`). Useful for UI compatibility checks. |
| `active_plans` | number | No | Count of currently admitted (non-terminal) plans. |

### GovernorSummary

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `tier` | string | **Yes** | Current governor tier. One of: `'stable_3'`, `'stable_6'`, `'stable_8'`, `'stable_12'`, `'stable_16'`. |
| `active_workers` | number | **Yes** | Number of currently active (running) workers. Must be >= 0 and <= `max_workers`. |
| `max_workers` | number | **Yes** | Maximum allowed concurrent workers at current tier. |
| `state` | enum string | **Yes** | One of: `'GREEN'`, `'YELLOW'`, `'RED'`. `'GREEN'` = normal operation. `'YELLOW'` = elevated failure rate, monitoring. `'RED'` = high failure rate, may trigger Circuit Breaker. |
| `clean_window_hours` | number | **Yes** | Hours of consecutive clean operation at current tier. Used for tier promotion. Must be >= 0. |
| `clean_window_started_at` | string (ISO 8601) or null | **Yes** | When the current clean window started. `null` if not currently in a clean window (state is YELLOW or RED). |
| `total_tasks_completed` | number | No | Cumulative count of tasks that reached COMPLETE state. Useful for stability metrics. |
| `total_attempts` | number | No | Cumulative count of all attempts across all tasks. |

### CircuitBreakerSummary

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `state` | enum string | **Yes** | One of: `'CLOSED'`, `'OPEN'`, `'HALF_OPEN'`. `'CLOSED'` = normal operation, admitting work. `'OPEN'` = rejecting all new admissions. `'HALF_OPEN'` = probing with exactly one attempt. |
| `opened_since` | string (ISO 8601) or null | **Yes** | When the Circuit Breaker opened. `null` if state is `'CLOSED'`. |
| `trigger_reason` | string or null | **Yes** | Why the breaker opened. One of: `'failure_rate_exceeded'`, `'governor_RED_sustained'`, `'EHC_CONFIRMED_break'`. `null` if state is `'CLOSED'`. |
| `probe_attempt_id` | string or null | No | The attempt ID of the current probe attempt. Only set when state is `'HALF_OPEN'`. |
| `failure_rate` | number or null | No | Current failure rate in the sliding window (0.0 to 1.0). `null` if not applicable. |
| `recent_failures` | number | No | Count of failures in the current sliding window. |
| `recent_total` | number | No | Total attempts in the current sliding window. |

### TaskRunSummary

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `task_run_id` | string | **Yes** | Unique TaskRun identifier. |
| `task_id` | string | **Yes** | The `TaskSpec.task_id` this run is executing. |
| `state` | enum string | **Yes** | Current FSM state. One of: `'DORMANT'`, `'QUEUED'`, `'WORKSPACE_INIT'`, `'RUNNING'`, `'CAPTURING'`, `'VERIFYING'`, `'COMPLETE'`, `'REPAIR'`, `'ABORTED'`, `'FAILED'`. COMPLETE and ABORTED/FAILED are terminal states. |
| `worker_id` | string or null | **Yes** | Which worker is assigned. `null` if not yet assigned or task is DORMANT/QUEUED. |
| `namespace` | string[] | **Yes** | The namespace (file paths) this task run owns. From TaskSpec. |
| `attempt_number` | number | **Yes** | Which attempt is currently active (1-based). `0` if no attempt has started yet. |
| `total_attempts` | number | **Yes** | Total attempts executed so far for this task run. |
| `started_at` | string (ISO 8601) or null | **Yes** | When this task run first entered a non-DORMANT state. `null` if DORMANT. |
| `last_attempt_at` | string (ISO 8601) or null | No | When the most recent attempt ended. `null` if no attempts yet. |
| `final_verdict` | string or null | No | Final Truth Engine verdict. One of `'PASS'`, `'FAIL'`. Only set for terminal states (COMPLETE, FAILED). `null` if not yet terminal. |
| `repair_strategy` | string or null | No | Current RIM strategy if in REPAIR state. One of: `'initial'`, `'context_expand'`, `'tool_restrict'`, `'scope_narrow'`, `'knowledge_inject'`, `'hint_inject'`. |

### WorkerSummary

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `worker_id` | string | **Yes** | Unique worker identifier. |
| `type` | string | **Yes** | Worker type. One of: `'claude-code'`, `'opencode'`, `'local-model'`, `'mock'`. |
| `status` | enum string | **Yes** | Current worker status. One of: `'idle'`, `'running'`, `'degraded'`, `'unavailable'`. |
| `current_task_run_id` | string or null | **Yes** | The TaskRun this worker is currently executing. `null` if idle. |
| `last_health_check` | string (ISO 8601) or null | **Yes** | When the last health check was performed. `null` if never checked. |
| `health_status` | enum string or null | **Yes** | Last known health: `'healthy'`, `'degraded'`, `'unavailable'`. `null` if never checked. |
| `total_attempts_completed` | number | No | Cumulative attempts completed by this worker. |
| `total_failures` | number | No | Cumulative failures produced by this worker. |

### HumanAction

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `action_id` | string | **Yes** | Unique action identifier. |
| `type` | string | **Yes** | Action type. One of: `'review_failed_attempt'`, `'approve_repair'`, `'resolve_conflict'`, `'override_circuit_breaker'`, `'review_divergence'`, `'acknowledge_system_error'`. |
| `description` | string | **Yes** | Human-readable description of what action is needed. Min 10 chars. |
| `task_run_id` | string or null | No | Associated TaskRun, if any. |
| `attempt_id` | string or null | No | Associated attempt, if any. |
| `created_at` | string (ISO 8601) | **Yes** | When this action was created. |
| `status` | enum string | **Yes** | One of: `'pending'`, `'acknowledged'`, `'resolved'`. |
| `priority` | enum string | No | One of: `'low'`, `'medium'`, `'high'`, `'critical'`. Default: `'medium'`. |
| `resolved_by` | string or null | No | Who resolved the action. `null` if not yet resolved. |
| `resolved_at` | string (ISO 8601) or null | No | When the action was resolved. `null` if not yet resolved. |

---

## Forbidden Authority Fields

The following fields or categories MUST NOT appear in any RuntimeSnapshot or sub-type.

| Forbidden Field | Reason | Governing Decision |
|-----------------|--------|-------------------|
| `ui_generated_state` | Snapshot is derived from kernel events, not UI-authored state. | D-029, D-066 |
| `user_overridden_verdicts` | Users cannot override gate verdicts through the snapshot. | D-029, D-066 |
| `manually_marked_complete` | No manual completion marking. Completion is determined by Truth Engine gates. | D-029, D-028 |
| `ui_state` (as a top-level or child field) | UI state (layout, selections, view preferences) belongs in the UI, not the runtime snapshot. | D-065 |
| `optimistic_updates` | Snapshot is derived from confirmed events, not optimistic UI predictions. | D-026, D-096 |
| `completion_overrides` | No mechanism to override gate verdicts at the snapshot level. | D-032 |
| `force_completed_tasks` | Tasks cannot be force-completed through snapshot manipulation. | D-032, D-028 |
| `user_decision_overrides` | User decisions (e.g., "I checked, this is fine") must go through human_action events, not snapshot fields. | D-029 |

---

## UI Consumption Algorithm

```
FUNCTION initializeUI():
    snapshot = GET /api/snapshot
    renderState(snapshot)
    lastAppliedSeq = snapshot.last_event_seq

    sse = subscribeToSSE("/api/events?after=" + lastAppliedSeq)

    ON each event from sse:
        IF event.previous_seq != lastAppliedSeq:
            // Gap detected — events were missed
            snapshot = GET /api/snapshot
            renderState(snapshot)      // Full re-render
            lastAppliedSeq = snapshot.last_event_seq
            sse.reconnect("?after=" + lastAppliedSeq)
            CONTINUE

        IF event.seq <= lastAppliedSeq:
            // Duplicate — already applied
            SKIP

        applyEvent(event)               // Incremental state mutation
        lastAppliedSeq = event.seq

    ON sse disconnect:
        sse.reconnect("/api/events?after=" + lastAppliedSeq)

FUNCTION applyEvent(event):
    SWITCH event.type:
        CASE "plan.admitted":
            // Plan added; tasks may appear as DORMANT
        CASE "task_run.updated":
            // Update or add TaskRunSummary
        CASE "worker.updated":
            // Update WorkerSummary
        CASE "gate.verdict":
            // Update task run gate results
        CASE "circuit_breaker.opened":
            // Update CircuitBreakerSummary state to OPEN
        CASE "circuit_breaker.closed":
            // Update CircuitBreakerSummary state to CLOSED
        CASE "circuit_breaker.half_opened":
            // Update CircuitBreakerSummary state to HALF_OPEN
        CASE "governor.updated":
            // Update GovernorSummary
        CASE "human_action.created":
            // Add to pending_human_actions
        CASE "human_action.resolved":
            // Remove from pending_human_actions
        CASE "system.shutdown":
            // Runtime status → stopped
        // etc. for all event types
```

---

## Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Snapshot is stale (newer events exist) | `snapshot.last_event_seq < event_log.latest_seq` | Normal operation — UI applies subsequent events via SSE |
| Snapshot contains terminal tasks | Terminal tasks are in `active_runs` | Bug in snapshot generation: terminal tasks should be excluded |
| Snapshot missing a worker that has events | Worker not in `workers[]` but has recent events | Bug: snapshot generation missed an entity |
| Snapshot `last_event_seq` does not match actual event log | Gap detection after snapshot load | Re-request snapshot; if persistent, investigate event log integrity |
| Snapshot too large (many active runs) | Performance degradation | Paginate or limit `active_runs`; provide detail endpoints |
| Inconsistent snapshot (e.g., governor tier doesn't match worker count) | Assertion failure in UI | Snapshot derived incorrectly; investigate event replay logic |
| Server restart: snapshot is missing | No snapshot persisted | Reconstruct from event log (full replay from seq 1) |

---

## Test / Gate Implications

| Test Category | What to Test |
|---------------|-------------|
| Snapshot shape integrity | Snapshot response matches contract: all required fields present, correct types |
| Empty system snapshot | Fresh runtime: `active_runs: []`, `workers: []`, `pending_human_actions: []`, `last_event_seq: 0` |
| Single active run | After plan admission and task start: snapshot contains one active run with correct state |
| Terminal task exclusion | After task completes: active_runs no longer includes it |
| Governor tier in snapshot | Governor state matches actual runtime tier |
| Circuit breaker state | CB state in snapshot matches actual CB state |
| Human actions in snapshot | Created actions appear; resolved actions disappear |
| Snapshot after event application | Apply event → request new snapshot → snapshot reflects event |
| Gap detection integration | UI loads snapshot, misses events, detects gap, re-requests snapshot |
| Forbidden field absence | Snapshot must not contain `ui_generated_state`, `user_overridden_verdicts`, `manually_marked_complete` |
| `last_event_seq` correctness | `last_event_seq` equals the seq of the most recent event at snapshot time |
| Snapshot immutability | Attempt to write to snapshot endpoint returns 405 or is rejected |

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Contract-first development (D-098) | This document is the contract, written before implementation |
| UI state from snapshot + event replay (D-026) | Snapshot shape + UI consumption algorithm defined |
| UI never decides completion (D-029) | Forbidden: `ui_generated_state`, `user_overridden_verdicts`, `manually_marked_complete` |
| Desktop renders from server/client contracts (D-065) | Snapshot is the primary server → client contract |
| Desktop must not own truth (D-066) | No UI-authored truth fields |
| Snapshot + replay (D-096) | `lastEventSeq` enables correct replay range |
| Durable event log (D-091) | Snapshot is a materialized view enabling recovery |
| `runtime_events` append-only (D-095) | Snapshot is derived, not primary storage |

---

## Conceptual Examples

### Empty runtime (fresh start, no events yet)
```json
{
  "runtime": {
    "status": "running",
    "started_at": "2026-06-18T14:00:00.000Z",
    "uptime_ms": 0,
    "version": "0.1.0",
    "active_plans": 0
  },
  "governor": {
    "tier": "stable_3",
    "active_workers": 0,
    "max_workers": 3,
    "state": "GREEN",
    "clean_window_hours": 0,
    "clean_window_started_at": "2026-06-18T14:00:00.000Z"
  },
  "circuit_breaker": {
    "state": "CLOSED",
    "opened_since": null,
    "trigger_reason": null,
    "failure_rate": 0,
    "recent_failures": 0,
    "recent_total": 0
  },
  "active_runs": [],
  "workers": [
    {
      "worker_id": "claude-code-worker-1",
      "type": "claude-code",
      "status": "idle",
      "current_task_run_id": null,
      "last_health_check": "2026-06-18T14:00:01.000Z",
      "health_status": "healthy"
    },
    {
      "worker_id": "claude-code-worker-2",
      "type": "claude-code",
      "status": "idle",
      "current_task_run_id": null,
      "last_health_check": "2026-06-18T14:00:01.000Z",
      "health_status": "healthy"
    },
    {
      "worker_id": "claude-code-worker-3",
      "type": "claude-code",
      "status": "idle",
      "current_task_run_id": null,
      "last_health_check": "2026-06-18T14:00:01.000Z",
      "health_status": "healthy"
    }
  ],
  "pending_human_actions": [],
  "last_event_seq": 0
}
```

### Active runtime (plan executing, 2 tasks running)
```json
{
  "runtime": {
    "status": "running",
    "started_at": "2026-06-18T14:00:00.000Z",
    "uptime_ms": 1800000,
    "version": "0.1.0",
    "active_plans": 1
  },
  "governor": {
    "tier": "stable_3",
    "active_workers": 2,
    "max_workers": 3,
    "state": "GREEN",
    "clean_window_hours": 0.5,
    "clean_window_started_at": "2026-06-18T14:00:00.000Z",
    "total_tasks_completed": 1,
    "total_attempts": 1
  },
  "circuit_breaker": {
    "state": "CLOSED",
    "opened_since": null,
    "trigger_reason": null,
    "failure_rate": 0,
    "recent_failures": 0,
    "recent_total": 1
  },
  "active_runs": [
    {
      "task_run_id": "taskrun-auth-types-001",
      "task_id": "auth-types",
      "state": "VERIFYING",
      "worker_id": "claude-code-worker-1",
      "namespace": ["src/auth/types.ts"],
      "attempt_number": 1,
      "total_attempts": 1,
      "started_at": "2026-06-18T14:10:00.000Z",
      "last_attempt_at": "2026-06-18T14:15:00.000Z",
      "final_verdict": null,
      "repair_strategy": null
    },
    {
      "task_run_id": "taskrun-auth-core-001",
      "task_id": "auth-core-impl",
      "state": "RUNNING",
      "worker_id": "claude-code-worker-2",
      "namespace": ["src/auth/login.ts", "src/auth/session.ts", "tests/auth/"],
      "attempt_number": 2,
      "total_attempts": 2,
      "started_at": "2026-06-18T14:15:00.000Z",
      "last_attempt_at": "2026-06-18T14:25:00.000Z",
      "final_verdict": null,
      "repair_strategy": null
    }
  ],
  "workers": [
    {
      "worker_id": "claude-code-worker-1",
      "type": "claude-code",
      "status": "running",
      "current_task_run_id": "taskrun-auth-types-001",
      "last_health_check": "2026-06-18T14:28:00.000Z",
      "health_status": "healthy"
    },
    {
      "worker_id": "claude-code-worker-2",
      "type": "claude-code",
      "status": "running",
      "current_task_run_id": "taskrun-auth-core-001",
      "last_health_check": "2026-06-18T14:28:00.000Z",
      "health_status": "healthy"
    },
    {
      "worker_id": "claude-code-worker-3",
      "type": "claude-code",
      "status": "idle",
      "current_task_run_id": null,
      "last_health_check": "2026-06-18T14:28:00.000Z",
      "health_status": "healthy"
    }
  ],
  "pending_human_actions": [],
  "last_event_seq": 28
}
```

### Runtime with Circuit Breaker OPEN and pending human action
```json
{
  "runtime": {
    "status": "paused",
    "started_at": "2026-06-18T14:00:00.000Z",
    "uptime_ms": 4200000,
    "version": "0.1.0",
    "active_plans": 1
  },
  "governor": {
    "tier": "stable_3",
    "active_workers": 0,
    "max_workers": 3,
    "state": "RED",
    "clean_window_hours": 0,
    "clean_window_started_at": null,
    "total_tasks_completed": 2,
    "total_attempts": 8
  },
  "circuit_breaker": {
    "state": "OPEN",
    "opened_since": "2026-06-18T15:10:00.000Z",
    "trigger_reason": "failure_rate_exceeded",
    "probe_attempt_id": null,
    "failure_rate": 0.375,
    "recent_failures": 3,
    "recent_total": 8
  },
  "active_runs": [
    {
      "task_run_id": "taskrun-auth-core-001",
      "task_id": "auth-core-impl",
      "state": "FAILED",
      "worker_id": "claude-code-worker-2",
      "namespace": ["src/auth/login.ts", "src/auth/session.ts", "tests/auth/"],
      "attempt_number": 5,
      "total_attempts": 5,
      "started_at": "2026-06-18T14:15:00.000Z",
      "last_attempt_at": "2026-06-18T15:05:00.000Z",
      "final_verdict": "FAIL",
      "repair_strategy": "knowledge_inject"
    }
  ],
  "workers": [
    {
      "worker_id": "claude-code-worker-1",
      "type": "claude-code",
      "status": "degraded",
      "current_task_run_id": null,
      "last_health_check": "2026-06-18T15:09:00.000Z",
      "health_status": "degraded"
    },
    {
      "worker_id": "claude-code-worker-2",
      "type": "claude-code",
      "status": "idle",
      "current_task_run_id": null,
      "last_health_check": "2026-06-18T15:09:00.000Z",
      "health_status": "healthy"
    },
    {
      "worker_id": "claude-code-worker-3",
      "type": "claude-code",
      "status": "idle",
      "current_task_run_id": null,
      "last_health_check": "2026-06-18T15:09:00.000Z",
      "health_status": "healthy"
    }
  ],
  "pending_human_actions": [
    {
      "action_id": "action-review-failed-001",
      "type": "review_failed_attempt",
      "description": "Task auth-core-impl failed after 5 repair attempts. All RIM strategies exhausted. Human review required to determine next steps.",
      "task_run_id": "taskrun-auth-core-001",
      "attempt_id": "attempt-run-42-005",
      "created_at": "2026-06-18T15:05:00.000Z",
      "status": "pending",
      "priority": "high"
    },
    {
      "action_id": "action-cb-open-001",
      "type": "override_circuit_breaker",
      "description": "Circuit breaker opened due to failure rate 37.5% exceeding 30% threshold. Human review required to assess if system is safe to resume.",
      "task_run_id": null,
      "attempt_id": null,
      "created_at": "2026-06-18T15:10:00.000Z",
      "status": "pending",
      "priority": "critical"
    }
  ],
  "last_event_seq": 60
}
```

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | How often should snapshots be generated? Every N events? Every M seconds? On demand? | OPEN — configurable; P2 mock runtime will determine |
| Q2 | Should the snapshot include completed tasks (for history view) or only active ones? | OPEN — active only for this contract; history via separate endpoint |
| Q3 | Should `TaskRunSummary` include the latest gate verdict for the current attempt? | OPEN — currently implied via `final_verdict` for terminal states |
| Q4 | Should `WorkerSummary` include resource usage metrics (CPU, memory)? | OPEN — useful for monitoring but may belong in telemetry, not snapshot |
| Q5 | Should the snapshot include a `generated_at` timestamp in addition to `last_event_seq`? | OPEN — useful for staleness detection |
| Q6 | How should the snapshot handle "in-flight" state (e.g., task transitioning between states at snapshot time)? | OPEN — snapshot should capture state at exactly `last_event_seq`; no partial transitions |

---

## Audit Notes

- The snapshot is a materialized view of the event log. Its correctness depends on correct event replay. If the event log is corrupt, the snapshot will be wrong. The snapshot itself has no independent correctness.
- `last_event_seq` is the critical link between snapshot and event stream. If this value is wrong, the UI will either miss events (seq too low) or receive duplicates (seq too high). Both scenarios are recoverable via gap detection.
- The forbidden fields section is essential for Law 1 and Law 3 enforcement at the UI boundary. Even if the UI has a "force complete" button in a future version, it must go through a `human_action` event (which the kernel processes), not directly into the snapshot.
- The snapshot deliberately excludes ACCP artifacts (FVR, PRR). Those are async and non-blocking (D-037, D-038); including them in the snapshot would create a false dependency between execution state and artifact production.
- Terminal tasks in the `active_runs` array (as shown in the Circuit Breaker OPEN example) represent tasks that reached COMPLETE/FAILED/ABORTED but whose post-execution processing (ACCP artifact generation, human action resolution) is not yet complete. This is intentional: "active" means "not fully resolved," not "currently executing."
