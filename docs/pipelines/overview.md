# PRAXIS Pipeline Overview

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the end-to-end PRAXIS pipeline from plan admission through completion artifacts. This document is the primary reference for understanding where each component participates in the full execution flow and what is in each MVP stage.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document provides the single authoritative map of the PRAXIS execution pipeline. It answers: what happens from the moment a PlanSpec is submitted to the moment verified artifacts are assembled? Where does each component sit? What happens in each MVP stage? It is the navigation document for all other pipeline specs.

---

## Scope

- End-to-end pipeline stages from admission to artifact assembly
- Component placement: which package owns which pipeline responsibility
- KEEP/NEXT progression and gate positions
- MVP-A, MVP-B, MVP-C staging with clear capability boundaries
- Where Desktop Mission Control observes the pipeline
- Where Circuit Breaker and Governor intervene
- ACCP artifact pipeline as an independent async flow

---

## Non-Goals

- Implementation code (this is a specification, not source)
- Detailed per-stage transition logic (delegated to `docs/pipelines/taskrun-lifecycle.md`)
- Detailed RuntimeEvent payloads (delegated to `docs/pipelines/runtime-event-flow.md`)
- Contract field definitions (delegated to `docs/contracts/*.md`)
- P0 migration descriptions (P0 is Selective pi/ Reuse Foundation Port per D-044)
- Worker self-report as completion (rejected per D-028, D-104)

---

## Authoritative Decisions Used

| ID | Decision | Relevance |
|----|----------|-----------|
| D-001 / D-016 | Local-first execution platform | Pipeline runs entirely on local machine |
| D-002 / D-017 | Desktop Mission Control is MVP main control panel | UI observes pipeline via snapshot + SSE |
| D-020 | Kernel owns pure execution, domain, safety logic | PSAG, FSM, Evidence, Truth Engine, RIM, Governor, Circuit Breaker, Assembler, ACCP are kernel-owned |
| D-021 | Adapters integrate external workers | Adapters sit at worker boundary, normalize output |
| D-022 | Hooks capture external tool events | Hooks feed raw evidence into pipeline |
| D-023 | Server composes runtime, storage, API, event bus, adapters | Server is wiring layer |
| D-024 | Interface displays runtime and kernel state only | Desktop observes; never decides |
| D-025 | HTTP commands/queries + SSE event stream | MVP communication model |
| D-026 / D-096 | UI state from snapshot + RuntimeEvent replay | Startup and event order guarantees |
| D-028 | Worker self-report is not completion (Law 1) | All completion flows pass through Truth Engine |
| D-029 | UI never decides completion | Desktop renders verdicts, never creates them |
| D-030 | Adapter never decides completion | Adapters normalize output, do not evaluate |
| D-031 | Hook never decides truth | Hook events are raw evidence |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | Three gates: EvidenceGate, ExecGate, FinalGate |
| D-037 / D-038 | ACCP artifacts are async and non-blocking | ACCP pipeline is separate, never blocks execution |
| D-040 | ACCP compiler is not the Truth Engine | Separate concerns |
| D-078 | Two-layer autonomous model | Claude local loop + PRAXIS supervisory loop |
| D-080 | PRAXIS supervisory loop | Admits, captures, verifies, repairs, controls safety |
| D-082 | Circuit Breaker can stop new admissions | OPEN prevents new work |
| D-083 | Governor controls concurrency, not truth | Governor manages worker count |
| D-084 | Circuit Breaker is kernel-owned | System-wide safety in kernel |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN | Three-state safety model |
| D-087 | Governor concurrency authority | Determines safe parallelism level |
| D-088 | Truth Engine attempt-level completion | Pass/Hold/Fail per attempt |

---

## Conceptual Model

PRAXIS is a pipeline with two independent loops:

**Loop 1 -- Execution Pipeline (critical path):**
```
PlanSpec arrives --> PSAG admits or rejects --> TaskRuns decomposed -->
Workspaces initialized --> Workers execute in isolation -->
Hooks capture events --> Evidence is gathered -->
Truth Engine evaluates gates --> PASS assembles / HOLD repairs / FAIL requires human
```

