# RuntimeEvent Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the RuntimeEvent contract — the universal event envelope for all PRAXIS runtime state changes. Every state mutation in the system emits a RuntimeEvent. Events are append-only, monotonically sequenced, and serve as the source of truth for UI state reconstruction via snapshot + replay.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The RuntimeEvent is the atomic unit of observability in PRAXIS. Every component (kernel, adapter, hook, server, human) emits events when state changes. Events flow through the SSE stream to the UI and are persisted in the append-only event log.

The RuntimeEvent contract defines:
- The universal event envelope shared by all event types
- The event type taxonomy
- The sequencing and gap-detection mechanism
- The event source taxonomy
- What events must NOT carry (completion decisions, verdicts from unauthorized sources)

---

## Scope

- Defines the universal `RuntimeEvent` envelope
- Defines all event type categories and their payload shapes
- Defines sequencing rules (monotonic, gap-detection via `previous_seq`)
- Defines event source taxonomy (kernel, adapter, hook, server, human)
- Defines event replay semantics for UI state reconstruction

---

## Non-Goals

- How events are persisted (storage layer territory)
- How events are streamed via SSE (server territory)
- How events are consumed by the UI (interface territory)
- Gate verdict shapes in full detail (Truth Engine / gate-verdict contract territory)
- EvidenceRecord detailed structure (Evidence Hash Chain territory)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-025 | HTTP commands/queries + SSE event stream | Events are the SSE payload; this contract defines their shape |
| D-026 | UI state from snapshot + RuntimeEvent replay | Events carry the incremental state updates; `previous_seq` enables gap detection |
| D-029 | UI never decides completion | Forbidden: UI-generated completion events |
| D-030 | Adapter never decides completion | Forbidden: adapter-generated verdict events |
| D-031 | Hook never decides truth | Hook events are raw evidence, not truth claims |
| D-091 | Durable event log is required | Events are append-only; sequence numbers are monotonic |
| D-095 | `runtime_events` append-only log | Event immutability: events are never modified or deleted |
| D-096 | Snapshot + event replay is UI state source | `previous_seq` enables gap detection → snapshot refresh |

---

## Conceptual Model

```
┌──────────────────────────────────────────────────────────────┐
│                    RuntimeEvent Stream                        │
│                                                              │
│  seq: 1      seq: 2      seq: 3      seq: 4      seq: 5     │
│  ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐   │
│  │Plan  │───→│Task  │───→│Worker│───→│Gate  │───→│Circuit│  │
│  │Admit │    │Run   │    │Health│    │Verdict│   │Breaker│  │
│  │      │    │Start │    │Update│    │      │    │Open   │   │
│  └──────┘    └──────┘    └──────┘    └──────┘    └──────┘   │
│                                                              │
│  All events share the same envelope:                         │
│  ┌────────────────────────────────────────────────────┐     │
│  │  event_id    : unique identifier                    │     │
│  │  seq         : monotonic sequence number            │     │
│  │  timestamp   : ISO 8601 when emitted                │     │
│  │  type        : event category                       │     │
│  │  source      : who emitted (kernel/adapter/...)     │     │
│  │  entity_id   : which entity this is about           │     │
│  │  payload     : type-specific data                   │     │
│  │  previous_seq: previous event seq (gap detection)   │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  UI consumption model:                                       │
│  1. Load snapshot (initial state)                            │
│  2. Subscribe to SSE: GET /api/events?after=<snapshot.seq>   │
│  3. Apply each event incrementally                           │
│  4. If event.previous_seq != lastAppliedSeq + 1 → GAP        │
│     → Re-request snapshot → Replay from snapshot.lastEventSeq│
└──────────────────────────────────────────────────────────────┘
```

---

## Field Definitions

