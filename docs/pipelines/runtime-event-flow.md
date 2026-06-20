> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** This document describes server/runtime, SSE event streaming, RuntimeSnapshot, and append-only event log — all FUTURE scope for v0.1. v0.1 uses local JSONL files in `.praxis/`. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# Runtime Event Flow

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the RuntimeEvent model, append-only event log, SSE streaming, snapshot mechanism, event replay, and UI state update rules. This is the authoritative specification for the PRAXIS event-sourced UI model.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document specifies how PRAXIS runtime events flow from kernel state changes to the Desktop Mission Control display. It defines the append-only event log as source of truth, the snapshot + event replay model for UI state, the SSE streaming protocol, gap detection and recovery, and the hard rule that UI never invents state.

---

## Scope

- RuntimeEvent model and categories
- Append-only event log (in-memory for MVP-A/P2, PostgreSQL for P3+)
- Event sequence numbering (monotonic, gap detection)
- Snapshot endpoint GET /api/snapshot
- SSE event stream GET /api/events?after=<seq>
- Event replay for UI state recovery
- Gap detection and recovery (fresh snapshot + replay)
- Desktop Mission Control event application rules
- Event categories and their payload shapes
- Storage migration path (in-memory → PostgreSQL)

---

## Non-Goals

- Implementation code (this is a specification)
- Detailed Hono SSE implementation (delegated to server/control-plane implementation)
- PostgreSQL schema details (delegated to D-097, SOFT_LOCK until implementation)
- WebSocket protocol (rejected for MVP per D-025)
- Exact Zustand store structure (delegated to Desktop implementation)
- Exact TanStack Query configuration (delegated to Desktop implementation)

---

## Authoritative Decisions Used

| ID | Decision | Relevance |
|----|----------|-----------|
| D-025 | HTTP commands/queries + SSE event stream | MVP communication model; WebSocket rejected |
| D-026 / D-096 | UI state comes from snapshot + RuntimeEvent replay | UI initialization and update model |
| D-029 | UI never decides completion | Desktop renders verdicts, does not create them |
| D-065 | Desktop must render runtime state from server/client contracts | All state from API, not invented |
| D-066 | Desktop must not own truth | No completion decisions, no verdict overrides in UI |
| D-091 | Durable event log is required | Events must be persisted and recoverable |
| D-095 | runtime_events append-only log is core to replay/debugging | Source of truth for runtime state reconstruction |
| D-026 | UI state from snapshot + event replay | Specific API design |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN | CB events in event stream |
| D-092 | PostgreSQL is primary MVP storage | Event persistence in P3+ |
| -- | Bun is runtime (SOFT_LOCK) | In-memory event log uses Bun-native structures for MVP-A |

---

## Conceptual Model

PRAXIS uses event sourcing for UI state. The runtime maintains an append-only event log. Every important state change in the kernel produces a RuntimeEvent with a monotonic sequence number. Events are the source of truth for UI state -- not polling, not a database query for current values, not a WebSocket message with ephemeral state.

**Initialization:**
```
Desktop starts → GET /api/snapshot → hydrate initial UI state → connect SSE → apply events incrementally
```

**Event replay (on reconnect or gap):**
```
Desktop detects gap → GET /api/snapshot → replace UI state → connect SSE with after=snapshot.lastEventSeq
```