**Loop 2 -- ACCP Artifact Pipeline (async, never blocking):**
```
TaskRun COMPLETE --> ACCP job enqueued --> FVR generated -->
Wave complete --> PRR generated --> Artifacts persisted
```

The Execution Pipeline is the critical path. The ACCP pipeline runs independently and must not block or roll back any execution result. If ACCP generation fails (crash, restart, error), it retries from stored evidence.

---

## Data Flow / Control Flow

### High-Level Pipeline Diagram

```
                          ┌─────────────────────────┐
                          │       PlanSpec           │
                          │  (human-authored YAML)   │
                          └────────────┬────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              PSAG                                             │
│                         kernel/psag                                           │
│                                                                              │
│  Schema check · Namespace collision audit · Shared-package audit              │
│  Dependency cycle check · Budget check · Acceptance criteria presence         │
│  Criteria source check (reject 'generated') · Quality score                   │
│                                                                              │
│  Output: ADMIT / WARN / REJECT                                                │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ ADMIT
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         TaskRun Decomposition                                 │
│                         kernel/core/fsm                                       │
│                                                                              │
│  PlanSpec decomposed into TaskRuns                                            │
│  Each TaskRun assigned: wave, namespace[], task_type, budget, dependencies    │
│  DORMANT state → QUEUED when admitted                                         │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
┌──────────────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐
│    Circuit Breaker       │ │    Governor      │ │     Workflow Control      │
│    kernel/circuit-breaker│ │   kernel/governor│ │                            │
│                          │ │                  │ │                            │
│ "Is the whole system     │ │ "How many workers│ │ CB CLOSED? → continue     │
│  safe enough to admit    │ │  can safely run?"│ │ CB OPEN?  → block new     │
│  new work?"              │ │                  │ │   admissions              │
│                          │ │ Concurrency tier │ │ Governor permits? → start │
│ CLOSED → allow           │ │ (stable_3→16)    │ │   workspace init          │
│ OPEN   → reject all new  │ │                  │ │ Governor RED?  → demote   │
│ HALF_OPEN → one probe    │ │                  │ │                            │
└──────────────────────────┘ └──────────────────┘ └──────────────────────────┘

                                       │ Workspace Init
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Workspace Initialization                              │
│                         kernel/core/workspace                                 │
│                                                                              │
│  git worktree created · Namespace locks acquired · Hook config installed     │
│  Environment prepared · Worker-specific cwd · Budget tokens loaded           │
│                                                                              │
│  State: WORKSPACE_INIT → RUNNING on success                                   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ RUNNING
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Worker Execution                                      │
│                                                                              │
│  ┌──────────────────────┐   ┌──────────────────────┐                         │
│  │  WorkerAdapter       │   │  praxis-hook         │                         │
│  │  adapters/*          │   │  hooks/praxis-hook    │                         │
│  │                      │   │                      │                         │
│  │ Starts worker process│   │ Called by Claude Code│                         │
│  │ Passes task prompt   │   │ PreToolUse           │                         │
│  │ Normalizes output    │   │ PostToolUse           │                         │
│  │ Detects crashes      │   │ Stop                 │                         │
│  │ Detects rate limits  │   │ Sends raw events     │                         │
│  │                      │   │   to runtime server  │                         │
│  │ NEVER decides truth  │   │ NEVER decides truth  │                         │
│  └──────────────────────┘   └──────────────────────┘                         │
│                                                                              │
│  Worker operates in ISOLATED namespace (git worktree)                         │
│  Worker self-reports "done" → this is EVIDENCE, not COMPLETION               │
│  Any "done" claim without evidence is flagged                                 │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Worker process exits / adapter returns
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Evidence Capture                                      │
│                         kernel/evidence                                       │
│                                                                              │
│  git diff captured · Changed files enumerated · Namespace check              │
│  Transcript captured (KernelOwnedTranscript) · Test output parsed            │
│  Evidence Hash Chain built · EHC integrity verified                          │
│  Divergence detection: hook_raw vs worker_claimed                            │
│                                                                              │
│  EHC break classification: NOISE / SUSPECTED / CONFIRMED                     │
│  State: CAPTURING → VERIFYING on capture complete                             │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ VERIFYING
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Truth Engine                                          │
│                         kernel/truth-engine                                   │
│                                                                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐            │
│  │  EvidenceGate   │  │   ExecGate       │  │   FinalGate      │            │
│  │                 │  │                  │  │                  │            │
│  │ Did real file   │→ │ Did commands     │→ │ Are all human-   │            │
│  │ changes happen? │  │ run and tests    │  │ authored criteria │            │
│  │                 │  │ pass?            │  │ satisfied?       │            │
│  │ PASS: diff non- │  │ PASS: #cmds>0,   │  │ PASS: acceptance │            │
│  │   empty, inside │  │   exit 0, tests  │  │   criteria met   │            │
│  │   namespace     │  │   ran>0, pass    │  │                  │            │
│  │ HOLD: no diff   │  │ HOLD: no cmd ran │  │ HOLD: criteria   │            │
│  │ FAIL: namespace │  │   zero tests ran │  │   partially met  │            │
│  │   violation     │  │ FAIL: forbidden, │  │ FAIL: criteria   │            │
│  │                 │  │   divergence     │  │   not met        │            │
│  └─────────────────┘  └──────────────────┘  └──────────────────┘            │
│                                                                              │
│  Output: PASS / HOLD / FAIL                                                   │
└───────────────┬───────────────────────┬───────────────────────┬──────────────┘
                │                       │                       │
                ▼                       ▼                       ▼
         ┌─────────┐           ┌─────────────┐          ┌──────────┐
         │  PASS   │           │    HOLD     │          │   FAIL   │
         └────┬────┘           └──────┬──────┘          └────┬─────┘
              │                       │                      │
              ▼                       ▼                      ▼
┌──────────────────────┐ ┌─────────────────────┐ ┌───────────────────────┐
│    Wave Assembler    │ │       RIM           │ │    Human Review       │
│   kernel/assembler   │ │    kernel/rim       │ │   (HIR queued)        │
│                      │ │                     │ │                       │
│ Namespace recheck    │ │ Failure signature   │ │ FAILED terminal state │
│ Semantic check       │ │ Strategy rotation   │ │ Evidence preserved    │
│ Atomic patch apply   │ │  (initial→expand→   │ │                       │
│ Rollback on conflict │ │   restrict→narrow→  │ │                       │
│ ConflictReport       │ │   inject→hint)      │ │                       │
│                      │ │                     │ │                       │
│ COMPLETE (terminal)  │ │ RepairPacket →      │ │                       │
│                      │ │   RUNNING (retry)   │ │                       │
│                      │ │ ABORTED @ attempt 7 │ │                       │
└──────────┬───────────┘ └─────────────────────┘ └───────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         ACCP Artifact Pipeline                                │
│                       (ALWAYS ASYNC, never blocking)                          │
│                         kernel/accp                                           │
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────┐                     │
│  │ FVR                 │         │ PRR                 │                     │
│  │ Final Verification  │         │ Promotion Readiness │                     │
│  │ Report              │         │ Report              │                     │
│  │                     │         │                     │                     │
│  │ Per TaskRun         │         │ Per wave            │                     │
│  │ Reads stored        │         │ Reads stored FVRs   │                     │
│  │ evidence records    │         │ Reads assembler     │                     │
│  │ Compiles verdicts   │         │   reports           │                     │
│  │ Idempotent: crash   │         │ Idempotent: crash   │                     │
│  │   → reload → retry  │         │   → reload → retry  │                     │
│  └─────────────────────┘         └─────────────────────┘                     │
│                                                                              │
│  Does NOT block execution critical path. TaskRun COMPLETE does not wait       │
│  for ACCP artifact production. ACCP failure does not roll back execution.     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Where Desktop Mission Control Observes

```
Desktop Mission Control (interface/desktop)

  ┌─────────────┐     ┌──────────────────────┐
  │ On startup: │     │ On connection:       │
  │ GET /snapshot│    │ GET /events?after=N  │
  │ Hydrate UI  │     │ SSE stream           │
  └─────────────┘     └──────────────────────┘
          │                     │
          └──────────┬──────────┘
                     ▼
         ┌───────────────────────────────┐
         │     Desktop UI displays:       │
         │                               │
         │  Runtime status               │
         │  TaskRun list/detail          │
         │  Worker grid                  │
         │  Gate verdicts (pass/hold/fail)│
         │  Evidence/log stream          │
         │  Circuit Breaker status       │
         │  Governor state               │
         │  Human action queue           │
         │                               │
         │  NEVER:                       │
         │  - Decides completion         │
         │  - Overrides gate verdicts    │
         │  - Invents state              │
         │  - Emits completion events    │
         └───────────────────────────────┘
