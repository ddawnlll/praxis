# Product Scope

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define PRAXIS product scope, MVP staging (MVP-A, MVP-B, MVP-C), in-scope and out-of-scope features, and post-MVP roadmap.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document defines the product scope for PRAXIS v2.0. It answers:

- **What is PRAXIS?** -- a local-first execution platform for autonomous AI coding workers.
- **What is the primary operator interface?** -- Desktop Mission Control.
- **What is in MVP?** -- staged across MVP-A, MVP-B, MVP-C.
- **What is explicitly out of MVP?** -- rejected features that agents must not build.
- **What comes after MVP?** -- post-MVP roadmap.

---

## Scope

Covers the full product scope from pre-MVP (P-1/P0 planning and foundation port) through MVP stages (MVP-A, MVP-B, MVP-C) to post-MVP (production hardening, optional cloud, CLI improvements). This is a product-level scope document, not a technical implementation plan. See `docs/phase-map.md` for implementation phases and `todo.md` for task tracking.

---

## Non-Goals

- This document does **not** define architecture. See `architecture.md`.
- This document does **not** define implementation phases. See `docs/phase-map.md`.
- This document does **not** define contracts or APIs. See `docs/contracts/`.
- This document does **not** replace `docs/decisions.md` as the decision authority.

---

## Authoritative Decisions Used

| Decision ID | Summary | Source |
|-------------|---------|--------|
| D-001 | PRAXIS is a local-first execution platform | `docs/decisions.md` |
| D-002 | Desktop Mission Control is part of MVP and is the main operator control panel | `docs/decisions.md` |
| D-003 | Basic Electron operator shell is in scope for MVP | `docs/decisions.md` |
| D-004 | Mission Control dashboard is in scope for MVP | `docs/decisions.md` |
| D-005 | Runtime state viewer is in scope for MVP | `docs/decisions.md` |
| D-006 | TaskRun list/detail is in scope for MVP | `docs/decisions.md` |
| D-007 | Worker grid is in scope for MVP | `docs/decisions.md` |
| D-008 | Evidence/log stream is in scope for MVP | `docs/decisions.md` |
| D-009 | Gate verdicts are in scope for MVP | `docs/decisions.md` |
| D-010 | Circuit Breaker / Governor status are in scope for MVP | `docs/decisions.md` |
| D-011 | Human action queue is in scope for MVP | `docs/decisions.md` |
| D-012 | Production polish is not MVP-critical | `docs/decisions.md` |
| D-013 | Cloud dashboard is out of MVP scope | `docs/decisions.md` |
| D-014 | Old pi/web-ui reuse is rejected | `docs/decisions.md` |
| D-015 | CLI-only MVP is rejected | `docs/decisions.md` |
| D-025 | HTTP commands/queries + SSE event stream is MVP communication model | `docs/decisions.md` |
| D-044 | P0 is Selective pi/ Reuse Foundation Port, not migration | `docs/decisions.md` |
| D-051 | Full pi/ migration is rejected | `docs/decisions.md` |
| D-063 | Desktop app is the main control panel | `docs/decisions.md` |
| D-064 | Electron + React + Tailwind/Radix/TanStack direction | `docs/decisions.md` |
| D-084 | Circuit Breaker is kernel-owned | `docs/decisions.md` |

---

## Conceptual Model

PRAXIS is a **local-first execution platform**, not a cloud service, not a CI pipeline, not an IDE plugin. It runs on the operator's machine, connects to local or remote AI coding workers, and provides a Desktop Mission Control interface for supervision.

```
Operator
   │
   ▼
┌──────────────────────────┐
│  Desktop Mission Control  │  ← Primary operator interface
│  (Electron + React)       │
└──────────┬───────────────┘
           │ HTTP + SSE (localhost)
           ▼
┌──────────────────────────┐
│  PRAXIS Runtime Server    │  ← Local process (127.0.0.1)
│  (Hono + PostgreSQL)      │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  PRAXIS Kernel            │  ← Safety & verification brain
│  (FSM, Gates, CB, etc.)   │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Worker Adapters          │  ← Claude Code, OpenCode, etc.
│  (external processes)     │
└──────────────────────────┘
```