**Command acceptance vs state change:**
```
POST /api/runs/:id/pause → { ok: true, acceptedAt: ... }
                                        (command accepted, state NOT yet changed)
... kernel processes command ...
SSE: event: task_run.updated, data: { runId: "...", state: "PAUSED" }
                                        (state actually changed -- this is what UI renders)
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Event Flow Diagram                                  │
│                                                                             │
│  ┌──────────────┐                                                           │
│  │   Kernel     │                                                           │
│  │   Components │                                                           │
│  │              │                                                           │
│  │  FSM         │                                                           │
│  │  PSAG        │                                                           │
│  │  Evidence    │                                                           │
│  │  Truth Engine│                                                           │
│  │  RIM         │                                                           │
│  │  Governor    │                                                           │
│  │  Circuit     │                                                           │
│  │   Breaker    │                                                           │
│  │  Assembler   │                                                           │
│  └──────┬───────┘                                                           │
│         │ state change                                                       │
│         ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        EventEmitter                                  │   │
│  │                                                                      │   │
│  │  Every state change → RuntimeEvent created                           │   │
│  │  Event assigned monotonic sequence number                            │   │
│  │  Event appended to in-memory or persistent log                       │   │
│  │  Event published to internal event bus                               │   │
│  └──────────────┬───────────────────────┬───────────────────────────────┘   │
│                 │                       │                                    │
│                 ▼                       ▼                                    │
│  ┌──────────────────────┐  ┌──────────────────────────────────────────┐     │
│  │  Append-Only Event   │  │         Internal Event Bus                │     │
│  │  Log                 │  │                                          │     │
│  │                      │  │  Router distributes events to:            │     │
│  │  Source of truth     │  │  - SSE subscribers (all events)           │     │
│  │  for all UI state    │  │  - Storage persister (all events)          │     │
│  │                      │  │  - Telemetry collector (sampled events)    │     │
│  │  MVP-A/P2:           │  │  - ACCP artifact triggers (COMPLETE only) │     │
│  │    In-memory array   │  └────────────────────┬─────────────────────┘     │
│  │  P3+:                  │                       │                          │
│  │    PostgreSQL         │                       ▼                          │
│  │    runtime_events     │  ┌──────────────────────────────────────────┐     │
│  │    table              │  │           SSE Broadcast                  │     │
│  └──────────────────────┘  │                                          │     │
│                             │  GET /api/events                         │     │
│                             │  Content-Type: text/event-stream         │     │
│                             │  Connection: keep-alive                   │     │
│                             │  Last-Event-ID: <seq> support            │     │
│                             │                                          │     │
│                             │  event: task_run.updated                  │     │
│                             │  id: 1847                                 │     │
│                             │  data: {...}                              │     │
│                             │                                          │     │
│                             │  event: gate.verdict                      │     │
│                             │  id: 1848                                 │     │
│                             │  data: {...}                              │     │
│                             └────────────────────┬─────────────────────┘     │
│                                                  │                           │
│                                                  ▼                           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     Desktop Mission Control                            │   │
│  │                                                                       │   │
│  │  ┌───────────────────┐        ┌───────────────────────────────┐      │   │
│  │  │  GET /api/snapshot │        │  SSE EventSource               │      │   │
│  │  │                    │        │                               │      │   │
│  │  │  On startup:       │        │  Connect with:                │      │   │
│  │  │  Full current      │        │  GET /api/events              │      │   │
│  │  │  runtime state:    │        │                               │      │   │
│  │  │  - runtime         │        │  Apply events incrementally   │      │   │
│  │  │  - workers         │        │  in sequence order            │      │   │
│  │  │  - activeRuns      │        │                               │      │   │
│  │  │  - governor        │        │  On disconnect:               │      │   │
│  │  │  - circuitBreaker  │        │  reconnect with               │      │   │
│  │  │  - pendingHuman    │        │  after=<lastSeenSeq>          │      │   │
│  │  │    Actions         │        │                               │      │   │
│  │  │  - lastEventSeq    │        │  GAP detected?                │      │   │
│  │  │                    │        │  → fresh snapshot + replay     │      │   │
│  │  └───────────────────┘        └───────────────────────────────┘      │   │
│  │                                                                       │   │
│  │  UI renders state from events:                                        │   │
│  │  - TaskRun list/detail                                                │   │
│  │  - Worker grid                                                        │   │
│  │  - Gate verdicts                                                      │   │
│  │  - Evidence/log stream                                                │   │
│  │  - Circuit Breaker status                                             │   │
│  │  - Governor status                                                    │   │
│  │  - Human action queue                                                 │   │
│  │                                                                       │   │
│  │  NEVER: invents state, decides completion, emits completion events    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Snapshot → SSE → Replay Flow

```
Desktop Startup:
────────────────

  GET /api/snapshot ─────────────────────────────────────────────────► Server
                                                                        │
  ◄─────────────── { runtime, workers, activeRuns, governor,           │
                     circuitBreaker, pendingHumanActions,              │
                     lastEventSeq: 1846 }                              │
  │                                                                     │
  │ Hydrate TanStack Query cache with snapshot                          │
  │ Populate Zustand stores with snapshot data                          │
  │                                                                     │
  ▼                                                                     │
  GET /api/events?after=1846 ─────────────────────────────────────────► Server
                                                                        │
  ◄─────────────── SSE stream                                          │
  │                event: task_run.updated   id: 1847                  │
  │                event: worker.updated     id: 1848                  │
  │                event: gate.verdict       id: 1849                  │
  │                event: evidence.appended  id: 1850                  │
  │                event: circuit_breaker.opened id: 1851              │
  │                ...                                                 │
  │                                                                     │
  │ For each event:                                                     │
  │   1. Validate payload with Zod                                       │
  │   2. Check sequence order (seq == lastSeenSeq + 1)                   │
  │   3. Apply to Zustand store                                          │
  │   4. Invalidate relevant TanStack Query cache tags                   │
  │   5. Update lastSeenSeq                                              │
  │                                                                     │
  ▼                                                                     │
  UI re-renders affected components