```

### Where Circuit Breaker Intervenes

```
PlanSpec arrives
      │
      ▼
Check Circuit Breaker state
      │
      ├─ CLOSED ──→ proceed to PSAG
      │
      ├─ OPEN ────→ REJECT all new admissions
      │             In-flight attempts: finish current command or controlled abort
      │             SSE: circuit_breaker.opened event
      │
      └─ HALF_OPEN → REJECT new admissions
                    Allow exactly ONE probe attempt (low-risk/health-check task)
                    Probe PASS → CLOSED
                    Probe FAIL → OPEN
                    SSE: circuit_breaker.half_opened, probe_started/failed/passed

IMPORTANT: Circuit Breaker stops NEW admissions. It does NOT rewrite past verdicts.
           A TaskRun that completed before OPEN remains COMPLETE.
           OPEN only prevents the pipeline from accepting NEW work.
```

### Where Governor Controls Concurrency

```
Queue of QUEUED TaskRuns
      │
      ▼
Governor: "How many workers can safely run?"
      │
      ├─ hasAvailableSlot? → YES → WORKSPACE_INIT
      │
      └─ hasAvailableSlot? → NO → TaskRun stays QUEUED
                                  Queued runs ordered by dependency/wave

Governor state changes:
      Promoted: stable_3 → stable_6 → stable_8 → stable_12 → stable_16
               (each tier requires 48h continuous clean operation)
               Note: stable_16 is an OPEN hypothesis requiring architecture review;
               only stable_3 is proven for MVP-C.

      Demoted: On sustained failure rate, governor RED, or Circuit Breaker OPEN
               Immediate drop to next lower tier or stable_3 minimum