The operator uses Desktop Mission Control to admit plans, monitor task runs, inspect evidence and gate verdicts, and respond to human action requests. A CLI is available as a secondary interface. The runtime server and kernel run locally. Workers run in isolated workspaces.

---

## MVP Scope: Staged Delivery

PRAXIS MVP is staged, not one giant release. Each stage adds a layer of capability and proves a specific part of the safety model.

### MVP-A -- Mock Runtime Proof

**Goal:** Prove the Desktop Mission Control can render realistic system state without a real backend. Prove the event-sourced UI model works.

**What it includes:**

| Feature | Description |
|---------|-------------|
| Basic Electron operator shell | Electron app window, menus, basic chrome. Functional but not polished. |
| Mission Control dashboard | Main operator view showing runtime state, active workers, task runs, gate verdicts, and system health. All data is mock. |
| Runtime state viewer | Snapshot-based rendering of current runtime state. |
| TaskRun list/detail | List of task runs with expandable detail view showing FSM state, attempts, evidence, and verdicts. |
| Worker grid | Grid showing which workers are active, their status, and workspace assignments. |
| Evidence/log stream | Scrollable real-time event stream showing evidence records, log entries, and system events. SSE-backed. |
| Gate verdicts display | Verdict panel showing EvidenceGate, ExecGate, FinalGate results for each attempt. |
| Circuit Breaker status | Status panel showing CLOSED/OPEN/HALF_OPEN state, trigger reason, diagnostic snapshot. |
| Governor status | Status panel showing current concurrency tier, active/max workers, clean operation window. |
| Human action queue | List of pending human actions (HIR requests, conflict resolutions, override confirmations). |
| Mock data layer | Typed mock data for all UI views. Simulates realistic task runs, gate verdicts, CB transitions. |
| SSE event stream (mock) | In-memory event log producing realistic events consumed by desktop via EventSource. |

**What it does NOT include:**

- Real worker execution (no Claude Code, no real AI worker)
- Real kernel safety core (gates are simulated, not implemented)
- Real PostgreSQL storage (events are in-memory)
- Real Circuit Breaker trigger evaluation (state is mock-driven)
- CLI beyond basic status

**Gate verdict:** Desktop opens and displays realistic mock state without any backend dependency. All required panels render. UI does not invent completion state.

---

### MVP-B -- Single Real Worker

**Goal:** Prove PRAXIS can supervise one real Claude Code worker with full evidence capture, gate evaluation, and false-done detection.

**What it includes (adds to MVP-A):**

| Feature | Description |
|---------|-------------|
| Real Claude Code adapter | Starts Claude Code headless in isolated workspace. Full command builder, env setup, hook installation. |
| PRAXIS hooks | PreToolUse, PostToolUse, Stop hook binaries capturing raw tool events from Claude Code. |
| KernelOwnedTranscript | Complete transcript of Claude session captured by hooks, not by Claude's self-report. |
| Evidence capture | Git diffs, changed files, command output, exit codes, timestamps. Evidence Hash Chain (EHC) construction. |
| EvidenceGate | Verifies real file changes occurred inside declared namespace. Detects empty diffs. |
| ExecGate | Verifies commands ran and tests actually passed. Detects zero-test-ran scenarios. Uses test output parser. |
| FinalGate | Evaluates human-authored acceptance criteria from TaskSpec. file_exists, test_passes, command_output, diff_contains, no_diff_contains. |
| False-done detection | Empty diff -> HOLD. Zero tests ran -> HOLD. Agent claim without evidence -> HOLD. |
| Divergence detection | Compares hook-captured tool events against Claude's self-reported results. Flags mismatches. |
| Circuit Breaker (real) | CLOSED/OPEN/HALF_OPEN states. Failure rate trigger (>30% in 10min). Governor RED trigger. EHC CONFIRMED trigger. |
| RIM (basic) | Attempt 1-2: initial strategy. Repair packet construction. |
| Real evidence stream | Desktop shows real evidence records, real gate verdicts, real CB transitions from live worker. |