On Disconnect:
─────────────

  EventSource fires 'error' event
  │
  ├─ Wait (exponential backoff: 1s, 2s, 4s, 8s, max 30s)
  │
  ├─ Reconnect: GET /api/events?after=<lastSeenSeq>
  │
  └─ If connection succeeds:
       Resume applying events from lastSeenSeq+1

On Gap Detection:
───────────────

  Event arrives with seq = N
  lastSeenSeq = N - 2  (gap: seq N-1 is missing)

  Response:
    1. Close SSE connection
    2. GET /api/snapshot (gets fresh state at current seq)
    3. Replace all UI state with snapshot data
    4. Connect SSE with after=snapshot.lastEventSeq
    5. Resume event application

  This ensures UI never operates on incomplete state.
```

---

## Component Responsibilities

### Server / Event Bus (server/event-bus)

- Owns the EventEmitter that creates RuntimeEvents
- Assigns monotonic sequence numbers
- Appends events to the log (in-memory array in MVP-A/P2, PostgreSQL in P3+)
- Publishes events to internal subscribers (SSE, storage, telemetry)
- Provides event query: `getEventsAfter(seq: number): RuntimeEvent[]`

### Server / Control Plane SSE (server/control-plane/sse)

- Handles GET /api/events?after=<seq> requests
- Sets up SSE stream: Content-Type text/event-stream, Connection keep-alive
- Streams events from internal event bus to connected clients
- Supports Last-Event-ID for automatic reconnect
- Sends periodic heartbeat (comment line) to keep connection alive
- Detects client disconnect and cleans up subscription

### Server / Control Plane Snapshot (server/control-plane/routes/snapshot)

- Handles GET /api/snapshot requests
- Returns complete current runtime state snapshot
- Includes lastEventSeq for the client to use in subsequent SSE connection
- Snapshot must be internally consistent (point-in-time)
- Snapshot shape:
  ```
  {
    runtime: { status, version, startedAt },
    workers: [ { workerId, kind, status, assignedRunId, ... } ],
    activeRuns: [ { runId, wave, state, attempt, namespace, ... } ],
    governor: { tier, activeWorkers, maxWorkers, cleanWindowHours },
    circuitBreaker: { state, openedAt, openedReason, lastTransitionSeq, probeRunId },
    pendingHumanActions: [ { hirId, runId, type, description, createdAt, ... } ],
    lastEventSeq: number
  }
  ```

### Server / Storage (server/storage)

- In MVP-A/P2: in-memory event log (array of RuntimeEvent objects)
- In P3+: PostgreSQL runtime_events table (append-only, BIGSERIAL seq column)
- Provides event persistence and query
- Survivability: on restart in P3+, events are loaded from PostgreSQL
- Migration from in-memory to PostgreSQL is transparent to kernel and UI

### Interface / Client (interface/client)

- Typed HTTP client for snapshot query
- Typed SSE client for event stream
- Handles EventSource lifecycle: connect, reconnect, error handling
- Validates all payloads with Zod schemas
- Exposes snapshot() and connectEvents(afterSeq) functions
- Manages reconnect with exponential backoff
- Detects sequence gaps and triggers snapshot refresh

### Interface / Desktop (interface/desktop)

- On startup: calls snapshot(), hydrates stores, connects SSE
- On each event: validates, applies to Zustand store, invalidates TanStack cache
- On gap: requests fresh snapshot, replaces store state, reconnects SSE
- NEVER invents state based on command acceptance
- NEVER creates completion events or overrides gate verdicts
- Displays "Event stream disconnected" indicator when SSE drops
- Displays "Stale data -- reconnecting" indicator on gap detection

---

## RuntimeEvent Categories

### Event Sequence and Categories

Every RuntimeEvent has:
```
{
  seq: number,         // Monotonic sequence number (1, 2, 3, ...)
  type: string,        // Dot-separated event category (e.g., "task_run.updated")
  aggregateType: string | null,  // Aggregate type for grouping (e.g., "task_run")
  aggregateId: string | null,    // Aggregate ID for filtering (e.g., "run_01J...")
  payload: object,     // Event-specific payload
  timestamp: string,   // ISO 8601 with timezone
}
```

### Event Categories

| Category | Type String | Emitted When | Payload Highlights |
|----------|------------|--------------|-------------------|
| **Task Run** | `task_run.updated` | TaskRun state changes (any transition) | runId, previousState, newState, attempt, transitionTrigger |
| **Task Run** | `task_run.created` | New TaskRun created from PlanSpec | runId, wave, taskType, namespace, budget |
| **Worker** | `worker.updated` | Worker status changes | workerId, kind, status, assignedRunId |
| **Worker** | `worker.registered` | Worker adapter registered with runtime | workerId, kind, capabilities |
| **Gate** | `gate.verdict` | Any gate produces verdict | runId, attemptId, gate (EvidenceGate/ExecGate/FinalGate), verdict (PASS/HOLD/FAIL/ERROR), verdictDetail |
| **Evidence** | `evidence.appended` | Evidence record added to chain | attemptId, recordId, source, kind, contentHash |
| **Evidence** | `evidence.ehc_break` | EHC integrity break detected | attemptId, classification (NOISE/SUSPECTED/CONFIRMED), breakDetail |
| **Transcript** | `transcript.chunk` | New transcript chunk from worker | attemptId, stream (stdout/stderr), chunk, index |
| **Circuit Breaker** | `circuit_breaker.opened` | CB transitions to OPEN | state, previousState, reason, diagnosticSnapshot |
| **Circuit Breaker** | `circuit_breaker.closed` | CB transitions to CLOSED | state, previousState, reason |
| **Circuit Breaker** | `circuit_breaker.half_opened` | CB transitions to HALF_OPEN | state, previousState, reason |
| **Circuit Breaker** | `circuit_breaker.probe_started` | Probe attempt begins | probeRunId, state |
| **Circuit Breaker** | `circuit_breaker.probe_passed` | Probe attempt passes | probeRunId, verdict |
| **Circuit Breaker** | `circuit_breaker.probe_failed` | Probe attempt fails | probeRunId, verdict |
| **Governor** | `governor.updated` | Governor tier/state changes | previousTier, newTier, activeWorkers, maxWorkers, reason |
| **Human Action** | `human_action.created` | HIR request created | hirId, runId, type, description, priority |
| **Human Action** | `human_action.resolved` | HIR request resolved | hirId, resolution, resolvedBy |
| **Plan** | `plan.admitted` | PlanSpec passes PSAG | planId, taskRunCount, waves |
| **Plan** | `plan.rejected` | PlanSpec rejected by PSAG | planId, reasonCode, diagnostics |
| **Assembly** | `assembly.started` | Wave assembly begins | wave, taskRunIds |
| **Assembly** | `assembly.completed` | Wave assembly succeeds | wave, appliedPatches |
| **Assembly** | `assembly.conflict` | Wave assembly conflict detected | wave, conflictReportId, affectedRunIds |
| **Runtime** | `runtime.started` | Runtime server starts | version, config |
| **Runtime** | `runtime.stopping` | Runtime server shutting down | reason |
| **Attempt** | `attempt.created` | New repair/retry attempt begins | runId, attemptNumber, strategy, repairPacketId |

### Sequence Number Rules

- Sequence numbers are strictly monotonic: 1, 2, 3, 4, ...
- No gaps in the server-side log. If the server creates a gap, it is a bug.
- Client-side: gaps can occur due to SSE disconnection or network issues.
- Client gap detection: when an event arrives with seq > lastSeenSeq + 1.
- Server-side gap recovery: the server keeps all events from seq 1 in the log (subject to retention policy in P6+).

---

## Snapshot Specification

### Endpoint

```
GET /api/snapshot
Authorization: Bearer <token>
```

### Response Shape

```typescript
interface RuntimeSnapshot {
  runtime: {
    status: 'starting' | 'running' | 'stopping' | 'error';
    version: string;
    startedAt: string;    // ISO 8601
  };