### RuntimeEvent (Universal Envelope)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `event_id` | string | **Yes** | Globally unique event identifier. Non-empty. Recommended format: `evt-{uuid}` or `evt-{timestamp}-{counter}`. Max 128 chars. |
| `seq` | number | **Yes** | Monotonic sequence number. Must be >= 1. Must be strictly greater than the previous event's `seq`. No gaps in the source log (gaps in the UI are detected via `previous_seq`). |
| `timestamp` | string (ISO 8601) | **Yes** | When the event was emitted. Must include timezone (UTC recommended: `Z` suffix). |
| `type` | string | **Yes** | Event category. Must be one of the defined event types below. Uses dot-separated convention: `category.action`. |
| `source` | enum string | **Yes** | Who emitted the event. Must be one of: `'kernel'`, `'adapter'`, `'hook'`, `'server'`, `'human'`. |
| `entity_id` | string | **Yes** | Which entity this event pertains to. Format depends on `type` (e.g., `task_run_id`, `worker_id`, `plan_id`). Non-empty. |
| `payload` | object | **Yes** | Type-specific event data. Shape depends on `type`. Must not be null. Must be a plain object (JSON-serializable). |
| `previous_seq` | number | **Yes** | The `seq` of the immediately preceding event in the log. Enables gap detection: if the UI's last applied `seq` is N and the next event has `previous_seq` != N, there is a gap. Must be >= 0. `previous_seq: 0` indicates this is the first event. |

---

## Event Type Taxonomy

### Lifecycle Events (source: `kernel`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `plan.admitted` | `plan_id` | `{ plan_id, plan_title, task_count, waves, admitted_at }` | PSAG admitted a plan for execution |
| `plan.rejected` | `plan_id` | `{ plan_id, plan_title, rejection_reasons: string[] }` | PSAG rejected a plan |
| `task_run.updated` | `task_run_id` | `{ task_run_id, previous_state, new_state, task_id, attempt_number, gate_verdict? }` | TaskRun FSM state changed. `gate_verdict` attached when state transitions to COMPLETE/FAILED/ABORTED. |
| `task_run.completed` | `task_run_id` | `{ task_run_id, task_id, final_verdict: 'PASS'\|'FAIL', total_attempts, duration_ms }` | TaskRun reached terminal state |
| `worker.updated` | `worker_id` | `{ worker_id, previous_status, new_status, current_task_run_id?, health_check? }` | Worker state changed (idle, running, degraded, etc.) |

### Gate Events (source: `kernel`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `gate.verdict` | `attempt_id` | `{ attempt_id, task_run_id, gate: 'evidence'\|'exec'\|'final', verdict: 'PASS'\|'HOLD'\|'FAIL', reason, criteria_results?, evidence_cited? }` | A gate produced a verdict for an attempt |
| `gate.pipeline_started` | `attempt_id` | `{ attempt_id, task_run_id, started_at }` | Truth Engine began evaluating an attempt |
| `gate.pipeline_completed` | `attempt_id` | `{ attempt_id, task_run_id, final_verdict: 'PASS'\|'HOLD'\|'FAIL', gates_run: string[], duration_ms }` | All three gates completed for an attempt |

### Evidence Events (source: `kernel`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `evidence.appended` | `attempt_id` | `{ attempt_id, evidence_id, source: 'kernel_hook'\|'git'\|'filesystem'\|'divergence_detector', kind, chain_hash }` | A new EvidenceRecord was added to the Evidence Hash Chain |
| `evidence.chain_broken` | `attempt_id` | `{ attempt_id, break_classification: 'NOISE'\|'SUSPECTED'\|'CONFIRMED', broken_at_hash, details }` | EHC integrity check detected a break |
| `evidence.divergence_detected` | `attempt_id` | `{ attempt_id, divergence_flags: DivergenceFlag[] }` | Hook events diverged from worker-reported output |

### Transcript Events (source: `hook`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `transcript.chunk` | `attempt_id` | `{ attempt_id, chunk_id, tool_name, tool_input?, tool_output?, event_type: 'pre_tool'\|'post_tool'\|'stop', timestamp }` | A single tool event captured by the hook layer |

### Circuit Breaker Events (source: `kernel`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `circuit_breaker.opened` | `circuit_breaker` | `{ trigger_reason, failure_rate?, governor_state?, ehc_break?, opened_at }` | Circuit Breaker transitioned to OPEN |
| `circuit_breaker.closed` | `circuit_breaker` | `{ closed_at, clean_window_duration_ms }` | Circuit Breaker transitioned to CLOSED (normal operation) |
| `circuit_breaker.half_opened` | `circuit_breaker` | `{ probe_attempt_id, opened_at }` | Circuit Breaker transitioned to HALF_OPEN (probing recovery) |

### Governor Events (source: `kernel`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `governor.updated` | `governor` | `{ previous_tier, new_tier, previous_state, new_state, active_workers, max_workers, reason }` | Governor tier or state changed |