**What it does NOT include:**

- Multiple parallel workers
- Wave scheduler or dependency graph
- Assembler (only one worker, no integration needed)
- Governor concurrency tiers beyond single worker
- ACCP artifact generation (FVR/PRR are P6)

**Gate verdict:** One real Claude Code attempt runs in isolated workspace. Empty diff false-done is caught. Gate verdicts are correct. Divergence is detected. Circuit Breaker transitions work.

---

### MVP-C -- Three Parallel Workers

**Goal:** Prove PRAXIS can safely run multiple workers with namespace isolation and deterministic assembly.

**What it includes (adds to MVP-B):**

| Feature | Description |
|---------|-------------|
| Wave scheduler | Schedules task runs within a wave respecting dependency graph. |
| Dependency graph | Tracks task dependencies. Ensures dependent tasks wait for prerequisites. |
| Namespace locks | Exclusive file path ownership per worker. No two workers touch the same files. |
| Workspace manager | Creates isolated worktrees per worker. Manages cleanup. |
| Governor (real) | stable_3 concurrency tier. Clean operation window tracking. Demotion on instability. |
| Deterministic Assembler | Namespace recheck, basic semantic signature extraction, atomic patch apply, rollback, ConflictReport. |
| Conflict detection | Detects when two workers' outputs conflict at integration points. |
| ConflictReport | Structured report: conflict type, files, workers involved, resolution hint, affected task runs. |
| Repair injection | ConflictReport injected into RepairPacket when assembly fails. Affected tasks re-dispatched. |
| Three real workers | Three Claude Code workers running concurrently on a coordinated plan. |

**What it does NOT include:**

- stable_6, stable_8, stable_12, stable_16 concurrency tiers (only stable_3 is MVP-C)
- Full semantic conflict detection (basic only in MVP-C)
- ACCP artifact generation (FVR/PRR are P6)

**Gate verdict:** Three workers run in parallel. Assembler produces correct integration. Rollback works on conflict. Governor tiers function. Circuit Breaker opens on cascade failure.

---

## In MVP Scope -- Complete Feature List

### Operator Interface (Desktop Mission Control)

| Feature | MVP Stage |
|---------|-----------|
| Basic Electron operator shell | MVP-A |
| Mission Control dashboard | MVP-A |
| Runtime state viewer | MVP-A |
| TaskRun list/detail | MVP-A |
| Worker grid | MVP-A |
| Evidence/log stream | MVP-A |
| Gate verdicts display | MVP-A |
| Circuit Breaker status panel | MVP-A |
| Governor status panel | MVP-A |
| Human action queue | MVP-A |
| Plan list view | MVP-A |
| Plan composer / admit plan | MVP-B |
| Evidence inspector (detailed) | MVP-B |
| Assembler view (wave status) | MVP-C |
| Conflict resolution UI | MVP-C |

### Runtime Server

| Feature | MVP Stage |
|---------|-----------|
| Local HTTP server (127.0.0.1) | MVP-A |
| GET /api/snapshot | MVP-A |
| GET /api/events (SSE) | MVP-A |
| POST /api/plans/admit | MVP-B |
| POST /api/runs/:runId/pause | MVP-B |
| POST /api/runs/:runId/resume | MVP-B |
| POST /api/hir/:hirId/resolve | MVP-B |
| POST /api/workers/:workerId/kill | MVP-B |
| POST /api/circuit-breaker/reset | MVP-B |
| Security token | MVP-A |

### Kernel

| Feature | MVP Stage |
|---------|-----------|
| TaskRun FSM (DORMANT -> COMPLETE/ABORTED/FAILED) | MVP-B |
| PSAG (minimal admission gate) | MVP-B |
| Evidence capture + EHC | MVP-B |
| EvidenceGate | MVP-B |
| ExecGate | MVP-B |
| FinalGate | MVP-B |
| False-done detection | MVP-B |
| Divergence detection | MVP-B |
| Circuit Breaker (CLOSED/OPEN/HALF_OPEN, all triggers) | MVP-B |
| RIM (basic strategy rotation, 6 strategies) | MVP-B |
| Wave scheduler | MVP-C |
| Dependency graph | MVP-C |
| Namespace locks | MVP-C |
| Governor (stable_3 tier) | MVP-C |
| Deterministic Assembler | MVP-C |
| Conflict detection + ConflictReport | MVP-C |