  workers: Array<{
    workerId: string;
    kind: string;         // 'claude-code' | 'opencode' | 'local-model' | 'mock-worker'
    status: 'idle' | 'busy' | 'error' | 'offline';
    assignedRunId: string | null;
    lastHealthCheck: string;
  }>;

  activeRuns: Array<{
    runId: string;
    planId: string;
    wave: number;
    state: string;        // QUEUED | WORKSPACE_INIT | RUNNING | CAPTURING | VERIFYING | REPAIR | PAUSED
    attempt: number;
    namespace: string[];
    taskType: string;
    assignedWorkerId: string | null;
    currentGate: string | null;
    lastVerdict: string | null;
    createdAt: string;
    updatedAt: string;
  }>;

  governor: {
    tier: string;          // 'stable_3' | 'stable_6' | 'stable_8' | 'stable_12' | 'stable_16'
    activeWorkers: number;
    maxWorkers: number;
    cleanWindowHours: number;
    demotionRisk: 'none' | 'low' | 'medium' | 'high';
  };

  circuitBreaker: {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    openedAt: string | null;
    openedReason: string | null;
    lastTransitionSeq: number;
    probeRunId: string | null;
  };

  pendingHumanActions: Array<{
    hirId: string;
    runId: string;
    type: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    createdAt: string;
  }>;

