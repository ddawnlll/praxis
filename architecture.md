# PRAXIS Architecture

**Version:** 0.2  
**Status:** Draft architecture baseline  
**Audience:** AI coding agents, maintainers, runtime implementers  
**Primary goal:** Make the repository understandable, navigable, and safely extensible by humans and AI agents.

---

## 0. Executive Summary

PRAXIS is a local-first execution platform for autonomous AI coding workers.

Its central promise is simple:

> Agent claims are not completion. Kernel-verified evidence is completion.

PRAXIS runs coding workers such as Claude Code, OpenCode, or local model workers against isolated workspaces, captures what they actually did, verifies their outputs through deterministic gates, repairs failed attempts with structured strategies, and assembles verified patches safely.

This repository is organized around hard architectural boundaries:

```txt
praxis/
├─ kernel/      # pure PRAXIS execution brain (FSM, PSAG, Evidence, Truth Engine, RIM, Governor, Circuit Breaker, Assembler, ACCP)
├─ adapters/    # external worker integrations: Claude Code, OpenCode, local models
├─ hooks/       # hook binaries called from external tools, especially Claude Code
├─ server/      # local runtime server, control plane, storage, events, telemetry
├─ interface/   # human-facing clients: CLI, desktop UI, typed client, UI core
├─ lib/         # shared contracts and utility foundation
├─ tests/       # cross-package tests and e2e suites
├─ examples/    # example plans, TaskSpecs, fixture repos
├─ docs/        # architecture, ADRs, specs, roadmap
└─ scripts/     # repo automation
```

The important correction is that **adapters are not inside the kernel**.

The kernel defines what a worker is allowed to do and how its output is verified.  
Adapters connect PRAXIS to concrete external tools such as Claude Code.  
Hooks capture the external tool's actual execution events.  
The server exposes the kernel as a local runtime process.  
The interface layer renders the system to humans.

---

## 1. Core Product Model

PRAXIS is not just a desktop app.

PRAXIS is a local runtime system with multiple interfaces:

```txt
┌─────────────────────────────────────────────────────────────┐
│                      Human Interfaces                       │
│                                                             │
│  CLI                    Desktop UI               Future Web │
│  praxis status          Electron/React UI        Optional   │
└───────────────┬───────────────────────┬─────────────────────┘
                │                       │
                │ HTTP commands         │ HTTP commands
                │ SSE events            │ SSE events
                ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  PRAXIS Local Runtime Server                │
│                                                             │
│  127.0.0.1 only · auth token · HTTP API · SSE event stream  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                         Kernel                              │
│                                                             │
│  FSM · PSAG · Evidence · Truth Engine · RIM · Governor      │
│  Circuit Breaker · Deterministic Assembler · ACCP artifact  │
│  compiler                                                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                         Adapters                            │
│                                                             │
│  Claude Code · OpenCode · Local Model · Mock Worker         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Worker Process                  │
│                                                             │
│  Claude Code / OpenCode / local inference process           │
└─────────────────────────────────────────────────────────────┘
```

The runtime process used to be called a daemon in earlier discussions. In this architecture we avoid the term `daemon` in source-tree names because it is confusing.

Use these names instead:

```txt
runtime server  ✅
local runtime   ✅
kernel process  ✅
daemon          ❌ avoid in folder names
```

---

## 2. Non-Negotiable Laws

These laws define the architecture. Any code that violates them is wrong even if tests pass.

### LAW 1 — Completion Authority

```txt
Agent says done ≠ done.
Truth Engine FinalGate PASS = done.
Nothing else counts.
```

A worker may claim completion. The UI may display that claim as unverified text. But no task is complete until the kernel verifies it.

### LAW 2 — Write Authority

```txt
No worker writes to a shared integration file.
The Deterministic Assembler is the only shared writer.
```

Workers operate inside declared namespaces and isolated worktrees. Wave-level integration is performed by the assembler, not by arbitrary worker output.

### LAW 3 — Verification Authority

```txt
An agent cannot define its own completion criteria.
FinalGate acceptance criteria come from human-authored TaskSpec only.
```

Acceptance criteria must be present before execution begins. A worker-generated checklist is not trusted.

---

## 3. Repository Layout

### 3.1 Final Top-Level Layout

```txt
praxis/
├─ kernel/
│  ├─ core/
│  ├─ psag/
│  ├─ evidence/
│  ├─ truth-engine/
│  ├─ rim/
│  ├─ governor/
│  ├─ circuit-breaker/
│  ├─ assembler/
│  └─ accp/
│
├─ adapters/
│  ├─ claude-code/
│  ├─ opencode/
│  ├─ local-model/
│  ├─ mock-worker/
│  └─ adapter-testkit/
│
├─ hooks/
│  └─ praxis-hook/
│
├─ server/
│  ├─ runtime/
│  ├─ control-plane/
│  ├─ storage/
│  ├─ event-bus/
│  └─ telemetry/
│
├─ interface/
│  ├─ cli/
│  ├─ desktop/
│  ├─ client/
│  └─ ui-core/
│
├─ lib/
│  ├─ contracts/
│  ├─ config/
│  ├─ logger/
│  ├─ errors/
│  ├─ result/
│  ├─ ids/
│  ├─ time/
│  ├─ fs/
│  ├─ process/
│  ├─ crypto/
│  └─ validation/
│
├─ tests/
│  ├─ integration/
│  ├─ e2e/
│  ├─ false-done/
│  ├─ evidence-chain/
│  ├─ assembler/
│  └─ fixtures/
│
├─ examples/
│  ├─ plans/
│  ├─ task-specs/
│  └─ repos/
│
├─ docs/
│  ├─ architecture/
│  ├─ adr/
│  ├─ specs/
│  └─ roadmap/
│
├─ scripts/
├─ package.json
├─ bun.lockb
├─ tsconfig.base.json
└─ README.md
```

### 3.2 No Root `src/`

Do not create:

```txt
praxis/src/
```

Each package owns its own `src/`.

Correct pattern:

```txt
kernel/core/src/
server/runtime/src/
interface/desktop/src/
adapters/claude-code/src/
lib/contracts/src/
```

Reason: PRAXIS is not one app. It is a runtime platform. A root `src/` becomes a dumping ground and destroys boundaries.

---

## 4. Layer Responsibilities

### 4.1 `lib/` — Shared Foundation

`lib/` contains shared contracts and generic utilities.

It must not contain PRAXIS business logic.

Allowed:

```txt
contracts
config
logger
errors
result
ids
time
fs helpers
process helpers
crypto primitives
validation helpers
testkit helpers
```

Forbidden:

```txt
Truth Engine logic
EvidenceGate / ExecGate / FinalGate implementation
PSAG admission logic
RIM strategy rotation
Assembler workflow
Claude Code execution logic
Control Plane route handlers
Desktop screens
Runtime server lifecycle
Storage repositories with domain behavior
```

Dependency rule:

```txt
lib/* must not import kernel/*, server/*, interface/*, adapters/*, hooks/*.
```