### Workers

| Feature | MVP Stage |
|---------|-----------|
| Mock worker (multiple simulation modes) | MVP-A |
| Claude Code adapter | MVP-B |
| PRAXIS hooks (PreToolUse, PostToolUse, Stop) | MVP-B |
| KernelOwnedTranscript | MVP-B |
| Local spool (hook fallback) | MVP-B |
| Rate limit detection | MVP-B |
| 3 concurrent real workers | MVP-C |

### CLI (Secondary)

| Feature | MVP Stage |
|---------|-----------|
| `praxis status` | MVP-B |
| `praxis runs` | MVP-B |
| `praxis run <id>` | MVP-B |
| `praxis admit <plan>` | MVP-B |

### Storage

| Feature | MVP Stage |
|---------|-----------|
| In-memory event log | MVP-A |
| PostgreSQL durable storage | MVP-B |
| Runtime event replay | MVP-B |
| Runtime restart recovery | MVP-C |

### Testing

| Feature | MVP Stage |
|---------|-----------|
| False-done tests | MVP-B |
| Empty diff tests | MVP-B |
| Zero tests ran tests | MVP-B |
| Namespace violation tests | MVP-B |
| Circuit Breaker transition tests | MVP-B |
| EHC chain verification tests | MVP-B |
| Assembler rollback tests | MVP-C |
| ConflictReport tests | MVP-C |

---

## Out of MVP Scope

The following features are explicitly out of MVP scope. Agents must not design, implement, or scope them during MVP phases.

### Explicitly Rejected (Cannot Reintroduce Without ADR)

| Feature | Reason | Decision |
|---------|--------|----------|
| CLI-only MVP | Lacks observability and control surface for safe autonomous execution | D-015 (REJECTED) |
| Old pi/web-ui reuse | Overfit to old project; wrong architectural assumptions | D-014 (REJECTED) |
| Full pi/ migration | Would import old coupling, wrong architecture, unneeded packages | D-051 (REJECTED) |
| Cloud dashboard | PRAXIS is local-first; cloud is future consideration | D-013 (REJECTED) |
| WebSocket protocol | HTTP + SSE sufficient for MVP | D-025 (REJECTED) |
| Worker self-report as completion | Violates Law 1 | D-028 (REJECTED) |
| UI-owned completion | Violates Law 1; interface must not decide completion | D-029 (REJECTED) |
| Agent-generated acceptance criteria | Violates Law 3 | D-035 (REJECTED) |
| Root `src/` directory | Top-level directories are domain boundaries | D-018 (REJECTED) |

### Deferred to Post-MVP (Not in MVP, Not Rejected)

| Feature | Reason | Target |
|---------|--------|--------|
| Production visual polish | Correctness and observability before polish | P6 |
| Installer / packaging | Needs stable product first | P6 |
| Cloud dashboard (optional) | Local-first is primary; cloud is supplementary | Post-MVP |
| CLI improvements (full command set) | Desktop is primary; CLI extended in P6 | P6 |
| stable_6, stable_8, stable_12, stable_16 concurrency | Scaled from stable_3 baseline after proving stability | Post-MVP |
| Full semantic conflict detection | Basic detection in MVP-C; full analysis deferred | Post-MVP |
| Multi-user support | Local-first single-operator model for MVP | Post-MVP |
| Plugin / extension system | Not needed for core safety model | Post-MVP |
| Web dashboard (browser-based) | Desktop is primary; web optional later | Post-MVP |
| OpenCode adapter | Claude Code first; additional adapters later | Post-MVP |
| Local model adapter | Claude Code first; local models later | Post-MVP |
| FVR/PRR ACCP artifacts | Deferred to P6 per D-042, D-043 | P6 |
| Playwright e2e tests | Full e2e suite in P6 | P6 |
| Long-run stability baseline | Requires continuous operation measurement | P6 |