  lastEventSeq: number;
}
```

### Snapshot Rules

- Snapshot must be a point-in-time consistent view. All data within a single snapshot response must reflect the same event sequence moment.
- Snapshot is read-only. It does not modify system state.
- Snapshot is the bootstrap for UI state. Desktop starts with snapshot, then applies events.
- On gap detection, desktop requests a fresh snapshot and replaces all local state.
- Snapshot includes `lastEventSeq` so desktop knows where to resume the SSE stream.

---

## SSE Stream Specification

### Endpoint

```
GET /api/events?after=<seq>
Authorization: Bearer <token>
Accept: text/event-stream
```

### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `after` | No | Sequence number to start after. If omitted, starts from event seq 1. |

### Response Headers

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### Event Format

```
event: <event_type>
id: <seq>
data: <json_payload>

```

Fields:
- `event`: the event type string (e.g., `task_run.updated`)
- `id`: the monotonic sequence number (used by EventSource for Last-Event-ID)
- `data`: JSON payload specific to the event type

Example:
```
event: task_run.updated
id: 1847
data: {"runId":"run_01J9X...","previousState":"RUNNING","newState":"CAPTURING","attempt":1,"transitionTrigger":"worker_exit","timestamp":"2026-06-18T14:22:00.000Z"}

event: evidence.appended
id: 1848
data: {"attemptId":"att_01J9Y...","recordId":"ev_01J9Z...","source":"git","kind":"diff","contentHash":"sha256:abc123...","timestamp":"2026-06-18T14:22:01.000Z"}