### 4.2 `kernel/` — Execution Brain

`kernel/` contains pure PRAXIS domain logic.

The kernel owns:

```txt
Plan admission
Task lifecycle
TaskRun FSM
Evidence interpretation
Truth verification
Repair strategy selection
Concurrency governance
System-level safety guard
Wave assembly
ACCP artifact compilation
```

The kernel must not know about Electron, HTTP, React, PostgreSQL details, or Claude-specific CLI details.

The kernel may depend on:

```txt
lib/contracts
lib/errors
lib/result
lib/ids
lib/time
lib/crypto
lib/validation
```

The kernel should define abstract ports where needed, not import concrete infrastructure.

### 4.3 `adapters/` — External Worker Integrations

`adapters/` contains concrete integrations with external coding workers.

Examples:

```txt
adapters/claude-code/
adapters/opencode/
adapters/local-model/
adapters/mock-worker/
```

The Claude Code adapter lives here:

```txt
adapters/claude-code/
```

It does not live in the kernel.

The adapter layer is responsible for:

```txt
Starting external worker processes
Building prompts
Preparing environment variables
Injecting hook config
Managing worker lifecycle
Normalizing adapter result
Detecting rate limits and process crashes
Returning structured RunAttemptResult objects
```

The adapter is not responsible for:

```txt
Deciding whether task is complete
Evaluating acceptance criteria
Building EHC
Performing FinalGate verification
Assembling patches
Persisting runtime events directly
```

### 4.4 `hooks/` — External Tool Event Capture

`hooks/` contains binaries called by external tools.

The main hook package is:

```txt
hooks/praxis-hook/
```

`praxis-hook` is called by Claude Code hook config on events such as:

```txt
PreToolUse
PostToolUse
Stop
```

It captures raw tool events and sends them to the runtime server.

It must be tiny, robust, and safe.

### 4.5 `server/` — Local Runtime Server

`server/` wraps the kernel in a local cross-platform runtime process.

It owns:

```txt
Runtime lifecycle
HTTP command/query API
SSE event stream
PostgreSQL repositories
Internal event bus
Telemetry
Adapter registry
Security token for local clients
```

It should bind to:

```txt
127.0.0.1 only
```

It should not expose a public internet service by default.

### 4.6 `interface/` — Human-Facing Clients

`interface/` contains CLI, desktop UI, typed API client, and shared UI components.

```txt
interface/cli/      # praxis binary
interface/desktop/  # Electron + React desktop app
interface/client/   # typed HTTP/SSE client
interface/ui-core/  # shared UI components and display primitives
```

The interface layer must not decide completion. It only displays kernel state.

---

## 5. Package Naming

Use scoped packages:

```txt
@praxis/contracts
@praxis/config
@praxis/logger
@praxis/errors
@praxis/result
@praxis/ids
@praxis/time
@praxis/fs
@praxis/process
@praxis/crypto
@praxis/validation

@praxis/kernel-core
@praxis/psag
@praxis/evidence
@praxis/truth-engine
@praxis/rim
@praxis/governor
@praxis/circuit-breaker
@praxis/assembler
@praxis/accp

@praxis/adapter-claude-code
@praxis/adapter-opencode
@praxis/adapter-local-model
@praxis/adapter-mock-worker
@praxis/adapter-testkit

@praxis/praxis-hook

@praxis/runtime
@praxis/control-plane
@praxis/storage
@praxis/event-bus
@praxis/telemetry

@praxis/client
@praxis/cli
@praxis/desktop
@praxis/ui-core
```

Binary names:

```txt
praxis-runtime   # local runtime server
praxis           # CLI
praxis-hook      # hook helper called by Claude Code
praxis-desktop   # Electron desktop app
```

---

## 6. Dependency Direction

The architecture depends downward.

```txt
interface
   ↓
server
   ↓
kernel
   ↓
lib

adapters
   ↓
lib/contracts
   ↓
lib

hooks
   ↓
lib
   ↓
server runtime API client or local spool

server/runtime composes:
  kernel + adapters + storage + control-plane + circuit-breaker
```

A more precise graph:

```txt
lib/contracts
  ↑
  ├─ kernel/*
  ├─ adapters/*
  ├─ server/*
  ├─ hooks/*
  └─ interface/*

kernel/*
  ↑
  └─ server/runtime

adapters/*
  ↑
  └─ server/runtime

server/control-plane
  ↑
  ├─ server/runtime
  └─ interface/client

interface/desktop
  ├─ interface/client
  ├─ interface/ui-core
  └─ lib/contracts

interface/cli
  ├─ interface/client
  └─ lib/contracts
```

Forbidden imports:

```txt
kernel/* must not import adapters/claude-code.
kernel/* must not import server/storage.
kernel/* must not import interface/desktop.
lib/* must not import anything above lib.
adapters/* must not import interface/*.
hooks/* must not import kernel/truth-engine.
```

Circuit Breaker dependency rules:

```txt
kernel/circuit-breaker may depend on:
  lib/contracts
  lib/errors
  lib/result
  lib/ids
  lib/time

kernel/circuit-breaker must not import:
  server/*
  interface/*
  adapters/*
  hooks/*
  storage implementations

server/runtime composes Circuit Breaker with:
  kernel/core
  kernel/evidence
  kernel/governor
  server/event-bus
  server/storage
```

The runtime server composes dependencies. The kernel does not instantiate concrete adapters.

---

## 7. Runtime Communication Model

### 7.1 Chosen Model

Use:

```txt
HTTP for commands and queries
SSE for realtime server-to-client events
PostgreSQL append-only event log as source of truth
```

Do not use WebSocket in MVP.

### 7.2 Why Not Pure HTTP Polling?

Polling works but wastes work and causes stale UI.

PRAXIS needs live updates for:

```txt
TaskRun state changes
Worker status
Gate verdicts
Evidence append events
Transcript chunks
Human action queue
Circuit breaker status
Governor state
```

Polling all of that creates latency and unnecessary load.

### 7.3 Why Not WebSocket in MVP?

WebSocket is powerful but adds complexity:

```txt
Manual reconnect semantics
Harder replay design
Command and event mixing risk
More fragile debugging
More custom protocol decisions
```

PRAXIS's realtime flow is mostly one-way:

```txt
runtime server → UI
```

User actions can remain HTTP commands.

### 7.4 Why SSE Fits PRAXIS

SSE provides:

```txt
Simple server-to-client event stream
Built-in browser EventSource support
Automatic reconnect support
Last-Event-ID semantics
Text-based events
Easy debugging with curl
Works well with event logs
```

This matches PRAXIS because UI should display what the runtime verified, not become a distributed authority.

---

## 8. Control Plane API

### 8.1 Snapshot Query

On startup, clients request a complete runtime snapshot:

```http
GET /api/snapshot
```

Example response:

```json
{
  "runtime": {
    "status": "running",
    "version": "0.1.0"
  },
  "governor": {
    "tier": "stable_3",
    "activeWorkers": 2,
    "maxWorkers": 3
  },
  "circuitBreaker": {
    "state": "CLOSED"
  },
  "activeRuns": [],
  "workers": [],
  "pendingHumanActions": [],
  "lastEventSeq": 1846
}
```

### 8.2 SSE Event Stream

Clients then connect to the event stream:

```http
GET /api/events?after=1846
```

Event format:

```txt
event: task_run.updated
id: 1847
data: {"runId":"run_...","state":"VERIFYING"}

event: gate.verdict
id: 1848
data: {"runId":"run_...","gate":"ExecGate","verdict":"PASS"}

event: evidence.appended
id: 1849
data: {"attemptId":"att_...","recordId":"ev_..."}

event: transcript.chunk
id: 1850
data: {"attemptId":"att_...","stream":"stdout","chunk":"..."}

event: circuit_breaker.opened
id: 1851
data: {"state":"OPEN","previousState":"CLOSED","reason":"failure_rate > 30%","diagnosticSnapshot":{...}}

event: circuit_breaker.half_opened
id: 1852
data: {"state":"HALF_OPEN","previousState":"OPEN","reason":"cooldown_expired"}

event: circuit_breaker.closed
id: 1853
data: {"state":"CLOSED","previousState":"HALF_OPEN","reason":"probe_passed"}

event: circuit_breaker.probe_started
id: 1854
data: {"probeRunId":"run_...","state":"HALF_OPEN"}

event: circuit_breaker.probe_passed
id: 1855
data: {"probeRunId":"run_...","verdict":"PASS"}

event: circuit_breaker.probe_failed
id: 1856
data: {"probeRunId":"run_...","verdict":"FAIL"}
```

### 8.3 Command API

Commands are HTTP POST requests.

Examples:

```http
POST /api/plans/admit
POST /api/runs/:runId/pause
POST /api/runs/:runId/resume
POST /api/hir/:hirId/resolve
POST /api/workers/:workerId/kill
POST /api/workers/:workerId/restart
POST /api/conflicts/:conflictId/resolve
POST /api/governor/override
POST /api/circuit-breaker/reset
POST /api/circuit-breaker/probe
```

Command response:

```json
{
  "ok": true,
  "commandId": "cmd_01J...",
  "acceptedAt": "2026-06-16T21:12:00.000Z"
}
```

Important rule:

```txt
HTTP command response = command accepted.
SSE event = actual state changed.
```

The UI must not show a final state based only on command acceptance.

---

## 9. Event-Sourced UI Model

The UI should not invent state.

Startup flow:

```txt
1. GET /api/snapshot
2. Hydrate TanStack Query and Zustand stores
3. Connect SSE with after=snapshot.lastEventSeq
4. Apply events in sequence order
5. On disconnect, reconnect with after=lastSeenSeq
6. If a sequence gap is detected, refresh snapshot
```

Frontend state tools:

```txt
TanStack Query  → snapshots, queries, cache invalidation
Zustand         → live event-derived UI state
EventSource     → SSE connection
Zod             → runtime validation of API payloads
```

---

## 10. Storage Model

### 10.1 Database Decision

Use PostgreSQL as the primary database.

Do not support SQLite in MVP.

Reason:

```txt
PRAXIS is evidence-heavy.
It needs event history, evidence records, task runs, attempts, transcripts, and auditability.
PostgreSQL gives strong indexing, JSONB, transactions, and durable event logs.
```

### 10.2 Migration Strategy

Use SQL-first migrations.

Preferred stack:

```txt
Kysely + pg + raw SQL migration runner
```

Avoid Alembic unless the project intentionally accepts a Python dependency.

Migration files:

```txt
server/storage/migrations/
├─ 0001_init.sql
├─ 0002_runtime_events.sql
├─ 0003_evidence_chain.sql
├─ 0004_task_runs.sql
├─ 0005_conflicts_hir.sql
└─ 0006_circuit_breaker_transitions.sql
```

### 10.3 Core Tables

Expected tables:

```txt
plans
task_runs
attempts
workers
worker_sessions
evidence_records
gate_verdicts
runtime_events
transcript_chunks
hir_requests
conflict_reports
accp_jobs
runtime_commands
circuit_breaker_transitions
```

### 10.4 Runtime Events Table