---

## Interface Priority

### Desktop Mission Control is Primary

The Desktop Mission Control (Electron + React) is the **primary operator interface** for PRAXIS. This is a HARD_LOCK decision (D-002, D-063).

All operator workflows -- plan admission, task monitoring, evidence inspection, gate verdict review, human action resolution -- are designed for the desktop first.

### CLI is Secondary

The CLI (`praxis`) is a **secondary interface**. It provides quick status checks and basic commands for operators who prefer terminals, but it is not the primary control surface.

CLI scope in MVP:
- `praxis status` -- quick system status
- `praxis runs` -- list task runs
- `praxis run <id>` -- task run detail
- `praxis admit <plan>` -- admit a plan from file

CLI does NOT need to replicate all desktop functionality in MVP.

---

## Desktop Mission Control -- Detailed Scope

### Panel Descriptions

#### Mission Control Dashboard
The main landing view. Shows system-level summary: runtime status, active workers count, circuit breaker state, governor tier, recent task run statuses, pending human actions count. Acts as the operator's "at a glance" view.

#### Runtime State Viewer
Shows the current RuntimeSnapshot: runtime version, status, governor tier, active/max workers, circuit breaker state, event sequence number. Updates via SSE on state changes.

#### TaskRun List
Table of all task runs with columns: run ID, task ID, wave, worker, FSM state, current attempt, last gate verdict, duration. Sortable and filterable. Click to open detail view.

#### TaskRun Detail
Full detail for a single task run: FSM state history, all attempts with their gate verdicts, evidence records, transcript preview, acceptance criteria status, repair attempts if any. Tabbed or collapsible sections.

#### Worker Grid
Grid showing each worker: worker ID, adapter kind, status (idle/running/crashed), current task run, workspace path, uptime, last health check. Color-coded status indicators.

#### Evidence / Log Stream
Real-time scrolling event stream. Shows: evidence records appended, gate verdicts issued, FSM state transitions, circuit breaker transitions, worker status changes, human actions created. Filterable by type, task run, worker. Searchable.

#### Gate Verdicts
Dedicated panel or section showing gate results for the selected attempt: EvidenceGate verdict (PASS/HOLD/FAIL) with reason, ExecGate verdict with test output summary, FinalGate verdict with acceptance criteria evaluation. Color-coded: green (PASS), yellow (HOLD), red (FAIL).

#### Circuit Breaker Status
Panel showing: current state (CLOSED/OPEN/HALF_OPEN) with large color-coded indicator, opened at timestamp, opened reason, diagnostic snapshot (failure rate, top failing gates, governor state, EHC classification), probe status (if HALF_OPEN). Action buttons: Reset (to HALF_OPEN), Probe (if HALF_OPEN and no active probe).

#### Governor Status
Panel showing: current tier (stable_3/6/8/12/16), active workers, max workers, clean operation window progress, last demotion reason and timestamp, tier history.

#### Human Action Queue
List of pending human actions: HIR requests (task stuck, needs human hint), conflict resolutions (assembly conflict, choose resolution strategy), circuit breaker override confirmations. Each item shows: type, task run, created at, description, available actions. Actions: resolve, dismiss, provide hint.

#### Plan Composer
Interface for creating or uploading a PlanSpec. Shows: plan structure, task list, namespace assignments, dependency graph visualization, budget summary. Validate button runs PSAG checks client-side (schema, namespace collisions, dependency cycles). Admit button sends to server.

#### Assembler View (MVP-C)
Shows wave assembly status: which wave is being assembled, task run statuses within the wave, namespace recheck results, semantic check results, patch preview. ConflictReport display with affected files and workers.

---

## Stack Summary