event: gate.verdict
id: 1849
data: {"runId":"run_01J9X...","attemptId":"att_01J9Y...","gate":"EvidenceGate","verdict":"PASS","verdictDetail":"diff non-empty, 3 files changed inside namespace","timestamp":"2026-06-18T14:22:05.000Z"}
```

### Heartbeat

Server sends periodic SSE comments to keep the connection alive:

```
: heartbeat

```

Heartbeat interval: 15 seconds (configurable). Comment lines are ignored by EventSource and do not carry a sequence number.

### Client-Side EventSource Usage

The interface/client package wraps the native EventSource:

```typescript
// Conceptual -- not implementation code
function connectEvents(afterSeq: number) {
  const url = `${baseUrl}/api/events?after=${afterSeq}`;
  const source = new EventSource(url);

  source.addEventListener('task_run.updated', handleTaskRunUpdated);
  source.addEventListener('worker.updated', handleWorkerUpdated);
  source.addEventListener('gate.verdict', handleGateVerdict);
  source.addEventListener('evidence.appended', handleEvidenceAppended);
  source.addEventListener('transcript.chunk', handleTranscriptChunk);
  source.addEventListener('circuit_breaker.opened', handleCbOpened);
  source.addEventListener('circuit_breaker.closed', handleCbClosed);
  source.addEventListener('circuit_breaker.half_opened', handleCbHalfOpened);
  source.addEventListener('circuit_breaker.probe_started', handleCbProbeStarted);
  source.addEventListener('circuit_breaker.probe_passed', handleCbProbePassed);
  source.addEventListener('circuit_breaker.probe_failed', handleCbProbeFailed);
  source.addEventListener('governor.updated', handleGovernorUpdated);
  source.addEventListener('human_action.created', handleHirCreated);
  source.addEventListener('human_action.resolved', handleHirResolved);
  // ... other event types

  source.addEventListener('error', handleSseError);
  return source;
}
```

---

## Gap Detection and Recovery

### Detection

The desktop client maintains `lastSeenSeq: number`. For each incoming event:

```
if (event.seq !== lastSeenSeq + 1) {
  // GAP DETECTED
  triggerSnapshotRefresh();
}
```

Gaps can occur because:
- SSE connection dropped and reconnected, missing events in between
- Server-side event log retention pruned events before client resumed (P6+ concern)
- Memory pressure caused client to drop events (unlikely but handled)

### Recovery

```
triggerSnapshotRefresh():
  1. Close current SSE connection
  2. GET /api/snapshot
  3. Replace ALL local state (Zustand stores, TanStack Query cache) with snapshot data
  4. Set lastSeenSeq = snapshot.lastEventSeq
  5. Open new SSE connection: GET /api/events?after=<lastSeenSeq>
  6. Resume applying events