Governor NEVER decides truth. Governor ONLY controls how many workers run.
```

---

## Component Responsibilities

### Kernel Components (kernel/)

| Component | Package | Pipeline Role |
|-----------|---------|---------------|
| **PSAG** | `kernel/psag` | Plan admission gate. Validates PlanSpec, rejects agent-generated criteria, checks namespace collisions, audits shared packages, detects dependency cycles. Output: ADMIT / WARN / REJECT. |
| **Core FSM** | `kernel/core` | TaskRun lifecycle. Manages state transitions DORMANT→QUEUED→...→COMPLETE. Owns workspace initialization, scheduling, attempt lifecycle. Never marks COMPLETE based on worker self-report. |
| **Evidence** | `kernel/evidence` | Captures git diff, changed files, command transcript, test output. Builds Evidence Hash Chain. Classifies EHC breaks. Detects divergence between hook raw events and worker claims. |
| **Truth Engine** | `kernel/truth-engine` | Completion authority. EvidenceGate → ExecGate → FinalGate. Output: PASS / HOLD / FAIL. Sole source of attempt completion across the entire system. |
| **RIM** | `kernel/rim` | Repair Intelligence Module. Activated only on HOLD/FAIL. Computes failure signature, rotates repair strategies (6 levels), builds RepairPacket. Aborts at attempt 7. |
| **Governor** | `kernel/governor` | Concurrency authority. Decides how many workers can run safely. Tracks clean operation windows. Promotes/demotes concurrency tiers. Does NOT evaluate truth. |
| **Circuit Breaker** | `kernel/circuit-breaker` | System-level safety guard. CLOSED/OPEN/HALF_OPEN. Opens on: failure rate > 30%/10min, governor RED > 15min, EHC CONFIRMED. Blocks new admissions when OPEN. Does NOT rewrite past verdicts. |
| **Assembler** | `kernel/assembler` | Wave-level deterministic assembler. Only shared writer (Law 2). Namespace recheck, semantic check, atomic patch apply, rollback on conflict, ConflictReport generation. |
| **ACCP** | `kernel/accp` | Async artifact compiler. Generates FVR per TaskRun, PRR per wave. Never blocks execution critical path. Idempotent recovery on crash. |

### Adapter Components (adapters/)

| Component | Package | Pipeline Role |
|-----------|---------|---------------|
| **Claude Code Adapter** | `adapters/claude-code` | Starts Claude Code processes, prepares env/config/prompts, installs hook config, detects rate limits/crashes, normalizes worker output into AttemptManifest. NEVER decides completion. |
| **OpenCode Adapter** | `adapters/opencode` | Same role for OpenCode workers. |
| **Local Model Adapter** | `adapters/local-model` | Same role for locally-hosted model workers. |
| **Mock Worker** | `adapters/mock-worker` | Test/development adapter. Returns configurable outputs: empty diff, failing test, successful patch, namespace violation, crash simulation. |

### Hook Components (hooks/)

| Component | Package | Pipeline Role |
|-----------|---------|---------------|
| **praxis-hook** | `hooks/praxis-hook` | Claude Code hook binary. Called on PreToolUse, PostToolUse, Stop events. Sends raw tool events to runtime server. Small, robust, no truth decisions. |

### Server Components (server/)

| Component | Package | Pipeline Role |
|-----------|---------|---------------|
| **Runtime** | `server/runtime` | Composition root. Loads config, starts storage, creates adapter registry, composes kernel services, starts control plane. |
| **Control Plane** | `server/control-plane` | HTTP command/query API + SSE event stream. Snapshot endpoint, plan admission endpoint, run/worker/hir/conflict routes, governor/CB commands. |
| **Storage** | `server/storage` | PostgreSQL repositories. Plans, task runs, attempts, evidence records, events, workers, HIR, conflicts. |
| **Event Bus** | `server/event-bus` | Internal event bus. Every important state change becomes a persisted runtime_event. Powers SSE replay. |

### Interface Components (interface/)

| Component | Package | Pipeline Role |
|-----------|---------|---------------|
| **Desktop Mission Control** | `interface/desktop` | Operator control panel. Renders runtime state from snapshot + SSE events. Displays TaskRun list/detail, worker grid, gate verdicts, evidence stream, CB status, Governor state, human action queue. NEVER decides completion. |
| **Typed Client** | `interface/client` | HTTP/SSE client shared by CLI and desktop. Handles snapshot, SSE reconnect, after=seq replay. |
| **CLI** | `interface/cli` | Secondary operator interface. Status, runs, logs, conflicts, admit commands. |

---

## MVP Staging

### MVP-A: Mock Runtime Proof

```
What runs:
  - Desktop Mission Control mockup with fake runtime data
  - Mock worker producing events (empty diff, passing test, failing test, etc.)
  - In-memory event log (append-only, source of truth for this stage)
  - server/control-plane with snapshot endpoint and SSE stream
  - interface/client connecting desktop to server