| Layer | Technology | Status |
|-------|-----------|--------|
| Operator UI | Electron + React + Tailwind + Radix UI + TanStack Query + Zustand | SOFT_LOCK (D-064) |
| Runtime Server | Bun + Hono + SSE | SOFT_LOCK |
| Storage | PostgreSQL + Kysely + raw SQL migrations | SOFT_LOCK (D-092, D-093) |
| Language | TypeScript strict | SOFT_LOCK |
| Package Management | Bun workspaces | SOFT_LOCK |
| Validation | Zod | SOFT_LOCK |
| Lint/Format | Biome | SOFT_LOCK |
| Testing | Vitest + Playwright (e2e) | SOFT_LOCK |

---

## CLI Scope (Secondary)

The CLI is secondary to Desktop Mission Control. It provides quick terminal-based access for operators who prefer it, but does not replace the desktop for primary operation.

### MVP CLI Commands

```
praxis status              Show runtime status, governor tier, CB state
praxis runs                List task runs (table format)
praxis runs --state REPAIR  Filter by FSM state
praxis run <id>            Show task run detail (text format)
praxis run <id> --json     Show as JSON
praxis logs <id>           Show recent evidence/log entries
praxis admit <file>        Admit a PlanSpec from YAML/JSON file
praxis conflicts           List unresolved assembly conflicts
```

### Post-MVP CLI Commands (P6)

```
praxis runtime start       Start the runtime server
praxis runtime stop        Stop the runtime server
praxis runtime logs        View runtime server logs
praxis wave <id>           Show wave detail
praxis workers             List active workers
praxis cb reset            Reset circuit breaker
praxis cb probe            Start circuit breaker probe
```

---

## Post-MVP Roadmap

After MVP-C is complete, P6 adds production hardening:

1. **Production build** -- Desktop app packaged for Linux, macOS, Windows
2. **Installer** -- One-click install. Distribution method TBD (Homebrew, npm, standalone binary)
3. **CLI improvements** -- Full command set, better formatting, JSON output for scripting
4. **ACCP artifacts** -- FVR per TaskRun, PRR per wave, async generation
5. **Durable storage** -- PostgreSQL with migration management, runtime event replay, restart recovery
6. **Visual polish** -- Refined UI, animations, accessibility, keyboard shortcuts
7. **Long-run stability** -- 48h+ continuous operation testing, stability metrics, performance baseline
8. **E2e tests** -- Playwright suite covering full operator workflows
9. **Documentation** -- User guide, operator manual, architecture reference

### Optional Post-MVP (Not Committed)

- Cloud dashboard (optional supplement to local desktop)
- WebSocket protocol (if SSE proves insufficient at scale)
- Additional worker adapters (OpenCode, local models)
- Multi-user support
- Plugin/extension system
- stable_6 through stable_16 concurrency tiers (progressive scaling)
- Full semantic conflict detection

---

## MUST / MUST NOT Rules

### MUST

- MUST include Desktop Mission Control in all MVP stages (MVP-A, MVP-B, MVP-C).
- MUST treat Desktop as the primary operator interface.
- MUST support mock runtime first (MVP-A) before real workers.
- MUST support single real worker (MVP-B) before parallel workers (MVP-C).
- MUST display all gate verdicts, Circuit Breaker state, and Governor state in Mission Control.
- MUST use HTTP + SSE for communication in MVP (no WebSocket).
- MUST bind runtime server to 127.0.0.1 only.
- MUST use Electron + React for Desktop Mission Control.
- MUST NOT let UI decide completion.

### MUST NOT

