# Runtime / Server / Kernel Boundary

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** docs/decisions.md
**Purpose:** Define the hard boundary between the PRAXIS server layer and the kernel layer: what each owns, what each must never do, and how they communicate through typed contracts.

> This document must not override docs/decisions.md. If there is a conflict, docs/decisions.md wins.

---

## Purpose

PRAXIS is split into a pure kernel and a concrete server. The kernel owns domain logic and safety authority. The server owns runtime composition, I/O, and wiring. This document draws the line between them so that no implementation drifts across the boundary.

## Scope

- Kernel-owned responsibilities and their boundaries
- Server-owned responsibilities and their boundaries
- Contract-mediated communication between server and kernel
- Dependency direction and forbidden imports
- Storage, event bus, and persistence responsibilities
- API exposure and control plane ownership

## Non-Goals

- Adapter implementation details (see `docs/boundaries/worker-adapter-boundary.md`)
- Desktop/CLI interface details (see `docs/contracts/*` and architecture.md Section 15)
- Truth Engine gate internals (see `docs/pipelines/evidence-to-truth-engine.md`)
- RIM strategy internals (see `docs/pipelines/rim-repair-loop.md`)

## Authoritative Decisions Used

| Decision ID | Summary | Status |
|-------------|---------|--------|
| D-018 | No root `src/`; top-level directories are domain boundaries | HARD_LOCK |
| D-019 | `lib/contracts` contains shared contracts only; no business logic | HARD_LOCK |
| D-020 | `kernel/` owns pure execution, domain, and safety logic | HARD_LOCK |
| D-023 | `server/` composes runtime, storage, API, event bus, and adapters | HARD_LOCK |
| D-024 | `interface/` displays runtime and kernel state only | HARD_LOCK |
| D-025 | HTTP commands/queries + SSE event stream is MVP communication model | HARD_LOCK |
| D-026 | UI state comes from snapshot + RuntimeEvent replay | HARD_LOCK |
| D-027 | Kernel must not import server/adapters/interface | HARD_LOCK |
| D-029 | UI never decides completion | HARD_LOCK |
| D-030 | Adapter never decides completion | HARD_LOCK |
| D-031 | Hook never decides truth | HARD_LOCK |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | HARD_LOCK |
| D-033 | EvidenceGate, ExecGate, FinalGate are kernel-owned | HARD_LOCK |
| D-084 | Circuit Breaker is kernel-owned | HARD_LOCK |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN | HARD_LOCK |
| D-086 | Circuit Breaker answers: is the whole system safe enough to admit work? | HARD_LOCK |
| D-087 | Governor answers: how many workers can safely run? | HARD_LOCK |
| D-088 | Truth Engine answers: is this attempt complete? | HARD_LOCK |
| D-098 | Contract-first development is mandatory | HARD_LOCK |

## Conceptual Model

### ASCII Dependency Diagram