### Human Action Events (source: `human` or `kernel`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `human_action.created` | `action_id` | `{ action_id, type, description, task_run_id?, attempt_id?, created_at }` | A human action was created (e.g., "review failed attempt", "approve repair strategy") |
| `human_action.resolved` | `action_id` | `{ action_id, resolution, resolved_by, resolved_at }` | A human action was resolved |

### System Events (source: `server`)

| Type | entity_id | Payload Shape | Description |
|------|-----------|---------------|-------------|
| `system.startup` | `runtime` | `{ version, started_at, config_summary }` | PRAXIS runtime server started |
| `system.shutdown` | `runtime` | `{ reason, shutdown_at, uptime_ms }` | PRAXIS runtime server shutting down |
| `system.error` | `runtime` | `{ error_type, message, stack_trace?, component }` | Unhandled system-level error |

---

## Forbidden Authority Fields

The following event types or payload fields MUST NOT exist. Emitting them violates authority boundaries.

| Forbidden Event / Field | Reason | Governing Decision |
|-------------------------|--------|-------------------|
| `task_run.completed` with `source: 'adapter'` | Adapter must not emit completion events. Only kernel may emit lifecycle events. | D-030 |
| `task_run.completed` with `source: 'interface'` | UI must not declare task completion. | D-029 |
| `gate.verdict` with `source: 'adapter'` | Adapter must not produce gate verdicts. | D-030 |
| `gate.verdict` with `source: 'interface'` | UI must not produce gate verdicts. | D-029 |
| `gate.verdict` with `source: 'hook'` | Hook must not produce gate verdicts. | D-031 |
| `task_run.updated` with `source: 'interface'` | UI must not update TaskRun state directly. State changes flow from kernel. | D-029 |
| Payload field `ui_generated_completion: true` | No UI-generated completion status. | D-029 |
| Payload field `adapter_decided_verdict: true` | No adapter-decided verdicts. | D-030 |
| Payload field `worker_declared_done: true` | Worker claims are carried as evidence, not as event-level completion declarations. | D-028 |
| `worker.updated` with `source: 'interface'` | UI must not update worker state. | D-029 |

---

## Sequencing Rules