What does NOT run:
  - No real Claude Code worker
  - No kernel safety core (FSM, PSAG, Evidence, Truth Engine, Circuit Breaker)
  - No PostgreSQL (in-memory event log)
  - No assembler
  - No ACCP artifacts

Gate verdict:
  Desktop opens and displays realistic mock state without backend dependency.
  SSE stream delivers events that desktop renders correctly.
  Snapshot + event replay works end-to-end without loss.
```

### MVP-B: Single Real Worker

```
What runs:
  - All MVP-A capability
  - One real Claude Code worker via adapters/claude-code
  - hooks/praxis-hook capturing real tool events
  - kernel/evidence basic capture (git diff, changed files, transcript)
  - kernel/truth-engine EvidenceGate + ExecGate + FinalGate
  - kernel/rim basic strategy rotation (initial only or initial + context_expand)
  - kernel/circuit-breaker CLOSED/OPEN/HALF_OPEN
  - False-done detection: empty diff HOLD, zero tests ran HOLD, namespace violation FAIL

What does NOT run:
  - Multiple parallel workers
  - Wave scheduler
  - Assembler (single worker, no integration needed)
  - Governor concurrency tier promotion (only one worker)

Gate verdict:
  Real Claude attempt runs in isolated workspace.
  Empty-diff false-done is caught.
  Gate verdicts are correct (PASS on valid work, HOLD on empty diff, FAIL on namespace violation).
  Circuit Breaker opens on 30% failure rate and blocks admissions.
  Desktop displays real gate verdicts.