```
                         ┌──────────────────────┐
                         │     interface/        │
                         │  (Desktop, CLI,       │
                         │   Client, UI-Core)    │
                         │                       │
                         │  Renders state.       │
                         │  Never decides truth. │
                         └──────────┬────────────┘
                                    │ HTTP commands / SSE events
                                    │ (via interface/client)
                                    ▼
┌───────────────────────────────────────────────────────────────────┐
│                          server/                                   │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ control-plane│  │ storage/     │  │ runtime/                 │ │
│  │ HTTP API     │  │ (PostgreSQL, │  │ composition root,        │ │
│  │ SSE stream   │  │  repositories)│  │ adapter registry,        │ │
│  └──────┬───────┘  └──────┬───────┘  │ event bus, telemetry     │ │
│         │                 │           └─────────┬────────────────┘ │
│         │                 │                     │                  │
│  ┌──────┴─────────────────┴─────────────────────┴──────────────────┤
│  │                         event-bus/                              │
│  │  (persisted runtime_events, SSE source of truth)                │
│  └─────────────────────────────────────────────────────────────────┘
│                                                                    │
│  Server responsibilities: compose, wire, persist, expose.          │
│  Server never: evaluates truth, decides completion, runs gates.    │
└─────────────────────┬──────────────────────────────────────────────┘
                      │ calls through typed contracts from lib/contracts
                      │ emits events that server persists
                      ▼
┌───────────────────────────────────────────────────────────────────┐
│                          kernel/                                   │
│                                                                    │
│  ┌─────┐ ┌──────┐ ┌──────────┐ ┌──────────────┐ ┌─────┐          │
│  │ FSM │ │ PSAG │ │ Evidence │ │ Truth Engine │ │ RIM │          │
│  └─────┘ └──────┘ │ + EHC    │ │ (EvidenceGate│ └─────┘          │
│                    └──────────┘ │  ExecGate    │                  │
│                                 │  FinalGate)  │                  │
│  ┌──────────────────┐ ┌────────┴──────────────┴──────────────────┤
│  │ Circuit Breaker  │ │ Governor  │ Assembler │ ACCP Compiler    │
│  │ (system safety)  │ │(concurr.) │(wave-lvl) │ (async artifacts)│
│  └──────────────────┘ └──────────┘ ┌──────────┴──────────────────┘
│                                     │                              │
│  Kernel responsibilities: domain logic, evidence, truth, safety,  │
│  repair, assembly.                                                 │
│  Kernel never: imports server, adapters, or interface.             │
│  Kernel never: opens HTTP, writes to DB, knows about Electron.     │
└────────────────────────────────────────────────────────────────────┘
```

### Dependency Direction

```
kernel ← lib/contracts ← server → adapters → external workers
  ↑                         ↑
  │                         │
  └── kernel never imports ─┘
      server, adapters, or interface
```

Kernel depends only on `lib/contracts`, `lib/errors`, `lib/result`, `lib/ids`, `lib/time`, `lib/crypto`, `lib/validation`. Kernel exports typed interfaces that the server implements for storage and provider abstractions.

Server depends on kernel (through contracts), adapters (through contracts), `lib/contracts`, storage drivers, and HTTP framework. Server composes concrete dependencies: it instantiates the adapter registry, the storage layer, the event bus, and the control plane, then wires them to the kernel.

## Data / Control Flow

### Startup Sequence

```
1. server/runtime loads config
2. server/runtime starts storage (PostgreSQL connection, migrations)
3. server/runtime creates adapter registry
4. server/runtime starts event bus
5. server/runtime instantiates kernel services (FSM, PSAG, etc.)
6. server/runtime starts control plane (Hono HTTP + SSE)
7. server/runtime recovers state from persisted events
8. interface/client connects to snapshot + SSE
```

### Command Flow

```
interface/desktop or interface/cli
  → POST /api/plans/admit (HTTP command)
    → server/control-plane validates payload with Zod
      → server/control-plane calls kernel/psag.admit(planSpec)
        → kernel/psag returns ADMIT | WARN | REJECT
      → server/control-plane calls kernel/core to create TaskRuns
        → kernel/core emits RuntimeEvent
      → server/event-bus persists RuntimeEvent
      → server/control-plane responds HTTP 200 (command accepted)
      → server/control-plane streams SSE event (state changed)
```

### Evidence Flow

```
adapters/claude-code runs worker
  → hooks/praxis-hook captures tool events → POST /api/hook-events
    → server/control-plane persists raw hook events as runtime_events
      → kernel/evidence builds EvidenceRecord chain
        → kernel/truth-engine runs EvidenceGate → ExecGate → FinalGate
          → kernel/truth-engine emits GateVerdict as RuntimeEvent
            → server/event-bus persists GateVerdict event
              → server/control-plane streams verdict via SSE
```

## Component Responsibilities

### Kernel Owns (domain logic and authorities)

