# PRAXIS / Pi — Project State

> This file is maintained by agents on every change. Read first each session.

---

## Identity

| Field | Value |
|-------|-------|
| Project | PRAXIS v2.0 |
| Root | `/home/erfolg/src/praxis` |
| Purpose | Parallel Runtime for Autonomous eXecution with Integrated Safety |
| Concept | A local-first execution platform that runs AI coding workers (Claude Code, OpenCode, local models) in isolated workspaces, captures what they actually did, verifies outputs through deterministic gates, repairs failures with structured strategies, and assembles verified patches safely |
| Status | Architecture ~80% designed, implementation 0% — currently in P-1 (decision lock) / P0 (foundation port) planning |
| Pi reference | `pi/` contains the old Pi monorepo — reference and selective port source, NOT the active codebase |

---

## The Three Laws (Hard Locks — not negotiable)

```
LAW 1 — COMPLETION AUTHORITY
         Agent says done ≠ done.
         Truth Engine FinalGate PASS = done.
         Nothing else counts.

LAW 2 — WRITE AUTHORITY
         No worker writes to shared integration files.
         The Deterministic Assembler is the only shared writer.

LAW 3 — VERIFICATION AUTHORITY
         FinalGate acceptance criteria comes from human-authored TaskSpec.
         An agent cannot define or verify its own completion criteria.
```

---

## Architecture Overview

### Directory Layout

```
praxis/
├─ kernel/         # Pure execution brain: FSM, PSAG, Evidence, Truth Engine, RIM, Governor, Circuit Breaker, Assembler, ACCP
├─ adapters/       # External worker integrations: Claude Code, OpenCode, local models
├─ hooks/          # Hook binaries called from external tools (esp. Claude Code Pre/PostToolUse)
├─ server/         # Local runtime server: control plane, storage, events, telemetry
├─ interface/      # Human-facing clients: CLI, desktop UI, typed client, UI core
├─ lib/            # Shared contracts and utility foundation
│   └─ contracts/  # @praxis/contracts — ported from pi/ execution-contracts
├─ tests/          # Cross-package tests and e2e suites
├─ examples/       # Example plans, TaskSpecs, fixture repos
├─ docs/           # Architecture, ADRs, specs, roadmap
└─ scripts/        # Repo automation
```

### 11 Components (from README.md)

```
┌─────────────────────────────────────────────────────────────────────┐
│  PSAG — PlanSpec Admission Gate                                      │
│  (schema, namespace collision, budget, deps, acceptance_criteria)    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ ADMIT
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Auto Executor Kernel — FSM, Queue, Workspace Manager, Governor     │
│  (lifecycle: DORMANT → QUEUED → WORKSPACE_INIT → RUNNING → ...)    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
    [Worker A]            [Worker B]            [Worker C]
    namespace_a           namespace_b           namespace_c
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Worker Adapter Layer — Claude Code CLI/SDK, OpenCode, local models │
│  (normalizes all worker output → AttemptManifest)                   │
└───────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PRAXIS Hook Layer — intercepts ALL Claude Code tool events         │
│  pre-tool/post-tool/stop → KernelOwnedTranscript                    │
│  divergence check: hook result ≠ claude-reported result             │
└───────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Attempt Capture + Evidence Hash Chain                              │
│  stdout/stderr, transcript, exit codes, git diff, timestamps        │
│  sha256 chain → EHCBreakClassifier (NOISE/SUSPECTED/CONFIRMED)     │
└───────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Circuit Breaker — CLOSED → OPEN → HALF-OPEN                        │
│  triggers: failure_rate > 30%/10min, governor_RED > 15min,          │
│            EHC break = CONFIRMED                                    │
└───────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Truth Engine — EvidenceGate → ExecGate → FinalGate                 │
│  PASS / HOLD / FAIL                                                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HOLD
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RIM — Repair Intelligence Module                                   │
│  6 strategies: initial, context_expand, tool_restrict, scope_narrow,│
│  knowledge_inject, hint_inject → ABORT @ attempt 7                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ PASS (all workers done)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Adaptive Concurrency Governor — stable_3 → 6 → 8 → 12 → 16       │
│  (each tier: 48h consecutive clean operation)                       │
└───────────────────────────┬─────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Deterministic Assembler — namespace recheck, semantic check,       │
│  atomic apply, rollback → ConflictReport                           │
└───────────────────────────┬─────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ACCP Artifact Layer — ALWAYS ASYNC                                 │
│  FVR per TaskRun, PRR per wave                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### TaskRun FSM

```
DORMANT → QUEUED → WORKSPACE_INIT → RUNNING → CAPTURING → VERIFYING → COMPLETE
                                          ↓                              ↓
                                       ABORTED                       REPAIR → RUNNING (loop)
                                                                        ↓
                                                                     ABORTED (@ attempt 7)