```

### MVP-C: Three Parallel Workers

```
What runs:
  - All MVP-B capability
  - Wave scheduler with dependency graph
  - Three workers running concurrently
  - kernel/governor concurrency control (starting at stable_3)
  - Namespace isolation per worker (exclusive worktree per worker)
  - kernel/assembler (namespace recheck, basic semantic check, atomic apply, rollback)
  - ConflictReport generation and repair injection
  - RIM full strategy rotation (6 levels)

What does NOT run:
  - Production-hardened concurrency tiers (stable_6+ requires 48h clean operation baseline)
  - Full semantic conflict detection (basic call-site scanner only)
  - ACCP artifacts (FVR/PRR deferred to P6 unless needed earlier)

Gate verdict:
  Three workers run in parallel without conflict.
  Assembler produces correct integration from three isolated workspaces.
  Rollback works on conflict.
  Governor correctly limits concurrency.
```

---

## ACCP Pipeline Independence

The ACCP artifact pipeline is explicitly decoupled from the execution critical path:

```
Execution Pipeline               ACCP Pipeline
─────────────────              ─────────────────
TaskRun reaches COMPLETE  ──→  ACCP job enqueued
  │                              │
  │ (DOES NOT WAIT)              ▼
  │                            FVR generation started
  ▼                              │
Wave continues                 │ (may crash/restart)
  │                              ▼
  │                            Idempotent reload from
  │                            stored evidence records
  ▼                              │
Assembler runs                   ▼
  │                            FVR complete
  ▼                              │
Wave COMPLETE                    ▼
  │                            PRR enqueued after
  │                            all wave TaskRuns have FVRs
  ▼