| Component | Responsibility | Key Rule |
|-----------|---------------|----------|
| **FSM (kernel/core)** | TaskRun lifecycle: DORMANT → QUEUED → WORKSPACE_INIT → RUNNING → CAPTURING → VERIFYING → COMPLETE/REPAIR/FAILED/ABORTED | Only kernel changes TaskRun state |
| **PSAG (kernel/psag)** | PlanSpec admission: schema validation, namespace audit, dependency cycle check, budget check, criteria source check | Rejects `criteria_source: 'generated'` |
| **Evidence (kernel/evidence)** | EvidenceRecord construction, EHC building, hash chain verification, divergence detection, test output parsing | Evidence is raw and immutable once chained |
| **Truth Engine (kernel/truth-engine)** | EvidenceGate → ExecGate → FinalGate. Sole authority for PASS/HOLD/FAIL | No other component may produce gate verdicts |
| **RIM (kernel/rim)** | Failure signature extraction, strategy rotation, RepairPacket construction | Activates only on HOLD/FAIL |
| **Governor (kernel/governor)** | Concurrency tier management, clean operation window tracking, demotion rules | Controls how many, not whether correct |
| **Circuit Breaker (kernel/circuit-breaker)** | System-level safety: CLOSED/OPEN/HALF_OPEN, failure rate monitoring, governor RED monitoring, EHC break monitoring | Controls admission, not truth |
| **Assembler (kernel/assembler)** | Wave-level integration: namespace recheck, semantic check, atomic apply, rollback, ConflictReport | Only shared writer (Law 2) |
| **ACCP Compiler (kernel/accp)** | Async artifact generation: FVR per TaskRun, PRR per wave | Never blocks execution critical path |

### Server Owns (composition, I/O, wiring)

| Component | Responsibility | Key Rule |
|-----------|---------------|----------|
| **server/runtime** | Composition root: loads config, starts storage, creates adapter registry, instantiates kernel services, starts control plane, handles shutdown | Wires dependencies; does not own domain logic |
| **server/control-plane** | HTTP API for commands/queries, SSE event stream, payload validation with Zod | Command accepted != state changed. SSE is source of truth. |
| **server/storage** | PostgreSQL connection, migrations, repositories for all domain aggregates | Persists kernel-emitted events; does not create events |
| **server/event-bus** | Internal publish/subscribe, SSE broadcast, runtime event persistence | Every state change produces a persisted runtime_event |
| **server/telemetry** | Logging, metrics, health checks | Observability, not decision-making |

### Interface Owns (display only)

| Component | Responsibility | Key Rule |
|-----------|---------------|----------|
| **interface/client** | Typed HTTP/SSE client, Zod validation, reconnect logic | Translates API to typed objects |
| **interface/desktop** | Electron + React Mission Control: runtime state, worker grid, task runs, gate verdicts, CB/Governor status, human action queue | Renders state; never decides completion (D-029, D-066) |
| **interface/cli** | `praxis` CLI: status, runs, logs, admit | Renders state; never decides completion |

## MUST / MUST NOT Rules

### Kernel MUST

- MUST own all domain logic: FSM, PSAG, Evidence, Truth Engine, RIM, Governor, Circuit Breaker, Assembler, ACCP
- MUST define abstract ports for storage and provider interfaces
- MUST emit RuntimeEvent for every state change
- MUST produce GateVerdict through EvidenceGate, ExecGate, FinalGate in sequence
- MUST be the sole completion authority (Law 1)
- MUST be testable without server, adapters, or interface dependencies
- MUST accept storage implementations through typed interfaces defined in lib/contracts

### Kernel MUST NOT

- MUST NOT import `server/*`, `adapters/*`, or `interface/*`
- MUST NOT open HTTP ports or SSE streams
- MUST NOT write directly to PostgreSQL or any concrete storage
- MUST NOT know about Electron, React, Hono, or any UI framework
- MUST NOT know about Claude Code CLI specifics
- MUST NOT instantiate concrete adapters
- MUST NOT read config files or environment variables directly (receives config through construction)