```

Terminal states: `COMPLETE` (FVR enqueued), `ABORTED` (evidence preserved), `FAILED` (human review).

---

## Phase & Milestone Status

| # | Phase | Scope | Status |
|---|-------|-------|--------|
| P-1 | Architecture / Reuse Decision Lock | ADRs, lock matrix, reuse policy, Circuit Breaker section | ~11% |
| P0.1 | Monorepo Scaffold + CI | Bun workspace, tsconfig, package skeletons, CI | 0% |
| P0.2 | Port execution-contracts → lib/contracts | ACCP types, WorkerAdapter, runtime types | 0% |
| P0.3 | Port accp-compiler → kernel/accp | Compiler pipeline, validators, CLI, 135 tests | 0% |
| P0.4 | Extract old FSM reference doc | Document old patterns, coupling risks, rewrite recommendations | 0% |
| P1 | Desktop Mission Control + Runtime Contracts | RuntimeSnapshot, RuntimeEvent contracts, mockup | 0% |
| P2 | Mock Runtime Vertical Slice | event-bus, control-plane, mock worker, SSE, connect UI | 0% |
| P3 | Kernel Safety Core | FSM, PSAG, evidence, Truth Engine, Circuit Breaker, tests | 0% |
| P4 | Real Worker Integration | Claude Code hook/adapter, Day 0 spike, KernelOwnedTranscript | 0% |
| P5 | Parallel Execution + Assembler | Namespace locks, wave scheduler, Governor, atomic assembly | 0% |
| P6 | ACCP Artifacts + Production Hardening | Async job queue, FVR/PRR, PostgreSQL, CLI, packaging | 0% |

**Overall implementation progress:** 0%
**Overall planning/architecture progress:** ~25%
**P0 Gate progress:** 0%

### Quick Reference — Next Actions

```
1. [P-1] ADR-000: pi reuse policy
2. [P-1] Architecture lock matrix
3. [P-1] Circuit Breaker section → README
4. [P0.1] Monorepo scaffold
5. [P0.2] Contracts port
```

See `todo.md` for full task-level tracking.

---

## File Map

### Root Level — PRAXIS Design

| Path | Type | Purpose | Notes |
|------|------|---------|-------|
| `README.md` | Design | PRAXIS v2.0 full architecture — 3 laws, 11 components, ADRs, roadmap, scoring | 1931 lines, canonical |
| `architecture.md` | Design | Architecture baseline v0.2 — product model, boundaries, directory layout | 52K |
| `todo.md` | Tracking | Implementation todo list — all phases, tasks, checkboxes, progress formulas | Current state source |
| `ai_summary.md` | Meta | This file — project state maintained by agents | Active |
| `CLAUDE.md` | Meta | Agent instructions: read ai_summary.md first, update on changes | Active |
| `reports/` | Reports | ACCP readiness reports (pi_reuse_readiness, architecture_lock_readiness) | ACCP YAML |
| `pi/` | Archive | Old Pi monorepo — reference and selective port source | See below |

### `pi/` — Reference Archive

The Pi monorepo is NOT the active codebase. Selected packages are ported to PRAXIS; the rest is forbidden to copy. This directory structure is documented so agents understand the reference boundaries.

#### Forbidden to Copy (reference only)

```
pi/packages/coding-agent/   — Core execution engine (plan parser, scheduler, worktree, brain P13-P20, etc.)
pi/packages/ai/             — AI provider abstraction (prompt caching, OAuth, providers)
pi/packages/web-server/     — Fastify server (REST API, SSE, WebSocket)
pi/packages/web-ui/         — React + Vite dashboard
pi/packages/db/             — PostgreSQL persistence
pi/packages/worker-adapters/
pi/packages/execution-service/
pi/packages/tui/
```

#### Reference Only (design patterns)

```
pi/packages/execution-runtime/  — FSM, completion predicate, state authority, deadline watchdog
```

#### Approved for Port (with adaptation)

| Source | Target | Contents |
|--------|--------|---------|
| `pi/packages/execution-contracts/` | `lib/contracts/` | ACCP types, WorkerAdapter interface, runtime event types |
| `pi/packages/accp-compiler/` | `kernel/accp/` | Compiler pipeline, YAML parser, 24-type registry, validators, CLI, 135 tests |

#### Other `pi/` Contents (documentation, not to port)

| Path | Purpose |
|------|---------|
| `pi/AGENTS.md` | Development rules — commit format, testing, parallel agent safety |
| `pi/CONTRIBUTING.md` | Contribution guidelines |
| `pi/ai_summary.md` | Legacy detailed file analysis (1500+ lines) |
| `pi/dashboard_summary.md` | Dashboard architecture — comprehensive UI component map |
| `pi/scripts/` | Utility scripts (diagnostics, profiling, testing helpers) |
| `pi/reports/` | Execution reports (P23 progress, hotfix reports) |
| `pi/docs/` | Reference docs (findings, template, proposals, stability reports) |
| `pi/test-fixtures/` | E2E test fixtures |
| `pi/.github/` | Workflows (issue/PR gates, CI) |

---

## Key Contracts & Types (from README.md)

### TaskSpec (required by PSAG)

```typescript
interface TaskSpec {
  task_id: string;
  wave: number;
  namespace: string[];            // exclusive file paths this worker owns
  task_type: 'code' | 'docs' | 'test' | 'shared_package';
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  criteria_source: 'human';       // 'generated' → PSAG REJECT
  budget: TaskBudget;
  dependencies: string[];
  predicted_interfaces?: PredictedInterface[];
}
```

### AcceptanceCriterion

```typescript
interface AcceptanceCriterion {
  id: string;
  description: string;
  verification_type: 'file_exists' | 'test_passes' | 'command_output' | 'diff_contains' | 'no_diff_contains';
  verification_detail: string;
  required: boolean;
}
```

### Evidence Hash Chain

```typescript
interface EvidenceRecord {
  id: string;
  attempt_id: string;
  worker_id: string;
  timestamp_ns: bigint;
  source: 'kernel_hook' | 'git' | 'filesystem' | 'divergence_detector';
  kind: 'pre_tool' | 'post_tool' | 'diff' | 'file_change' | 'divergence';
  content: string;
  content_hash: string;
  chain_hash: string;    // sha256(prev_chain_hash + content_hash)
}
```

### Circuit Breaker States

```
CLOSED → OPEN → HALF-OPEN → CLOSED