```sql
CREATE TABLE runtime_events (
  seq BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_type TEXT NULL,
  aggregate_id TEXT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This table powers SSE replay:

```txt
GET /api/events?after=<seq>
```

### 10.5 Evidence Records Table

```sql
CREATE TABLE evidence_records (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  timestamp_ns BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Large raw blobs such as huge transcript chunks may be stored separately if needed.

---

## 11. Kernel Modules

### 11.1 `kernel/core`

Owns TaskRun lifecycle and scheduling.

```txt
kernel/core/src/
├─ fsm/
│  ├─ task-run-fsm.ts
│  ├─ transitions.ts
│  └─ invariants.ts
├─ scheduler/
│  ├─ plan-queue.ts
│  ├─ wave-scheduler.ts
│  └─ dependency-graph.ts
├─ workspace/
│  ├─ worktree-manager.ts
│  ├─ namespace-locks.ts
│  └─ cleanup.ts
├─ runtime/
│  ├─ task-runner.ts
│  ├─ attempt-runner.ts
│  └─ lifecycle.ts
└─ index.ts
```

Responsibilities:

```txt
Create TaskRuns
Move TaskRuns through FSM
Request worker slots
Start attempts through abstract WorkerAdapter
Trigger capture and verification
Route PASS/HOLD/FAIL results
Queue repair attempts
Trigger wave assembly
```

### 11.2 `kernel/psag`

PlanSpec Admission Gate.

```txt
kernel/psag/src/
├─ admit-plan.ts
├─ schema-check.ts
├─ namespace-audit.ts
├─ shared-package-audit.ts
├─ dependency-cycle-check.ts
├─ budget-check.ts
├─ quality-score.ts
└─ index.ts
```

Responsibilities:

```txt
Validate PlanSpec schema
Reject missing acceptance criteria
Reject agent-generated criteria
Reject namespace collisions
Reject dependency cycles
Audit shared package strategy
Compute quality score
Return ADMIT / WARN / REJECT
```

### 11.3 `kernel/evidence`

Attempt capture and evidence interpretation.

```txt
kernel/evidence/src/
├─ capture/
│  ├─ attempt-capture.ts
│  ├─ git-diff-capture.ts
│  ├─ transcript-capture.ts
│  └─ filesystem-snapshot.ts
├─ ehc/
│  ├─ evidence-record.ts
│  ├─ hash-chain.ts
│  ├─ ehc-verifier.ts
│  └─ ehc-break-classifier.ts
├─ parsers/
│  ├─ test-output-parser.ts
│  ├─ jest.ts
│  ├─ vitest.ts
│  ├─ pytest.ts
│  └─ go-test.ts
├─ divergence/
│  └─ divergence-detector.ts
└─ index.ts
```

Responsibilities:

```txt
Capture git diff
Capture changed files
Capture command transcript
Parse test output
Build Evidence Hash Chain
Classify EHC breaks
Detect divergence between hook-captured raw output and worker claims
```

### 11.4 `kernel/truth-engine`

Completion authority.

```txt
kernel/truth-engine/src/
├─ gates/
│  ├─ evidence-gate.ts
│  ├─ exec-gate.ts
│  ├─ final-gate.ts
│  └─ wiring-gate.placeholder.ts
├─ verdict/
│  ├─ gate-verdict.ts
│  ├─ verdict-codes.ts
│  └─ verdict-router.ts
├─ criteria/
│  ├─ file-exists.ts
│  ├─ test-passes.ts
│  ├─ command-output.ts
│  ├─ diff-contains.ts
│  └─ no-diff-contains.ts
└─ index.ts
```

Gates:

```txt
EvidenceGate:
  verifies real file changes happened inside namespace

ExecGate:
  verifies commands ran and tests actually passed using kernel-owned transcript

FinalGate:
  verifies human-authored acceptance criteria from TaskSpec
```

### 11.5 `kernel/rim`

Repair Intelligence Module.

```txt
kernel/rim/src/
├─ failure-signature.ts
├─ strategy-selector.ts
├─ repair-packet-builder.ts
├─ strategies/
│  ├─ initial.ts
│  ├─ context-expand.ts
│  ├─ tool-restrict.ts
│  ├─ scope-narrow.ts
│  ├─ knowledge-inject.ts
│  └─ hint-inject.ts
└─ index.ts
```

Responsibilities:

```txt
Compute structured failure signatures
Track prior attempt failures
Rotate repair strategies
Build RepairPacket v2
Trigger HIR at configured thresholds
Abort when budget/attempt limit is exhausted
```

### 11.6 `kernel/governor`

Concurrency and budget governance.

```txt
kernel/governor/src/
├─ adaptive-concurrency-governor.ts
├─ resource-governor.ts
├─ clean-operation-window.ts
├─ demotion-rules.ts
└─ index.ts
```

Responsibilities:

```txt
Decide how many workers can run
Track clean operation window
Demote on instability
Promote only after measured stability
Track token/time budgets
```

### 11.7 `kernel/circuit-breaker`

System-level safety guard.

```txt
kernel/circuit-breaker/src/
├─ circuit-breaker.ts
├─ circuit-breaker-state.ts
├─ circuit-breaker-policy.ts
├─ open-trigger-evaluator.ts
├─ failure-rate-window.ts
├─ governor-red-monitor.ts
├─ ehc-break-monitor.ts
├─ probe-controller.ts
├─ diagnostic-snapshot.ts
├─ circuit-breaker-events.ts
└─ index.ts
```

Responsibilities:

```txt
Track system-level failure rate over sliding window
Evaluate CONFIRMED EHC break classifications
Monitor Governor RED duration
Open breaker when policy thresholds are exceeded
Reject new admissions while OPEN
Control exactly-one probe attempt during HALF_OPEN
Produce diagnostic snapshots on state transitions
Emit circuit-breaker runtime events
Persist state transitions for recovery
```

### 11.8 `kernel/assembler`

Wave-level deterministic assembler.

```txt
kernel/assembler/src/
├─ wave-assembler.ts
├─ artifact-acceptance-gate.ts
├─ namespace-recheck.ts
├─ semantic-check/
│  ├─ signature-extractor.ts
│  ├─ callsite-scanner.ts
│  └─ mismatch-detector.ts
├─ patch/
│  ├─ patch-loader.ts
│  ├─ patch-applier.ts
│  └─ atomic-write.ts
├─ rollback.ts
├─ conflict-report-builder.ts
└─ index.ts
```

Responsibilities:

```txt
Wait for all required TaskRuns in a wave
Verify FVR/artifact readiness
Re-check namespaces
Run basic semantic signature/call-site conflict detection
Apply patches atomically
Rollback on failure
Generate ConflictReport
Send affected TaskRuns back to repair
```

### 11.9 `kernel/accp`

Async artifact layer.

```txt
kernel/accp/src/
├─ job-queue.ts
├─ fvr/
│  ├─ fvr-builder.ts
│  └─ fvr-schema.ts
├─ prr/
│  ├─ prr-builder.ts
│  └─ prr-schema.ts
├─ compiler.ts
└─ index.ts
```

Rule:

```txt
ACCP never blocks the execution critical path.
```

MVP artifact types:

```txt
FVR per TaskRun
PRR per wave
```

---

## 12. Adapter Architecture

### 12.1 Adapter Contract

Define the adapter contract in:

```txt
lib/contracts/src/worker-adapter.ts
```

Sketch:

```ts
export interface WorkerAdapter {
  readonly id: string;
  readonly kind: WorkerAdapterKind;

  healthCheck(): Promise<WorkerHealthResult>;

  runAttempt(input: RunAttemptInput): Promise<RunAttemptResult>;

  abortAttempt(input: AbortAttemptInput): Promise<AbortAttemptResult>;
}
```

The kernel depends on this contract, not on concrete adapter implementations.

### 12.2 Claude Code Adapter

Location:

```txt
adapters/claude-code/
```

Tree:

```txt
adapters/claude-code/
├─ src/
│  ├─ index.ts
│  ├─ claude-code-adapter.ts
│  ├─ claude-session-runner.ts
│  ├─ claude-command-builder.ts
│  ├─ claude-settings-writer.ts
│  ├─ claude-hook-installer.ts
│  ├─ claude-env-builder.ts
│  ├─ claude-output-normalizer.ts
│  ├─ claude-health-check.ts
│  ├─ claude-rate-limit-detector.ts
│  └─ claude-errors.ts
├─ tests/
│  ├─ claude-code-adapter.test.ts
│  ├─ claude-command-builder.test.ts
│  └─ claude-output-normalizer.test.ts
└─ package.json
```

Responsibilities:

```txt
Start Claude Code CLI
Prepare workspace cwd
Prepare environment variables
Install hook settings
Pass task prompt and RepairPacket context
Detect process exit status
Detect rate limit symptoms
Normalize result into RunAttemptResult
```

Not responsibilities:

```txt
Truth verification
Evidence chain construction
FinalGate evaluation
Patch assembly
Storage writes except adapter logs if routed through runtime
```

### 12.3 Adapter Registry

The runtime server composes adapters:

```txt
server/runtime/src/adapter-registry.ts
```

Sketch:

```ts
import { createClaudeCodeAdapter } from '@praxis/adapter-claude-code';
import { createMockWorkerAdapter } from '@praxis/adapter-mock-worker';

export function createAdapterRegistry() {
  return {
    claudeCode: createClaudeCodeAdapter(),
    mockWorker: createMockWorkerAdapter(),
  };
}
```

Kernel receives an abstract adapter from the runtime composition root.

---

## 13. Hook Architecture

### 13.1 Hook Binary Location

```txt
hooks/praxis-hook/
```

Tree:

```txt
hooks/praxis-hook/
├─ src/
│  ├─ main.ts
│  ├─ pre-tool.ts
│  ├─ post-tool.ts
│  ├─ stop.ts
│  ├─ hook-event-parser.ts
│  ├─ hook-event-normalizer.ts
│  ├─ runtime-client.ts
│  └─ local-spool.ts
└─ package.json
```

### 13.2 Hook Responsibilities

`praxis-hook` should:

```txt
Parse hook event input from Claude Code
Normalize event payload
Attach attempt/session metadata from environment
Send event to local runtime server
Spool locally if runtime is temporarily unavailable
Exit quickly
Avoid heavy logic
Avoid truth decisions
```

### 13.3 Claude Hook Config

The Claude Code adapter writes hook config similar to:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "praxis-hook pre-tool"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "praxis-hook post-tool"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "praxis-hook stop"
          }
        ]
      }
    ]
  }
}
```

### 13.4 Hook Event Flow

```txt
kernel/core
  ↓ requests attempt execution