### Server MUST

- MUST compose concrete dependencies and wire them to the kernel
- MUST persist every RuntimeEvent emitted by the kernel
- MUST expose kernel state via `GET /api/snapshot` and `GET /api/events?after=<seq>`
- MUST stream events via SSE in event source order
- MUST validate API payloads with Zod
- MUST bind to 127.0.0.1 only in MVP
- MUST manage the adapter registry (start, stop, health-check)
- MUST handle graceful shutdown: drain in-flight work, persist final events, close connections
- MUST be recoverable from persisted events after restart

### Server MUST NOT

- MUST NOT evaluate completion (Law 1)
- MUST NOT produce PASS/HOLD/FAIL verdicts
- MUST NOT evaluate evidence for truth
- MUST NOT run gates (EvidenceGate, ExecGate, FinalGate are kernel-owned)
- MUST NOT decide which repair strategy to use
- MUST NOT decide when Circuit Breaker opens or closes
- MUST NOT decide Governor tier changes
- MUST NOT modify kernel-emitted events before persistence
- MUST NOT place Truth Engine logic anywhere in `server/`
- MUST NOT circumvent the kernel for any safety decision

### Interface MUST

- MUST initialize state from `GET /api/snapshot`
- MUST apply incremental updates from SSE event stream
- MUST validate all received payloads with Zod
- MUST request snapshot refresh on sequence gap detection

### Interface MUST NOT

- MUST NOT decide completion (D-029, D-066)
- MUST NOT override gate verdicts
- MUST NOT produce or modify Truth Engine output
- MUST NOT invent state not present in snapshot or events

## Contract Boundary

### Contracts in `lib/contracts/`

The following contracts define the boundary between server and kernel:

| Contract | Purpose | Defined By | Consumed By |
|----------|---------|------------|-------------|
| `TaskSpec` | Plan task specification | kernel/psag validates | server passes to kernel |
| `PlanSpec` | Full execution plan | kernel/psag validates | server/control-plane receives |
| `AcceptanceCriterion` | Human-authored criteria | kernel/truth-engine evaluates | kernel, lib/contracts |
| `WorkerAdapter` | Worker abstraction | `lib/contracts` | kernel (abstract), adapters (implement) |
| `RunAttemptInput` | What to run | `lib/contracts` | kernel sends, adapters receive |
| `RunAttemptResult` | Normalized worker output | `lib/contracts` | adapters produce, kernel/evidence consumes |
| `RuntimeEvent` | Persisted state change | `lib/contracts` | kernel emits, server persists |
| `RuntimeSnapshot` | Full state at point in time | `lib/contracts` | server produces, interface consumes |
| `EvidenceRecord` | Tamper-evident evidence | kernel/evidence builds | kernel/truth-engine consumes |
| `GateVerdict` | PASS/HOLD/FAIL + reason codes | kernel/truth-engine produces | kernel/core routes, server streams |
| `CircuitBreakerState` | CLOSED/OPEN/HALF_OPEN | kernel/circuit-breaker owns | server exposes, interface displays |
| `GovernorState` | GREEN/YELLOW/RED + tier | kernel/governor owns | server exposes, interface displays |
| `RepairPacket` | Repair instructions | kernel/rim builds | adapters receive |
| `ConflictReport` | Assembler conflict | kernel/assembler produces | server persists, interface displays |

### Storage Interface

Kernel defines a storage interface in `lib/contracts` that server/storage implements:

```
interface RuntimeEventStore {
  append(event: RuntimeEvent): Promise<void>;
  getEventsAfter(seq: number, limit?: number): Promise<RuntimeEvent[]>;
  getLatestSeq(): Promise<number>;
}

interface EvidenceStore {
  storeRecord(record: EvidenceRecord): Promise<void>;
  getRecordsByAttempt(attemptId: string): Promise<EvidenceRecord[]>;
  verifyChain(attemptId: string): Promise<EHCIntegrityResult>;
}
```