```

This recovery model is simple and safe: throw away potentially incomplete incremental state and start fresh from a consistent point. The cost is a full snapshot refresh, which is acceptable because snapshots are local (127.0.0.1) and fast.

---

## MUST / MUST NOT Rules

### MUST

- Every important state change MUST produce a RuntimeEvent with a monotonic sequence number
- The event log MUST be append-only (events are never modified or deleted)
- The server MUST return a point-in-time consistent snapshot from GET /api/snapshot
- The server MUST include `lastEventSeq` in every snapshot response
- The server MUST stream events with correct `id` field for EventSource Last-Event-ID support
- The client MUST hydrate initial UI state from snapshot, not from empty defaults
- The client MUST detect sequence gaps and trigger snapshot refresh
- The client MUST apply events in strict sequence order
- SSE streams MUST send periodic heartbeats to keep connections alive
- All event payloads MUST be validated (server on emission, client on receipt) against Zod schemas

### MUST NOT

- The UI MUST NOT invent state based on HTTP command responses (command accepted != state changed)
- The UI MUST NOT create completion events or override gate verdicts
- The UI MUST NOT modify event data or create synthetic events
- The server MUST NOT use WebSocket for real-time events in MVP (D-025)
- The event log MUST NOT be modified after append (no UPDATE, no DELETE on runtime_events)
- RuntimeEvents MUST NOT be deleted to "clean up" stale data (retention policy only via documented mechanism in P6+)
- No component outside the kernel MUST emit events that change kernel-owned state
- Worker self-report "done" MUST NOT produce a task_run.updated event with newState: "COMPLETE"

---

## Storage Migration Path

| Phase | Storage | Details |
|-------|---------|---------|
| **MVP-A (P2)** | In-memory array | `const eventLog: RuntimeEvent[] = []`. No persistence. Events lost on restart. Sufficient for mock runtime proof. |
| **MVP-B (P3)** | In-memory array (transitional) | Events lost on restart during development. Kernel safety core tested with in-memory log. |
| **P3+** | PostgreSQL runtime_events table | `CREATE TABLE runtime_events (seq BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, aggregate_type TEXT, aggregate_id TEXT, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Events durable across restarts. SSE replay from PostgreSQL. |

### Migration from In-Memory to PostgreSQL (P3)

The interface between the event emitter, SSE stream, and snapshot endpoint must be abstracted so that:

1. MVP-A/P2 uses `InMemoryEventStore` implementing `EventStore` interface
2. P3+ uses `PostgresEventStore` implementing the same `EventStore` interface
3. No kernel code changes when switching storage backends
4. No desktop code changes when switching storage backends

The `EventStore` interface (conceptual):
```
store(event: RuntimeEvent): Promise<void>
getEventsAfter(seq: number, limit?: number): Promise<RuntimeEvent[]>
getLatestSeq(): Promise<number>
```

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| SSE connection drops | EventSource 'error' event | Reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s). Reconnect uses after=<lastSeenSeq>. |
| Event sequence gap | Client detects seq > lastSeenSeq + 1 | Close SSE, request fresh snapshot, replace all state, reconnect SSE from snapshot.lastEventSeq. |
| Server restart (P2, in-memory) | All event data lost | Client must reconnect. Server starts from seq 0. Client gets fresh snapshot with lastEventSeq=0. All prior event replay lost but UI shows current state correctly. |
| Server restart (P3+, PostgreSQL) | No data loss | SSE connection drops. Client reconnects with after=<lastSeenSeq>. Server replays from PostgreSQL. No gap. |
| Snapshot endpoint fails | HTTP error from GET /api/snapshot | Client retries with exponential backoff. UI shows "disconnected" state. |
| Invalid event payload (client-side) | Zod validation fails on event payload | Log validation error. Skip event. Do not crash. Continue processing next events. Gap detection will eventually trigger snapshot refresh and fix inconsistency. |
| SSE stream stalls (no events for > expected interval) | Heartbeat timeout (no comment for > 30s) | Client treats as disconnection. Reconnect. |
| Event log memory pressure (MVP-A/P2) | In-memory array exceeds size threshold | Log warning. In MVP-A (mock), event count is small. In MVP-B (single worker), acceptable. P3+ PostgreSQL eliminates this concern. |

---

## Test / Gate Implications

| Test Category | Specific Tests |
|---------------|---------------|
| Snapshot consistency | Snapshot returns all runtime fields. Snapshot.lastEventSeq is correct. Two snapshots taken without events between them return identical data (except lastEventSeq). |
| SSE streaming | Events arrive in sequence order. No gaps in stream. Heartbeat comments received at expected interval. |
| SSE reconnect | EventSource reconnects after disconnect. Resume from after=lastSeenSeq returns correct events without duplication or gaps. |
| Gap detection | Client detects seq jump > 1. Triggers snapshot refresh. Fresh snapshot + replay yields correct state. |
| Event categories | All event types emitted correctly. All payloads match expected shape. |
| UI state from events | Desktop renders state changes after receiving events. Desktop does not render state before events arrive. |
| UI does not invent | Desktop does not change worker status or run state based on HTTP POST response. Desktop waits for SSE event. |
| Command acceptance vs change | POST returns ok but state NOT changed. SSE event arrives later with actual state change. Client handles both correctly. |
| Multiple clients | Two desktop instances connected. Both receive same SSE events. Both render same state. |
| Circuit Breaker events | circuit_breaker.opened, .closed, .half_opened, .probe_* events all streamed correctly. Desktop shows correct CB state. |
| Event persistence (P3+) | Server restart. Events replayed from PostgreSQL. Client reconnects with no data loss. |
| Event immutability | Attempting to modify or delete a persisted event fails (append-only constraint enforced). |