server/runtime
  ↓ selects adapter
adapters/claude-code
  ↓ starts Claude Code with hook env
Claude Code
  ↓ calls hook command
hooks/praxis-hook
  ↓ sends event to runtime
server/runtime
  ↓ persists raw runtime event
kernel/evidence
  ↓ interprets event into transcript/evidence
kernel/truth-engine
  ↓ verifies attempt
```

---

## 14. Server Architecture

### 14.1 `server/runtime`

The runtime process composition root.

```txt
server/runtime/src/
├─ main.ts
├─ start-runtime.ts
├─ runtime-process.ts
├─ composition-root.ts
├─ adapter-registry.ts
├─ security-token.ts
├─ health.ts
├─ shutdown.ts
└─ index.ts
```

Responsibilities:

```txt
Load config
Start storage
Start event bus
Create adapter registry
Create kernel services
Start control plane HTTP/SSE server
Handle graceful shutdown
Expose runtime health
```

### 14.2 `server/control-plane`

HTTP API and SSE stream.

```txt
server/control-plane/src/
├─ app.ts
├─ routes/
│  ├─ snapshot.ts
│  ├─ plans.ts
│  ├─ runs.ts
│  ├─ workers.ts
│  ├─ hir.ts
│  ├─ conflicts.ts
│  ├─ governor.ts
│  └─ hook-events.ts
├─ sse/
│  ├─ events-stream.ts
│  ├─ replay.ts
│  └─ heartbeat.ts
└─ index.ts
```

### 14.3 `server/storage`

PostgreSQL repositories.

```txt
server/storage/
├─ migrations/
├─ src/
│  ├─ db.ts
│  ├─ migrate.ts
│  ├─ transaction.ts
│  ├─ repositories/
│  │  ├─ plans.repo.ts
│  │  ├─ task-runs.repo.ts
│  │  ├─ attempts.repo.ts
│  │  ├─ evidence.repo.ts
│  │  ├─ events.repo.ts
│  │  ├─ workers.repo.ts
│  │  ├─ hir.repo.ts
│  │  └─ conflicts.repo.ts
│  └─ index.ts
└─ package.json
```

### 14.4 `server/event-bus`

Internal event bus between kernel, runtime, storage, and SSE.

```txt
server/event-bus/src/
├─ event-bus.ts
├─ runtime-event.ts
├─ event-publisher.ts
├─ event-subscriber.ts
└─ index.ts
```

Rule:

```txt
Every important state change should become a persisted runtime_event.
SSE streams persisted runtime_events, not ephemeral memory-only messages.
```

---

## 15. Interface Architecture

### 15.1 `interface/client`

Typed runtime client used by CLI and desktop.

```txt
interface/client/src/
├─ http-client.ts
├─ sse-client.ts
├─ snapshot.ts
├─ commands.ts
├─ schemas.ts
└─ index.ts
```

Responsibilities:

```txt
Call HTTP endpoints
Connect SSE event stream
Validate payloads with Zod
Expose typed client API
Handle reconnect and after=seq replay
```

### 15.2 `interface/cli`

The `praxis` CLI.

```txt
interface/cli/src/
├─ main.ts
├─ commands/
│  ├─ status.ts
│  ├─ runs.ts
│  ├─ run.ts
│  ├─ wave.ts
│  ├─ logs.ts
│  ├─ conflicts.ts
│  ├─ admit.ts
│  └─ runtime.ts
├─ format/
│  ├─ table.ts
│  ├─ json.ts
│  └─ colors.ts
└─ index.ts
```

CLI examples:

```bash
praxis status
praxis runs --state REPAIR
praxis run run_01J...
praxis logs run_01J...
praxis conflicts
praxis admit examples/plans/example.plan.yaml
```

### 15.3 `interface/desktop`

Electron + React desktop UI.

```txt
interface/desktop/
├─ src/
│  ├─ main.tsx
│  ├─ app.tsx
│  ├─ routes.tsx
│  ├─ api/
│  │  └─ runtime-client.ts
│  ├─ store/
│  │  ├─ runtime.store.ts
│  │  ├─ events.store.ts
│  │  ├─ runs.store.ts
│  │  └─ workers.store.ts
│  ├─ screens/
│  │  ├─ mission-control/
│  │  ├─ plan-dag/
│  │  ├─ worker-grid/
│  │  ├─ task-run-detail/
│  │  ├─ evidence-inspector/
│  │  ├─ assembler/
│  │  ├─ human-action-queue/
│  │  ├─ plan-composer/
│  │  └─ history-replay/
│  └─ components/
└─ electron/
   ├─ main.ts
   └─ preload.ts
```

UI rule:

```txt
The UI never marks a task complete.
It only renders kernel events and verified state.
```

---

## 16. Stack Decisions

### 16.1 Core

```txt
Language: TypeScript strict
Runtime/tooling: Bun
Package management: Bun workspaces
```

### 16.2 Runtime Server

```txt
Bun
Hono
SSE
Zod
pino
PostgreSQL
Kysely
pg
raw SQL migrations
```

### 16.3 Desktop UI

```txt
Electron
electron-vite
React
Tailwind CSS
Radix UI
TanStack Query
TanStack Table
Zustand
React Hook Form
Zod
Monaco Editor
xterm.js
Lucide Icons
```

### 16.4 Testing

```txt
Vitest
Playwright
React Testing Library
MSW
Testcontainers
```

### 16.5 Quality

```txt
Biome
TypeScript strict
Husky or Lefthook
lint-staged
GitHub Actions
```

### 16.6 Migration Decision

Prefer:

```txt
Kysely + raw SQL migration runner
```

Avoid by default:

```txt
Alembic
```

Reason:

```txt
Alembic is excellent but brings Python dependency into a TypeScript/Bun repo.
Use it only if explicitly accepted by ADR.
```

---

## 17. Runtime Security

The runtime server should be local-only.

Requirements:

```txt
Bind to 127.0.0.1
Use random auth token per runtime installation/session
Store token in user config dir with safe file permissions
Reject requests without token
Restrict CORS
Do not expose public network interface by default
```

Electron connection options:

MVP:

```txt
Renderer connects directly to http://127.0.0.1:<port>
```

Production-preferred:

```txt
Renderer → Electron preload API → Electron main → runtime server
```

---

## 18. Cross-Platform Model

Supported targets:

```txt
Linux
macOS
Windows
```

Runtime expectations:

```txt
No Linux-only daemon assumptions
No systemd dependency
No hardcoded /tmp-only logic
No shell-specific behavior unless wrapped
Use Node/Bun process APIs carefully
Use path utilities for cross-platform paths
```

The desktop app should start or find the runtime server:

```txt
1. Check if runtime is already running
2. If not running, spawn runtime process
3. Wait for health endpoint
4. Connect UI
5. Stop runtime only if owned by current desktop session, depending on config
```

CLI should also connect to the same runtime:

```txt
praxis status
```

If runtime is not running, CLI can either:

```txt
start it automatically if configured
or print a clear instruction
```

---

## 19. Plan Execution Flow

```txt
User submits PlanSpec
  ↓