The kernel calls these interfaces but does not know they are backed by PostgreSQL. The server provides the concrete implementation at construction time.

## Failure Modes

### Kernel Cannot Persist Events

If the kernel calls `RuntimeEventStore.append()` and the call fails (e.g., database down), the server must:
1. Buffer events in memory until storage recovers
2. Reject new admissions while storage is unavailable
3. Not emit completion events until events are durably stored
4. Signal storage failure to health endpoint

### Server Attempts to Bypass Kernel

If server code attempts to produce a GateVerdict or change TaskRun state directly, this MUST be caught by:
- Boundary checker (import restriction)
- Code review (Three Laws compliance)
- Test assertions (no gate verdicts originating outside kernel)

### Kernel Imports Server

If kernel code imports from `server/`, the build MUST fail. The boundary checker in CI MUST enforce this.

## Test / Gate Implications

- **Contract validation tests**: Verify that server can provide all interfaces kernel requires
- **Boundary import tests**: Verify no kernel file imports from server, adapters, or interface
- **Event persistence tests**: Verify events emitted by kernel are persisted and recoverable
- **SSE replay tests**: Verify events can be replayed from storage after reconnect
- **Snapshot consistency tests**: Verify snapshot data matches event-sourced state
- **Server unavailability tests**: Verify kernel does not crash when storage is down
- **Recovery tests**: Verify runtime can restart and recover full state from persisted events

## Decision Compliance Checklist

| Check | Decision Ref | Status |
|-------|-------------|--------|
| Kernel owns FSM, PSAG, Evidence, Truth Engine | D-020, D-032, D-033 | COMPLIANT |
| Kernel does not import server/adapters/interface | D-027 | COMPLIANT |
| Server composes concrete dependencies | D-023 | COMPLIANT |
| Server does not decide completion | D-029, D-030, D-032 | COMPLIANT |
| Interface does not decide completion | D-024, D-029, D-066 | COMPLIANT |
| Truth Engine is kernel-owned | D-032, D-033 | COMPLIANT |
| Circuit Breaker is kernel-owned | D-084 | COMPLIANT |
| Governor is kernel-owned | D-020, D-083, D-087 | COMPLIANT |
| Contracts define shared types only | D-019, D-098 | COMPLIANT |
| Plan admission checks criteria source | D-036, D-035 | COMPLIANT |
| Agent-generated criteria are rejected | D-035 | COMPLIANT |
| UI state from snapshot + event replay | D-026, D-096 | COMPLIANT |

## Open Questions

1. **Storage interface granularity**: Should the kernel define a single `StorageProvider` or separate interfaces for events, evidence, plans, and task runs? Separate interfaces are preferred for testability.
2. **Circuit Breaker event persistence ordering**: When CB opens, events that were in-flight must be persisted. Does this require a transactional write across CB state change + event log?
3. **Server-side event buffering**: What is the maximum buffer size for events when storage is unavailable? Should older events be dropped or should the system block?
4. **Kernel initialization contract**: What precise shape does the kernel construction interface take? Should it be a single `KernelConfig` object or factory methods per subsystem?

## Audit Notes

- This document aligns with architecture.md Sections 4 (Layer Responsibilities), 6 (Dependency Direction), and 14 (Server Architecture).
- The dependency direction `kernel ← lib/contracts ← server → adapters` is the single most important architectural constraint. Any violation destabilizes the entire safety model.
- Server ownership of event persistence means the server is the durability boundary. If the server crashes before persisting a kernel-emitted event, that event is lost. The kernel must be able to re-emit recoverable events (idempotent event emission).
- The kernel MUST NOT accept `RuntimeEventStore` as an optional dependency. Persistence is mandatory for auditability.