| Rule | Description |
|------|-------------|
| S1 | `seq` MUST be strictly monotonic (each event has seq > previous event's seq) |
| S2 | `previous_seq` MUST equal the `seq` of the immediately preceding event in the persistent log |
| S3 | `previous_seq: 0` is valid ONLY for the very first event in the system |
| S4 | Events are append-only — once written, `seq`, `event_id`, and all payload fields are immutable |
| S5 | Events must not be deleted or modified after creation |
| S6 | If the event log is replayed, events must be consumed in `seq` order |
| S7 | The UI detects gaps when `received_event.previous_seq != lastAppliedSeq` |
| S8 | On gap detection, the UI requests a fresh snapshot and replays from `snapshot.lastEventSeq` |

---

## Replay Semantics

```
UI State Reconstruction Algorithm:

1. GET /api/snapshot → returns RuntimeSnapshot { lastEventSeq: N, ... }
2. Render snapshot state as initial UI state
3. lastAppliedSeq = N
4. Subscribe to SSE: GET /api/events?after=N
5. For each received RuntimeEvent:
   a. If event.previous_seq != lastAppliedSeq:
      → GAP DETECTED (events between lastAppliedSeq and event.previous_seq were missed)
      → Re-request snapshot (go to step 1)
   b. If event.seq <= lastAppliedSeq:
      → DUPLICATE (already applied). Skip.
   c. Otherwise:
      → Apply event to UI state based on event.type
      → lastAppliedSeq = event.seq
6. On SSE connection loss:
   → Reconnect with GET /api/events?after=lastAppliedSeq
```

---

## Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Missed events (gap) | `event.previous_seq != lastAppliedSeq` | Re-request snapshot, replay from snapshot's `lastEventSeq` |
| Duplicate event | `event.seq <= lastAppliedSeq` | Skip event (idempotent) |
| SSE disconnection | Connection close or timeout | Reconnect with `?after=lastAppliedSeq` |
| Corrupt event payload | JSON parse failure or missing required fields | Log error, skip event, alert operator |
| Out-of-order events | `event.seq < lastAppliedSeq` but not duplicate | Gap detection will trigger; re-snapshot |
| Forbidden source emits event | `source` is valid but event type should not come from that source (e.g., adapter emitting `gate.verdict`) | Reject event, log security violation, Circuit Breaker notification |
| Event log corruption | `previous_seq` chain has unresolvable break | Runtime halt, human intervention required |

---

## Test / Gate Implications

| Test Category | What to Test |
|---------------|-------------|
| Envelope validity | Every emitted event has all required fields, correct types |
| Monotonic sequence | `seq` values are strictly increasing in the event log |
| Previous_seq chain | Every event's `previous_seq` equals the prior event's `seq` |
| Gap detection | UI correctly detects gap when `previous_seq != lastAppliedSeq` |
| Snapshot refresh on gap | UI re-requests snapshot and replays from correct seq |
| Duplicate handling | UI skips events with `seq <= lastAppliedSeq` |
| Forbidden source rejection | Event with forbidden source + type combination is rejected |
| Event type completeness | All event types defined are emitted by the correct sources |
| Payload shape per type | Each event type's payload matches its defined shape |
| Immutability | Attempt to modify a persisted event fails or is rejected |
| SSE streaming | Events pushed via SSE arrive with correct envelope |
| Reconnect handling | SSE reconnects with correct `?after=` parameter |

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Contract-first development (D-098) | This document is the contract, written before implementation |
| lib/contracts boundary (D-019) | This contract lives in `lib/contracts`; event types are shared |
| HTTP + SSE communication (D-025) | Events are the SSE payload; this contract defines their shape |
| UI state from snapshot + event replay (D-026) | Replay semantics section defines the algorithm |
| UI never decides completion (D-029) | Forbidden: `source: 'interface'` on verdict/completion events |
| Adapter never decides completion (D-030) | Forbidden: `source: 'adapter'` on verdict/completion events |
| Hook never decides truth (D-031) | Hook events are `transcript.chunk` (raw evidence) only |
| Durable event log (D-091) | Immutability rule S4; append-only |
| `runtime_events` append-only (D-095) | Events never modified or deleted |
| Snapshot + replay (D-096) | `previous_seq` gap detection mechanism |

---

## Conceptual Examples

### Plan admitted event
```json
{
  "event_id": "evt-a1b2c3d4-0001",
  "seq": 1,
  "timestamp": "2026-06-18T14:00:00.000Z",
  "type": "plan.admitted",
  "source": "kernel",
  "entity_id": "plan-auth-v1",
  "payload": {
    "plan_id": "plan-auth-v1",
    "plan_title": "Authentication System Implementation",
    "task_count": 3,
    "waves": 3,
    "admitted_at": "2026-06-18T14:00:00.000Z"
  },
  "previous_seq": 0
}
```

### Task run state change event (with gate verdict)
```json
{
  "event_id": "evt-e5f6g7h8-0015",
  "seq": 15,
  "timestamp": "2026-06-18T14:35:00.000Z",
  "type": "task_run.updated",
  "source": "kernel",
  "entity_id": "taskrun-auth-core-001",
  "payload": {
    "task_run_id": "taskrun-auth-core-001",
    "previous_state": "VERIFYING",
    "new_state": "COMPLETE",
    "task_id": "auth-core-impl",
    "attempt_number": 1,
    "gate_verdict": {
      "verdict": "PASS",
      "reason": "All three gates passed. Acceptance criteria satisfied.",
      "gates": {
        "evidence_gate": "PASS",
        "exec_gate": "PASS",
        "final_gate": "PASS"
      }
    }
  },
  "previous_seq": 14
}
```

### Gate verdict event
```json
{
  "event_id": "evt-i9j0k1l2-0012",
  "seq": 12,
  "timestamp": "2026-06-18T14:34:15.000Z",
  "type": "gate.verdict",
  "source": "kernel",
  "entity_id": "attempt-run-42-001",
  "payload": {
    "attempt_id": "attempt-run-42-001",
    "task_run_id": "taskrun-auth-core-001",
    "gate": "final",
    "verdict": "PASS",
    "reason": "All acceptance criteria satisfied. File src/auth/login.ts exists. All tests pass. Diff contains required changes.",
    "criteria_results": [
      { "criterion_id": "ac-core-1", "passed": true, "detail": "Tests passed with exit code 0" }
    ],
    "evidence_cited": [
      "evidence://plan-auth-v1/attempt-run-42-001/stdout.log",
      "evidence://plan-auth-v1/attempt-run-42-001/diff.patch"
    ]
  },
  "previous_seq": 11
}
```

### Circuit breaker opened event
```json
{
  "event_id": "evt-m3n4o5p6-0042",
  "seq": 42,
  "timestamp": "2026-06-18T15:10:00.000Z",
  "type": "circuit_breaker.opened",
  "source": "kernel",
  "entity_id": "circuit_breaker",
  "payload": {
    "trigger_reason": "failure_rate_exceeded",
    "failure_rate": 0.35,
    "governor_state": "YELLOW",
    "ehc_break": null,
    "opened_at": "2026-06-18T15:10:00.000Z"
  },
  "previous_seq": 41
}
```

### Governor updated event
```json
{
  "event_id": "evt-q7r8s9t0-0050",
  "seq": 50,
  "timestamp": "2026-06-18T15:30:00.000Z",
  "type": "governor.updated",
  "source": "kernel",
  "entity_id": "governor",
  "payload": {
    "previous_tier": "stable_3",
    "new_tier": "stable_6",
    "previous_state": "GREEN",
    "new_state": "GREEN",
    "active_workers": 6,
    "max_workers": 6,
    "reason": "48h clean window achieved; promoted from stable_3 to stable_6"
  },
  "previous_seq": 49
}
```

### Human action created event
```json
{
  "event_id": "evt-u1v2w3x4-0060",
  "seq": 60,
  "timestamp": "2026-06-18T15:45:00.000Z",
  "type": "human_action.created",
  "source": "kernel",
  "entity_id": "action-review-failed-001",
  "payload": {
    "action_id": "action-review-failed-001",
    "type": "review_failed_attempt",
    "description": "Task auth-core-impl failed after 5 repair attempts. Human review required.",
    "task_run_id": "taskrun-auth-core-001",
    "attempt_id": "attempt-run-42-005",
    "created_at": "2026-06-18T15:45:00.000Z"
  },
  "previous_seq": 59
}
```

### Transcript chunk event (from hook)
```json
{
  "event_id": "evt-y5z6a7b8-0008",
  "seq": 8,
  "timestamp": "2026-06-18T14:30:05.000Z",
  "type": "transcript.chunk",
  "source": "hook",
  "entity_id": "attempt-run-42-001",
  "payload": {
    "attempt_id": "attempt-run-42-001",
    "chunk_id": "chunk-001",
    "tool_name": "Write",
    "tool_input": { "file_path": "src/auth/login.ts", "content": "export function login(..." },
    "tool_output": null,
    "event_type": "pre_tool",
    "timestamp": "2026-06-18T14:30:05.000Z"
  },
  "previous_seq": 7
}
```

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Should event types have a formal registry with versioning, or is the string-based taxonomy sufficient? | OPEN — likely formalized during P0.2 |
| Q2 | Should `payload` be strictly typed per event type (discriminated union) or loosely typed (any valid JSON object)? | OPEN — P0.2 TypeScript types will determine |
| Q3 | How large can a single event payload be? Should large payloads (e.g., full diff text) be references instead? | OPEN — references preferred; size cap needed |
| Q4 | Should `previous_seq` be omitted for the first event (`seq: 1`) or explicitly set to `0`? | OPEN — current draft uses `0`; either is valid |
| Q5 | Should events have a `correlation_id` for tracing related events across types? | OPEN — useful for debugging complex failure chains |
| Q6 | Should the event envelope include a `version` field for forward compatibility? | OPEN — recommended but adds complexity |

---

## Audit Notes

- The `source` field is the primary enforcement mechanism for authority boundaries. Every event consumer (UI, storage, audit) should validate that `source` matches the expected origin for the event `type`. An adapter emitting `gate.verdict` with `source: 'adapter'` is a security violation.
- `previous_seq` is essential for gap detection and replay integrity. Without it, the UI cannot distinguish between "all events received in order" and "events were silently lost."
- The event type taxonomy is designed to be exhaustive but not final. New event types will be added as components mature. Missing event types should not cause system failure; unknown types should be logged and passed through.
- Transcript chunks (`transcript.chunk`) are the raw tool events from the hook layer. They are evidence, not truth. The kernel processes them for divergence detection but passes them through unfiltered.
- The replay semantics algorithm is intentionally simple. No vector clocks, no CRDTs, no distributed consensus. A single-writer event log with monotonic sequence numbers is sufficient for a single-machine PRAXIS runtime.