PSAG validates PlanSpec
  ↓
Runtime creates Plan + TaskRuns
  ↓
Governor decides worker capacity
  ↓
Kernel schedules eligible TaskRuns
  ↓
Runtime selects WorkerAdapter
  ↓
Adapter starts external worker
  ↓
Hook captures tool events
  ↓
Evidence module builds AttemptEvidence
  ↓
Truth Engine evaluates gates
  ↓
PASS → TaskRun COMPLETE
HOLD → RIM builds RepairPacket
FAIL → TaskRun FAILED or HIR/abort
  ↓
When wave complete → Assembler applies patches atomically
  ↓
ACCP artifacts generated async
  ↓
Events streamed to UI/CLI via SSE
```

---

## 20. TaskRun FSM

```txt
DORMANT
  ↓ PSAG ADMIT
QUEUED
  ↓ Governor permits
WORKSPACE_INIT
  ↓ worktree ready
RUNNING
  ↓ worker attempt complete
CAPTURING
  ↓ evidence captured
VERIFYING
  ├─ PASS → COMPLETE
  ├─ HOLD → REPAIR
  └─ FAIL → FAILED

REPAIR
  ├─ retry strategy → RUNNING
  ├─ HIR threshold → PAUSED
  └─ budget exhausted → ABORTED

PAUSED
  ├─ human resume + hint → RUNNING
  ├─ human abort → ABORTED
  └─ timeout → RUNNING with knowledge_inject
```

Terminal invariants:

```txt
COMPLETE:
  FinalGate PASS
  EHC intact
  Required acceptance criteria met
  FVR job enqueued

FAILED:
  Truth Engine FAIL
  Evidence preserved
  Human review required

ABORTED:
  Budget exhausted or human abort
  Evidence preserved
```

---

## 21. Truth Verification Model

### 21.1 EvidenceGate

Question:

```txt
Did real file changes occur inside the declared namespace?
```

Inputs:

```txt
git diff
changed files
namespace declaration
```

PASS examples:

```txt
diff non-empty
changed files match actual diff
all changed files inside namespace
```

HOLD examples:

```txt
empty diff
no files changed
```

FAIL examples:

```txt
namespace violation
changed_files list inconsistent with actual diff
```

### 21.2 ExecGate

Question:

```txt
Did commands run, and did tests actually pass?
```

Inputs:

```txt
KernelOwnedTranscript
exit codes
raw stdout/stderr
TestOutputParser result
divergence events
```

PASS examples:

```txt
transcript exists
at least one command ran
exit code is 0
test runner detected with tests_ran > 0 and failures = 0
```

HOLD examples:

```txt
missing transcript
exit code non-zero
zero tests ran
test failures detected
```

FAIL examples:

```txt
forbidden command
confirmed divergence
```

### 21.3 FinalGate

Question:

```txt
Are all required human-authored acceptance criteria satisfied?
```

Supported verification types:

```txt
file_exists
test_passes
command_output
diff_contains
no_diff_contains
```

FinalGate must read criteria only from TaskSpec.

---

## 22. Repair Model

Repair uses structured failure signatures.

A failure signature should include:

```txt
failed gate
verdict code
diff_empty
namespace_violation
exit_code
commands_ran
test_runner_detected
test_failures
suite_empty
divergence_detected
failed_criteria_ids
failed_verification_types
missing_file_patterns
```

Strategy sequence:

```txt
Attempt 1: initial
Attempt 2: initial
Attempt 3: context_expand
Attempt 4: tool_restrict
Attempt 5: scope_narrow + HIR trigger
Attempt 6: hint_inject if human hint exists, otherwise knowledge_inject
Attempt 7: abort
```

RIM outputs:

```txt
RepairPacket v2
```

The adapter receives this packet but does not decide whether the strategy succeeded. The Truth Engine decides.

---

## 23. Circuit Breaker Architecture

### 23.1 Purpose

The Circuit Breaker protects the whole PRAXIS system from sustained instability. It is distinct from per-attempt verification.

While the Truth Engine asks "Is this attempt actually complete?", the Circuit Breaker asks:

```txt
Is the whole system safe enough to continue admitting work?
```

When the system is healthy, the breaker is CLOSED and work flows normally. When the system crosses safety thresholds, the breaker OPENs and blocks new admissions until recovery conditions are met.

### 23.2 Owner

```txt
Circuit Breaker is a kernel-owned safety component.
```

The server exposes Circuit Breaker state but does not own the decision logic. The interface displays Circuit Breaker state but must never decide or override completion/safety authority directly.

Circuit Breaker protects system health; Truth Engine verifies individual attempts. Circuit Breaker must not replace EvidenceGate, ExecGate, FinalGate, PSAG, RIM, Governor, or Assembler.

### 23.3 States

```txt
CLOSED:
  meaning: "System is healthy enough to admit new work."
  allows_new_admissions: true
  allows_new_worker_launches: true

OPEN:
  meaning: "System is unsafe. New admissions are blocked."
  allows_new_admissions: false
  allows_new_worker_launches: false
  in_flight_attempt_policy: "finish_current_attempt_or_controlled_abort"

HALF_OPEN:
  meaning: "System is testing recovery with one controlled attempt."
  allows_new_admissions: false
  allows_new_worker_launches: "one_controlled_probe_only"
  pass_transition: "CLOSED"
  fail_transition: "OPEN"
```

### 23.4 Open Triggers

The Circuit Breaker opens when any of these thresholds is exceeded:

```txt
open_triggers:

failure_rate:
  threshold: "> 30%"
  window: "10 minute sliding window"

governor_red:
  duration: "> 15 minutes continuous"

ehc_break:
  classification: "CONFIRMED"