---

## Decision Compliance Checklist

- [x] HTTP commands/queries + SSE event stream (D-025)
- [x] UI state from snapshot + RuntimeEvent replay (D-026, D-096)
- [x] UI never decides completion (D-029)
- [x] Desktop renders runtime state from server/client contracts (D-065)
- [x] Desktop must not own truth (D-066)
- [x] Durable event log is required (D-091)
- [x] runtime_events append-only log is core to replay/debugging (D-095)
- [x] WebSocket rejected for MVP (D-025)
- [x] Snapshot includes Circuit Breaker state (D-085)
- [x] Every state change produces a RuntimeEvent (D-095)
- [x] Event sequence numbers are monotonic
- [x] Gap detection triggers snapshot refresh (D-026)
- [x] Desktop applies events incrementally but does not invent state (D-066)
- [x] No UI-owned truth (D-029)
- [x] No UI-originated completion events (D-029)
- [x] PostgreSQL storage for P3+ (D-092)

---

## Open Questions

| ID | Question | Relevance |
|----|----------|-----------|
| Q1 | Should the snapshot endpoint be paginated for scalability, or is the full response small enough for local-only use? For P2 (mock), full is fine. For P6 (production), consider pagination or filtering. | Snapshot design |
| Q2 | What is the maximum event log size in MVP-A/P2 before in-memory becomes problematic? With one mock worker, events are few. With real Claude worker, estimate 200-500 events per attempt. | P2 implementation |
| Q3 | Should the client apply events as React state updates (batching for performance) or apply each event individually? Batching multiple events per render frame improves performance but adds complexity. | Desktop implementation |
| Q4 | How does the client distinguish between "event I've already applied" and "genuinely new event" on reconnect? EventSource Last-Event-ID + after=seq handles this, but edge cases with exact seq boundaries need testing. | SSE client |
| Q5 | Should transcript chunks be streamed as separate SSE events or compressed/batched? For real-time display, individual chunks. For efficiency, batch small chunks. | Transcript streaming |
| Q6 | What is the retention policy for runtime_events in P6+? Keep all events forever? Prune after FVR generated? Archive to separate table? | P6 production hardening |
| Q7 | Should the snapshot include a hash/checksum of the current event log for integrity verification? Not required for MVP but worth considering for production auditability. | Snapshots/auditability |

---

## Audit Notes

- WebSocket is explicitly rejected for MVP per D-025. All real-time communication uses SSE. This document does not describe or design a WebSocket protocol.
- The in-memory → PostgreSQL migration path is defined to make the transition from P2 (mock) to P3+ (real) transparent to kernel and UI code. The EventStore abstraction is the key enabler.
- UI never invents state is stated in multiple places to reinforce D-029, D-065, D-066. The command-acceptance vs state-change distinction (POST returns ok, SSE event confirms change) is a critical implementation detail that must survive through all layers.
- Worker self-report routing rule: worker claims "done" → captured as evidence → EvidenceGate evaluates → if no actual changes, HOLD. The worker self-report event (an adapter-level report) is NOT a RuntimeEvent. Only kernel state changes produce RuntimeEvents.
- All event sequence numbers are server-assigned. The client never assigns or modifies sequence numbers.
- Heartbeat comments (SSE comment lines) do not carry sequence numbers and do not increment the lastEventSeq counter.
- The document was written against `docs/decisions.md` as the canonical source. Any conflict is resolved in favor of decisions.md.