OPEN triggers:
  - failure_rate > 30% in 10min sliding window
  - governor_RED continuous > 15min
  - EHC break classified as CONFIRMED
```

### Concurrency Governor Tiers

| Tier | Workers | Requirement |
|------|---------|-------------|
| stable_3 | 3 | 48h clean operation |
| stable_6 | 6 | stable_3 + 48h clean |
| stable_8 | 8 | stable_6 + 48h clean |
| stable_12 | 12 | stable_8 + 48h clean |
| stable_16 | 16 | architecture review |

### RIM Strategy Rotation

| Attempt | Strategy | What changes |
|---------|----------|-------------|
| 1-2 | initial | Standard repair packet |
| 3 | context_expand | Read 5+ related files, import graph |
| 4 | tool_restrict | 4a: read-only analysis, 4b: write enabled |
| 5 | scope_narrow | Single failing criterion only |
| 6 | knowledge_inject or hint_inject | Docs/human hint |
| 7 | ABORT | Budget exhausted |

---

## Commands Reference

### Current repo (PRAXIS planning phase — no build yet)

```bash
# View recent history
git log --oneline -10

# View current branch/status
git status
git branch
```

### Pi reference (for porting context)

```bash
# From pi/ directory:
npm run check    # TypeScript + lint check (not tests)
bun test         # Run tests (from package root, not repo root)
npx vitest run test/specific.test.ts   # Single test file
```

### Planned PRAXIS commands (after P0.1)

```bash
bun install
bun run typecheck
bun test
bun run check        # typecheck + lint + format
bun run test-full    # all tests including e2e
make test
make test-full
```

---

## Git History

```
cacc073  update todo                                     (2026-06-17)
92ed8a1  Add Circuit Breaker architecture as kernel-owned safety component v0.2
311ad17  Add architecture baseline document v0.1
b055fbc  Initial commit
```

---

## Key Architecture Decisions (ADRs)

| ADR | Decision | Rationale |
|-----|----------|-----------|
| 001 | ACCP is always async | Prevents execution deadlock at speed of own success |
| 002 | Assembler is wave-level only | Per-task assembly breaks parallelism |
| 003 | stable_16 is concurrency ceiling | "Unbounded" is an accident, not a milestone |
| 004 | acceptance_criteria is human-authored only | Prevents echo chamber (LAW 3) |
| 005 | Claude Code NO-GO → Messages API fallback | If hooks unreliable, fallback to custom agent loop |

---

## Design Lock Summary

| Lock level | Definition | Items |
|------------|-----------|-------|
| HARD | Changing requires ADR | 14 items locked (3 laws, directory boundaries, async ACCP, etc.), 1 pending (Circuit Breaker as kernel-owned) |
| SOFT | Can evolve during implementation | 9 items (package names, FSM state names, test runner coverage, etc.) |
| OPEN | Needs discovery/spike | 7 items (hook reliability, rate-limit ceiling, desktop UX, etc.) |

Full tracking in `todo.md`.

---

## Forbidden Copy List

These packages must NOT be copied into PRAXIS:

- `pi/packages/coding-agent`
- `pi/packages/ai`
- `pi/packages/db`
- `pi/packages/web-server`
- `pi/packages/web-ui`
- `pi/packages/tui`
- `pi/packages/worker-adapters`
- `pi/packages/execution-service`
- Old runtime controller code coupled to DB/Kysely

---

## Recent Changes

| Date | Files | Summary |
|------|-------|---------|
| 2026-06-17 | `CLAUDE.md`, `ai_summary.md` | Initial agent documentation baseline |
| 2026-06-17 | `todo.md`, `reports/*.yaml` | Update todo with full phase tracking, add ACCP readiness reports |

---

## Known Issues

- **Environment mismatch**: `pi/AGENTS.md` references macOS paths and tmux commands — not applicable to this Linux environment
- **No monorepo scaffold**: Cannot run `bun install` or `bun test` at root yet — P0.1 needed
- **Legacy ai_summary.md**: `pi/ai_summary.md` has 1500+ lines of auto-generated file analysis that may be stale
- **Circuit Breaker not in README**: Architecture README needs Circuit Breaker section applied (pending)

---

## Active Work

- (none — establishing documentation baseline)

---

## Quick Reference

```
Completion authority?       →  Truth Engine FinalGate. Never Claude.
Shared file writer?         →  Deterministic Assembler. Only.
Completion criteria source? →  TaskSpec (human). Never agent.
Command transcript source?  →  PRAXIS Hook Layer (kernel). Never worker.
Bad plan detection?         →  PSAG. Before any work starts.
Cascade protection?         →  Circuit Breaker.
Repair learning?            →  RIM (6 strategies + structured signature).
Token cost tracking?        →  Resource Governor.
Shared package conflict?    →  PredictedInterface + exclusive lock.
Rollback recovery?          →  ConflictReport → RepairPacket v2.
ACCP sync?                  →  Never. Always async.
Worker self-report?         →  Never trusted. Divergence flagged.
Concurrency ceiling?        →  stable_16. Architecture review to go higher.
```