```

Key constraint — NOISE and SUSPECTED EHC breaks do not automatically open the Circuit Breaker. Only CONFIRMED EHC breaks open it.

### 23.5 OPEN Behavior

When Circuit Breaker enters OPEN:

```txt
- reject new plan admissions
- reject new task run starts
- prevent new worker launches
- allow in-flight attempts to finish current command or perform controlled abort
- emit circuit_breaker.opened runtime event
- persist state transition
- notify clients through SSE
- include diagnostic snapshot:
  failure_rate
  top_failing_gates
  governor_state
  ehc_break_classification
  last_failed_verdicts
  opened_at
  opened_reason
```

### 23.6 HALF_OPEN Behavior

```txt
HALF_OPEN behavior:
- entered after cooldown or explicit human reset
- permits exactly one controlled probe attempt
- probe attempt must use a low-risk task or health-check task
- if probe passes safety gates, transition to CLOSED
- if probe fails, transition back to OPEN
- all transitions must be persisted and emitted as runtime events
```

### 23.7 Recovery and Reset

Recovery paths:

```txt
OPEN → (cooldown expires) → HALF_OPEN
OPEN → (human reset via API) → HALF_OPEN
HALF_OPEN → (probe passes) → CLOSED
HALF_OPEN → (probe fails) → OPEN
```

The Circuit Breaker does not self-recover from OPEN to CLOSED directly. It must always pass through HALF_OPEN with a successful probe.

### 23.8 Runtime Events

```txt
circuit_breaker.opened
circuit_breaker.half_opened
circuit_breaker.closed
circuit_breaker.reset_requested
circuit_breaker.probe_started
circuit_breaker.probe_passed
circuit_breaker.probe_failed
```

Each event payload must include:

```txt
state
previous_state
reason
timestamp
diagnostic_snapshot
correlation_id
```

### 23.9 Storage

Circuit Breaker transitions are recorded in a dedicated table:

Table: `circuit_breaker_transitions`

```txt
id                     TEXT PRIMARY KEY
previous_state         TEXT NOT NULL
next_state             TEXT NOT NULL
reason                 TEXT NOT NULL
diagnostic_snapshot    JSONB NOT NULL
correlation_id         TEXT NOT NULL
runtime_event_seq      BIGINT NULL
created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
```

`runtime_events` remains the SSE replay source of truth. The `circuit_breaker_transitions` table provides durable per-transition records for recovery and audit.

### 23.10 API Exposure

Snapshot must include:

```json
{
  "circuitBreaker": {
    "state": "CLOSED | OPEN | HALF_OPEN",
    "openedAt": "timestamp or null",
    "openedReason": "string or null",
    "lastTransitionSeq": "number",
    "probeRunId": "string or null"
  }
}
```

SSE stream must emit:

```txt
circuit_breaker.opened
circuit_breaker.half_opened
circuit_breaker.closed
circuit_breaker.probe_started
circuit_breaker.probe_passed
circuit_breaker.probe_failed
```

Commands:

```http
POST /api/circuit-breaker/reset
POST /api/circuit-breaker/probe
```

Rule: HTTP command response means command accepted. SSE event means Circuit Breaker state actually changed.

### 23.11 Relationship to Other Components

```txt
Truth Engine:
  question: "Is this attempt actually complete?"
  authority: EvidenceGate, ExecGate, FinalGate

Governor:
  question: "How many workers can safely run concurrently?"
  authority: Concurrency and resource pressure

Circuit Breaker:
  question: "Is the whole system safe enough to continue admitting work?"
  authority: System-level safety state
```

### 23.12 Testing Requirements

Required tests:

```txt
unit:
  CLOSED allows admissions
  OPEN rejects admissions
  HALF_OPEN permits exactly one probe
  failure_rate > 30% over 10 minutes opens breaker
  governor RED > 15 minutes opens breaker
  EHC CONFIRMED opens breaker
  EHC NOISE does not open breaker
  EHC SUSPECTED does not open breaker

integration:
  runtime snapshot exposes circuitBreaker state
  SSE emits circuit_breaker.opened
  reset command emits accepted response before state event
  state survives runtime restart via storage

false_done_safety:
  repeated ExecGate failures open breaker by failure-rate policy
  confirmed divergence/EHC integrity failure opens breaker
```

---

## 24. Assembly Model

Assembler is wave-level.

Do not assemble per TaskRun in a way that breaks wave consistency.

Assembly flow:

```txt
All TaskRuns in wave COMPLETE
  ↓
Artifact Acceptance Gate
  ↓
Namespace re-check
  ↓
Basic semantic check
  ↓
Pre-assembly git snapshot
  ↓
Atomic patch apply
  ↓
Final validation command
  ↓
Wave COMPLETE or rollback + ConflictReport
```

ConflictReport must include:

```txt
conflict type
files
workers involved
line ranges if available
resolution hint
affected TaskRuns
rollback ref
resolution strategy
```

Affected TaskRuns go back to repair with ConflictReport injected.

---

## 25. ACCP Artifact Layer

ACCP is async by default.

Rule:

```txt
Never block execution critical path on ACCP rendering.
```

MVP artifacts:

```txt
FVR: Final Verification Report per TaskRun
PRR: Promotion Readiness Report per wave
```

ACCP jobs are stored and recoverable:

```txt
accp_jobs table
```

If ACCP compiler crashes:

```txt
1. Restart worker
2. Load pending jobs
3. Read source evidence from storage
4. Rebuild artifact idempotently
5. Mark job complete
```

---

## 26. Config Model

Config package:

```txt
lib/config/
```

Expected config sources:

```txt
defaults
config file
environment variables
CLI flags
```

Precedence:

```txt
CLI flags > env vars > config file > defaults
```

Example config shape:

```ts
export interface PraxisConfig {
  runtime: {
    host: '127.0.0.1';
    port: number;
    authTokenPath: string;
  };

  database: {
    url: string;
  };

  workers: {
    defaultAdapter: 'claude-code' | 'mock-worker' | 'opencode' | 'local-model';
    maxConcurrent: number;
  };

  claudeCode?: {
    binaryPath: string;
    settingsPath: string;
    skipPermissions: boolean;
  };