Next wave starts
```

Key constraints:
- ACCP artifact generation must NEVER block the execution critical path
- TaskRun COMPLETE must not wait for ACCP job completion
- ACCP generation failure must not roll back or block execution
- ACCP jobs are idempotent: on crash/restart, reload evidence from storage and rebuild
- ACCP compiler is not the Truth Engine (D-040)

---

## MUST / MUST NOT Rules

### MUST

- All completion flows MUST pass through Truth Engine (EvidenceGate → ExecGate → FinalGate)
- PSAG MUST reject any TaskSpec with `criteria_source: 'generated'`
- PSAG MUST check for presence of human-authored acceptance criteria before admission
- Evidence capture MUST include git diff, changed file enumeration, and namespace check
- Truth Engine MUST produce a PASS, HOLD, or FAIL verdict for every attempt
- RIM MUST activate only on HOLD/FAIL outcomes; must never run on PASS
- Circuit Breaker OPEN MUST prevent new plan admissions and new TaskRun starts
- Circuit Breaker MUST NOT rewrite past verdicts (existing COMPLETE stays COMPLETE)
- Governor MUST control concurrency based on stability metrics; must never evaluate truth
- ACCP artifact generation MUST be async and non-blocking
- All important state changes MUST produce a persisted runtime_event
- Desktop Mission Control MUST render state from snapshot + event replay
- The "done" signal MUST come from Truth Engine FinalGate PASS, never from worker self-report

### MUST NOT

- Worker self-report MUST NOT mark completion (D-028, Law 1)
- UI MUST NOT decide completion (D-029)
- Adapter MUST NOT decide completion (D-030)
- Hook MUST NOT decide truth (D-031)
- ACCP compiler MUST NOT be the Truth Engine (D-040)
- ACCP artifacts MUST NOT block execution critical path (D-037, D-038)
- Desktop MUST NOT invent state independent of snapshot + events
- Desktop MUST NOT emit completion events or override gate verdicts (D-066)
- Circuit Breaker OPEN MUST NOT rewrite past verdicts
- P0 MUST NOT be described as "migration from old repo" (D-044)

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| PlanSpec with agent-generated criteria | PSAG rejects on criteria_source check | Plan not admitted. Feedback to operator. |
| PlanSpec with missing acceptance criteria | PSAG rejects; FinalGate needs criteria to pass | Plan not admitted. |
| Namespace collision between TaskRuns | PSAG rejects | Plan not admitted. |
| Dependency cycle in TaskRun graph | PSAG rejects | Plan not admitted. |
| Circuit Breaker OPEN during admission | Reject new admissions | In-flight: finish or controlled abort. UI shows OPEN state + diagnostic snapshot. |
| Governor RED (sustained instability) | Circuit Breaker opens after 15min continuous RED | Demote concurrency tier. If > 15min, Circuit Breaker OPEN. |
| Worker process crash | Adapter detects, returns error result | Attempt marked as failed. Evidence preserved. RIM may trigger repair. |
| Worker rate limit | Claude Code adapter detects rate limit symptoms | Attempt paused or failed. May retry after cooldown. |
| Hook event failure (missed events) | Divergence detector compares hook-captured vs worker-claimed | Divergence flagged. EHC break classification. |
| EHC integrity break | Chain hash verification fails | EHC break classified: NOISE, SUSPECTED, or CONFIRMED |
| EHC CONFIRMED break | EHC break classifier | Circuit Breaker OPEN. System-wide safety response. |
| Empty diff + worker claims "done" | EvidenceGate HOLD | False-done detected. RIM repair or ABORT. |
| Zero tests ran + worker claims "passed" | ExecGate HOLD | False-done detected. RIM repair or ABORT. |
| Namespace violation (worker wrote outside namespace) | EvidenceGate or namespace check FAIL | Violation flagged. Attempt failed. |
| Assembler conflict (two workers modified same file) | Namespace recheck + semantic check | Rollback. ConflictReport generated. Affected TaskRuns → RIM repair. |
| Assembler crash during patch apply | Atomic write + git snapshot | Rollback to pre-assembly snapshot. Retry assemble with conflict resolution. |
| ACCP generation crash | Recoverable: read evidence from storage, rebuild idempotently | Job marked pending. Retried on next ACCP worker cycle. |
| SSE disconnect | Desktop detects EventSource close | Reconnect with after=lastSeenSeq. If gap detected, request fresh snapshot. |
| Missing event sequence (gap) | UI detects seq jump > 1 from last seen | Request fresh snapshot via GET /api/snapshot. Replay events from snapshot.lastEventSeq. |

---

## Test / Gate Implications

| Pipeline Stage | Required Tests |
|----------------|---------------|
| PSAG admission | Schema validation rejects agent-generated criteria. Namespace collision detection. Dependency cycle detection. Budget check rejects oversized TaskSpecs. |
| Workspace init | Worktree created with correct namespace. Hook config installed. Environment variables set correctly. |
| Worker execution | Mock worker produces empty diff. Mock worker produces failing test. Mock worker produces successful patch. Mock worker writes outside namespace. |
| Evidence capture | Git diff captured correctly. Changed files enumerated. Evidence Hash Chain builds and verifies. EHC break classified correctly (NOISE/SUSPECTED/CONFIRMED). Test output parsed for Jest, Vitest, Pytest, Go test. |
| Truth Engine | EvidenceGate: empty diff → HOLD, namespace violation → FAIL, valid diff → PASS. ExecGate: zero tests → HOLD, failed tests → HOLD, all pass → PASS. FinalGate: criteria met → PASS, missing evidence → HOLD, cannot meet → FAIL. |
| Circuit Breaker | CLOSED allows admissions. OPEN rejects admissions. HALF_OPEN permits exactly one probe. Failure rate > 30% in 10min opens. Governor RED > 15min opens. EHC CONFIRMED opens. EHC NOISE and SUSPECTED do NOT open. State survives restart via storage. |
| RIM | Repair strategy rotates correctly through 6 levels. Aborts at attempt 7. RepairPacket built with correct context. |
| Assembler | Namespace recheck catches violation. Semantic check catches call-site mismatch. Atomic apply succeeds or rollback works. ConflictReport correctly lists affected TaskRuns. |
| ACCP | FVR generated from stored evidence. PRR generated from stored FVRs. Idempotent on crash and retry. Does not cause execution pipeline deadlock. |
| SSE/Events | Snapshot returns correct runtime state. SSE streams events in order. Reconnect after=N works. Gap detection triggers snapshot refresh. |

---

## Decision Compliance Checklist

- [x] PRAXIS is local-first (D-001 / D-016)
- [x] Desktop Mission Control is part of MVP (D-002)
- [x] Kernel owns pure execution, domain, safety (D-020)
- [x] Adapters integrate external workers, never decide completion (D-021, D-030)
- [x] Hooks capture raw events, never decide truth (D-022, D-031)
- [x] Server composes, kernel is server-free (D-023, D-027)
- [x] Interface only displays kernel state, never decides (D-024, D-029)
- [x] HTTP + SSE is communication model (D-025)
- [x] UI state from snapshot + event replay (D-026, D-096)
- [x] Worker self-report is not completion (D-028, Law 1)
- [x] Truth Engine owns PASS/HOLD/FAIL (D-032)
- [x] ACCP is async and non-blocking (D-037, D-038)
- [x] ACCP compiler is not Truth Engine (D-040)
- [x] P0 is Selective pi/ Reuse Foundation Port, not migration (D-044)
- [x] Two-layer autonomous model (D-078)
- [x] Circuit Breaker is kernel-owned, stops new admissions but does not rewrite past (D-082, D-084)
- [x] Governor controls concurrency, not truth (D-083, D-087)
- [x] Circuit Breaker states: CLOSED, OPEN, HALF_OPEN (D-085)
- [x] TaskRun lifecycle flows through defined states (D-047 reference)
- [x] MVP-A / MVP-B / MVP-C staging defined

---

## Open Questions

| ID | Question | Relevance |
|----|----------|-----------|
| Q1 | Should PSAG output a detailed diagnostic or a simple ADMIT/WARN/REJECT? A detailed diagnostic supports operator understanding but increases PSAG complexity. | PSAG design (P3) |
| Q2 | At what point in the pipeline should workspace cleanup (worktree deletion) happen? Immediately after COMPLETE? After ACCP FVR generation? After wave assembly? | Workspace manager (P3/P5) |
| Q3 | For MVP-A, should the mock worker be a standalone process or a library function returning pre-canned results? A process mimics real behavior better but adds complexity. | P2 mock runtime |
| Q4 | How does the Governor reconcile with the Circuit Breaker when both want different things? If Governor wants to promote more workers but failure rate is near CB threshold, who wins? | P3 kernel interaction design |
| Q5 | Should the assembler wait for all TaskRuns in a wave to COMPLETE before assembling, or can it assemble incrementally as TaskRuns finish? Incremental assembly is faster but wave-level consistency is safer. | Assembler design (P5) |
| Q6 | When a worker self-reports "done" with exit code 0 but EvidenceGate finds no diff, what specific message does the operator see in Desktop Mission Control? | UI design (P1/P2) |

---

## Audit Notes

- This is the primary pipeline navigation document. All other pipeline docs (taskrun-lifecycle.md, runtime-event-flow.md) are detail documents subordinate to this overview.
- The ASCII diagrams in this document are conceptual. Actual implementation may have additional detail steps (e.g., hook config installation sub-steps within workspace init).
- This document uses "SELECTIVE pi/ REUSE FOUNDATION PORT" terminology per D-044. It does not describe P0 as "migration."
- Worker self-report appears nowhere as a completion mechanism. All completion paths are gated through Truth Engine.
- ACCP is described as an independent async pipeline. The coupling constraint (never blocks execution path) is stated in multiple places with explicit diagramming.
- Circuit Breaker's constraint (cannot rewrite past verdicts) is stated explicitly.
- Governor's constraint (controls concurrency only, not truth) is stated explicitly.
- The document was written against `docs/decisions.md` as the canonical source. Any conflict with architecture.md or other documents is resolved in favor of decisions.md.