- MUST NOT build a CLI-only MVP.
- MUST NOT build a cloud dashboard in MVP.
- MUST NOT reuse old `pi/web-ui` code.
- MUST NOT do a full `pi/` migration.
- MUST NOT start real worker integration before mock runtime proof (MVP-A).
- MUST NOT start parallel workers before single worker proof (MVP-B).
- MUST NOT include production visual polish in MVP (correctness first).
- MUST NOT include WebSocket in MVP.
- MUST NOT expose runtime server on public network interfaces.

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Desktop omitted from MVP | No operator observability. Unsafe autonomous execution. | HARD_LOCK D-002. Desktop is mandatory in all MVP stages |
| CLI-only MVP built | Operators cannot supervise workers effectively. No real-time visibility. | D-015 REJECTED. Desktop mockup (MVP-A) proves the UI before any real worker runs |
| Real workers before mock proof | Adapter bugs and UI bugs interleave; undebuggable | MVP-A (mock) -> MVP-B (single real) -> MVP-C (parallel). Sequential staging |
| Parallel workers before single worker proof | Parallelism bugs interact with adapter bugs | MVP-B single worker must pass before MVP-C parallel workers |
| Cloud features added in MVP | Distracts from local-first core. Adds network dependency. | D-013 REJECTED. Cloud is post-MVP and optional |
| Production polish prioritized over correctness | Pretty UI with broken safety model | D-012. Correctness and observability before polish |
| Old pi/web-ui reused | Wrong architecture imported. | D-014 REJECTED. Desktop written from scratch |

---

## Test / Gate Implications

- **MVP-A Gate:** Desktop opens. All panels render with mock data. UI displays state only.
- **MVP-B Gate:** Real Claude attempt completes pipeline. False-done caught. Gate verdicts correct.
- **MVP-C Gate:** Three workers run in parallel. Assembler integration correct. CB opens on cascade.

Each MVP stage gate is a hard checkpoint. Do not proceed to the next stage until the current stage gate passes.

---

## Decision Compliance Checklist

- [x] Desktop Mission Control is MVP and main control panel (D-002)
- [x] Basic Electron operator shell in scope (D-003)
- [x] Mission Control dashboard in scope (D-004)
- [x] Runtime state viewer in scope (D-005)
- [x] TaskRun list/detail in scope (D-006)
- [x] Worker grid in scope (D-007)
- [x] Evidence/log stream in scope (D-008)
- [x] Gate verdicts in scope (D-009)
- [x] Circuit Breaker / Governor status in scope (D-010)
- [x] Human action queue in scope (D-011)
- [x] Production polish not MVP-critical (D-012)
- [x] Cloud dashboard out of MVP (D-013)
- [x] Old pi/web-ui reuse rejected (D-014)
- [x] CLI-only MVP rejected (D-015)
- [x] PRAXIS is local-first (D-001)
- [x] HTTP + SSE is MVP communication model (D-025)
- [x] Full pi/ migration rejected (D-051)
- [x] P0 is Selective pi/ Reuse Foundation Port (D-044)
- [x] Circuit Breaker is kernel-owned (D-084)
- [x] Desktop is primary, CLI is secondary (D-063)
- [x] No root src/ directory (D-018)

---

## Open Questions

1. **Should Monaco Editor and xterm.js be in MVP-A or MVP-B?** MVP-A has mock data, so code/terminal views would show mock content. Defer to P1 desktop mockup design.
2. **What is the exact desktop window layout?** Tabbed? Sidebar + main panel? Multiple windows? Defer to P1 mockup exploration.
3. **Should the desktop auto-start the runtime server?** Tentative: yes. Desktop checks for running server, spawns if needed, waits for health endpoint, then connects.
4. **What is the CLI distribution model?** Single binary via Bun compile? npm package? Defer to P6 installer spike.
5. **Should MVP-A include a plan composer or just viewer?** Viewer first (view mock plans). Composer in MVP-B (admit real plans).
6. **What is the exact PostgreSQL setup automation approach?** OPEN decision (O-008). Spike needed.

---

## Audit Notes

- This product scope document is derived from D-001 through D-015 (MVP Scope Decisions) and D-052 through D-061 (Phase Model Decisions) in `docs/decisions.md`.
- The MVP staging (MVP-A, MVP-B, MVP-C) is defined in `docs/decisions.md` Section 19 and expanded here with detailed feature lists.
- The "Out of MVP -- Explicitly Rejected" table is particularly important: it prevents agents from reintroducing decisions that were already considered and rejected.
- Desktop Mission Control panel descriptions are aspirational during P-1. Exact layout, component tree, and UX flow will be refined during P1 mockup development.