  evidence: {
    storeRawTranscript: boolean;
  };
}
```

---

## 27. Testing Strategy

### 26.1 Unit Tests

Every package should own local unit tests:

```txt
kernel/truth-engine/tests/
kernel/rim/tests/
kernel/circuit-breaker/tests/
adapters/claude-code/tests/
server/control-plane/tests/
```

### 26.2 Cross-Package Tests

Use root tests for behavior spanning packages:

```txt
tests/integration/
tests/e2e/
tests/false-done/
tests/evidence-chain/
tests/assembler/
tests/circuit-breaker/
```

### 26.3 Required Test Categories

```txt
false-done detection
empty diff HOLD
exit code failure HOLD
zero tests ran HOLD
agent-generated criteria REJECT
namespace collision REJECT
namespace violation FAIL
EHC chain verification
SSE replay after reconnect
adapter timeout handling
hook event ingestion
assembly rollback
ConflictReport repair injection
CLOSED allows admissions
OPEN rejects new admissions
HALF_OPEN permits exactly one probe
failure_rate > 30% over 10 minutes opens breaker
governor RED > 15 minutes opens breaker
EHC CONFIRMED opens breaker
EHC NOISE does not open breaker
EHC SUSPECTED does not open breaker
SSE emits circuit_breaker.opened
reset command accepted before state transition
state survives runtime restart
```

### 26.4 Mock Worker

`adapters/mock-worker` is mandatory.

It allows deterministic tests without Claude Code:

```txt
return empty diff
return failing test
return successful patch
return namespace violation
return delayed output
emit transcript chunks
simulate crash
simulate rate limit
```

---

## 28. AI Agent Instructions

When an AI coding agent works in this repo, it must obey these rules:

1. Read this file first.
2. Identify the target layer before editing.
3. Do not cross architectural boundaries for convenience.
4. Do not put Claude-specific logic in `kernel/`.
5. Do not put Truth Engine logic in `adapters/`.
6. Do not put runtime storage logic in `lib/`.
7. Do not create root `src/`.
8. Do not mark task completion based on agent claims.
9. Add or update tests for every behavior change.
10. If a new boundary is needed, create an ADR before implementation.

Common task routing:

```txt
Need to change completion logic?
  → kernel/truth-engine

Need to change repair strategy?
  → kernel/rim

Need to change system-level safety policy?
  → kernel/circuit-breaker

Need to change Claude invocation?
  → adapters/claude-code

Need to change Claude hook capture?
  → hooks/praxis-hook

Need to change HTTP API?
  → server/control-plane

Need to change event persistence?
  → server/storage + server/event-bus

Need to change desktop screen?
  → interface/desktop

Need shared type?
  → lib/contracts

Need generic utility?
  → lib/*
```

---

## 29. MVP Scope

MVP should include:

```txt
Bun workspace repo
lib/contracts
lib/errors/result/ids/time/crypto/validation
kernel/core basic FSM
kernel/psag basic admission
kernel/evidence basic capture
kernel/circuit-breaker basic CLOSED/OPEN/HALF_OPEN states
kernel/truth-engine EvidenceGate + ExecGate + FinalGate
adapters/mock-worker
adapters/claude-code basic run attempt
hooks/praxis-hook basic pre/post/stop capture
server/runtime
server/control-plane HTTP + SSE
server/storage Postgres migrations
interface/cli basic status/runs/logs
interface/desktop basic Mission Control
tests/false-done
tests/runtime-e2e
```

Do not include in MVP:

```txt
Full semantic conflict detection
Stable_16
Cloud service
Multi-user auth
Plugin marketplace
Complex web dashboard
Multiple DB support
Alembic unless ADR-approved
WebSocket protocol unless ADR-approved
```

---

## 30. Roadmap Phases

The canonical phase model is defined in `docs/decisions.md` (D-052 through D-061). This section summarizes each phase; `docs/decisions.md` and `todo.md` are authoritative for scope, gates, and progress.

### P-1 — Architecture / Reuse Decision Lock

```txt
decisions.md (canonical decision register)
ADR index
lock matrix
reuse policy
phase map
forbidden-copy list
```

### P0 — Selective pi/ Reuse Foundation Port

```txt
P0.1: Monorepo scaffold + CI (Bun workspaces, tsconfig, boundary checker)
P0.2: Port execution-contracts → lib/contracts
P0.3: Port accp-compiler → kernel/accp
P0.4: Extract old FSM reference doc
P0 Gate: All ported tests pass, no old namespace remains
```

### P1 — Desktop Mission Control + Runtime Contracts

```txt
RuntimeSnapshot / RuntimeEvent contracts
Desktop mockup with fake runtime data
Mission Control dashboard (mock state only)
Contract docs (docs/contracts/*.md)
```

### P2 — Mock Runtime Vertical Slice

```txt
server/event-bus, server/control-plane (minimal HTTP + SSE)
In-memory event log
adapters/mock-worker
interface/client (typed HTTP/SSE client)
Desktop connected to snapshot + SSE (mock data)
```

### P3 — Kernel Safety Core

```txt
kernel/core TaskRun FSM (from scratch)
kernel/psag (minimal admission gate)
kernel/evidence (minimal model + EHC)
kernel/truth-engine (EvidenceGate + ExecGate + FinalGate)
kernel/circuit-breaker (CLOSED/OPEN/HALF_OPEN, all triggers)
kernel/rim (basic strategy rotation)
False-done / namespace-violation / empty-diff tests
```

### P4 — Real Worker Integration

```txt
Day 0 Claude Code spike (GO/NO-GO gate)
hooks/praxis-hook (PreToolUse, PostToolUse, Stop)
adapters/claude-code (command builder, session runner, output normalizer)
KernelOwnedTranscript + divergence detection
Real attempt in isolated workspace
```

### P5 — Parallel Execution + Assembler

```txt
Workspace manager + namespace locks
Wave scheduler + dependency graph
kernel/governor (concurrency tiers, demotion rules)
kernel/assembler (namespace recheck, semantic check, atomic apply, rollback)
ConflictReport + repair injection
3 mock workers → 3 real workers (after mock proof)
```

### P6 — ACCP Artifacts + Production Hardening

```txt
ACCP async job queue + FVR/PRR
PostgreSQL durable storage + runtime event replay
Runtime restart recovery
Desktop production build
CLI commands
Installer / packaging
Playwright e2e + long-run stability baseline
```

---

## 31. Architecture Decision Records

Use ADRs for irreversible or controversial decisions.

ADR topics already implied:

```txt
ADR-001: Runtime Server naming instead of daemon
ADR-002: HTTP + SSE instead of WebSocket MVP
ADR-003: PostgreSQL primary DB, no SQLite MVP
ADR-004: Kysely + raw SQL migrations instead of Alembic
ADR-005: Adapters as top-level boundary
ADR-006: Claude Code adapter and praxis-hook separation
ADR-007: Electron instead of Tauri
ADR-008: No root src directory
ADR-009: Event log as UI source of truth
ADR-010: Circuit Breaker as kernel-owned safety component
```

ADR format:

```md
# ADR-XXX: Title

## Status

Accepted / Proposed / Rejected

## Context

What problem exists?

## Decision

What are we doing?

## Consequences

Positive and negative consequences.

## Alternatives Considered

What else did we consider?
```

---

## 32. Final Architecture Contract

The repository is considered architecturally valid if:

```txt
kernel remains pure
adapters stay external-boundary only
hooks stay tiny capture binaries
server owns runtime composition and API
interface only displays verified state
lib only contains shared contracts/utilities
all completion flows pass through Truth Engine
all realtime UI state comes from snapshot + event replay
all worker integrations implement WorkerAdapter contract
all important state changes produce persisted runtime_events
```

The shortest accurate description:

> PRAXIS is a local runtime server around a pure verification kernel, connected to external coding workers through isolated adapters, observed through HTTP snapshots and SSE event replay, and rendered by CLI/Desktop interfaces that never invent completion state.
