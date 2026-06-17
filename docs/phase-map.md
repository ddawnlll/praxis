# Phase Map

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the canonical P-1 through P6 phase model for PRAXIS v2.0, including gates, dependencies, parallelization rules, and old-phase-label mapping.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document is the canonical phase map for PRAXIS v2.0. It defines:

- **What each phase produces** -- deliverables and acceptance criteria.
- **Phase gates** -- what must pass before the next phase can start.
- **Allowed parallelism** -- which tasks can run concurrently within and across phases.
- **Do-not-start list** -- components that must not begin before their gate conditions are met.
- **Old-phase-label mapping** -- how deprecated Phase 0/1/2/3 labels relate to the canonical P-1/P0/P1-P6 model.

---

## Scope

Covers all phases from P-1 (decision lock) through P6 (production hardening). This is a planning and governance document, not an implementation tracker. For task-level tracking, see `todo.md`.

---

## Non-Goals

- This document does **not** track implementation progress. See `todo.md`.
- This document does **not** define the detailed scope of individual components. See `docs/product-scope.md` for MVP staging and `architecture.md` for component boundaries.
- This document does **not** replace `docs/decisions.md` as the decision authority. Phase definitions are derived from decisions, not the other way around.

---

## Authoritative Decisions Used

| Decision ID | Summary | Source |
|-------------|---------|--------|
| D-052 | P-1 through P6 is the canonical phase model | `docs/decisions.md` |
| D-053 | P-1: Lock/alignment/decision docs | `docs/decisions.md` |
| D-054 | P0: Selective pi/ Reuse Foundation Port | `docs/decisions.md` |
| D-055 | P1: Pipeline docs, runtime contracts, Desktop Mission Control mockup/basic shell | `docs/decisions.md` |
| D-056 | P2: Mock runtime vertical slice | `docs/decisions.md` |
| D-057 | P3: Kernel safety core | `docs/decisions.md` |
| D-058 | P4: Claude hook + adapter | `docs/decisions.md` |
| D-059 | P5: Parallel execution + assembler | `docs/decisions.md` |
| D-060 | P6: ACCP artifacts + production hardening | `docs/decisions.md` |
| D-061 | Old Phase 0/1/2/3 labels must be mapped to canonical phases | `docs/decisions.md` |
| D-110 | P0 gate must pass before P2/P3/P4 implementation | `docs/decisions.md` |
| D-112 | P0 can be partially parallelized | `docs/decisions.md` |
| D-113 | Safe parallel tasks: P0.1 scaffold, P0.4 FSM ref doc, Day 0 Spike, P-1 doc alignment | `docs/decisions.md` |
| D-114 | P0.2 contracts port should follow scaffold | `docs/decisions.md` |
| D-115 | P0.3 accp-compiler port should follow stable contracts shape | `docs/decisions.md` |
| D-116 | Do not start server/runtime, kernel/core, real Claude adapter, assembler, desktop real runtime connection before gates | `docs/decisions.md` |

---

## Conceptual Model

The PRAXIS phase model is a staged dependency chain:

```
P-1  -->  P0  -->  P1  -->  P2  -->  P3  -->  P4  -->  P5  -->  P6
         (P0 sub-phases 0.1 -> 0.2 -> 0.3, with 0.4 parallel-safe)
                |
          P0 Gate (must pass before P2/P3/P4)
```

Each phase has a gate. The gate must pass before the next phase can begin meaningful implementation work. Some tasks within a phase can be parallelized; some tasks from adjacent phases have limited overlap (see Allowed Parallelism section).

---

## Phase Definitions

### P-1 -- Lock / Alignment / Decision Docs

**Goal:** Freeze core decisions before any implementation begins. Prevent agents from copying old architecture into PRAXIS.

**Produces:**
- `docs/decisions.md` (canonical decision register) -- COMPLETE
- `docs/adr/README.md` (ADR index, resolves numbering collision) -- THIS DOC
- `docs/phase-map.md` (this file) -- THIS DOC
- `docs/product-scope.md` (MVP staging) -- COMPANION DOC
- Architecture lock matrix (HARD/SOFT/OPEN classification)
- pi/ reuse policy lock
- Forbidden-copy list formalization

**Acceptance criteria:**
- [x] `docs/decisions.md` exists and is authoritative
- [ ] `docs/adr/README.md` exists
- [ ] `docs/phase-map.md` exists
- [ ] `docs/product-scope.md` exists
- [ ] Lock matrix exists
- [ ] Reuse policy is locked
- [ ] All future ACCP prompts include reuse policy constraints
- [ ] No future plan says "migrate old repo" without qualifying "selective port"

**Gate:** P-1 is complete when all decision documents are written, reviewed, and consistent with each other. Decisions.md must have no unresolved conflicts with architecture.md or ADR files.

---

### P0 -- Selective pi/ Reuse Foundation Port

**Goal:** Port only proven reusable foundations from the old `pi/` monorepo. Do NOT migrate the whole repo.

**Sub-phases:**

#### P0.1 -- Monorepo Scaffold + CI

**Produces:**
- Bun workspace configuration
- Root `package.json`, `tsconfig.base.json`
- Package skeletons for all top-level directories
- `bun install`, `bun run typecheck`, `bun test` working
- Lint/format check (Biome)
- Dependency boundary checker
- CI workflow (GitHub Actions)

**Gate:** Clean checkout installs and passes all checks. No root `src/`. Boundary checker catches forbidden imports.

#### P0.2 -- Contracts Port

**Produces:**
- `lib/contracts` package with ported and adapted types from `pi/packages/execution-contracts`
- ACCP types, WorkerAdapter interface, runtime event types
- All `@earendil-works/*` namespace replaced with `@praxis/*`
- Old-project-specific types removed
- Ported tests passing
- No business logic in contracts package
- No dependency on kernel/server/interface/adapters/hooks

**Gate:** `@praxis/contracts` exports stable. All ported tests pass. Contracts importable by all layers.

#### P0.3 -- ACCP Compiler Port

**Produces:**
- `kernel/accp` package with ported compiler pipeline from `pi/packages/accp-compiler`
- YAML parser, extractor, schema validator, evidence validator, gate evaluator (as ACCP primitive)
- 135 ported tests passing
- All old imports replaced with `@praxis/contracts`
- Deterministic output preserved
- ACCP layer remains async/non-blocking

**Gate:** All ported tests pass. No import from `pi/`. No `@earendil-works` namespace. ACCP gate evaluator is not treated as Truth Engine.

#### P0.4 -- FSM Reference Doc

**Produces:**
- `docs/reference/old-pi-fsm-patterns.md`
- Documents old FSM states, transitions, deadline policies, completion predicate lessons
- Documents why old runtime is reference-only
- Documents DB/Kysely coupling risks
- Provides PRAXIS-specific rewrite recommendations

**Gate:** Reference doc exists. It clearly states old runtime must not be ported directly.

#### P0 Gate -- Reuse Foundation Gate

**Before P2/P3/P4 can begin:**
- [ ] `bun install` passes
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes
- [ ] `@praxis/contracts` exports stable
- [ ] `kernel/accp` tests pass
- [ ] No `@earendil-works` namespace remains
- [ ] No runtime import from `pi/`
- [ ] No forbidden packages copied
- [ ] Reuse policy ADR exists (ADR-006)
- [ ] Old FSM reference doc exists
- [ ] Boundary checker passes

**If P0 Gate fails:** Do not start P2, P3, or P4 implementation. Fix the gate failures first.

---

### P1 -- Pipeline Docs, Runtime Contracts, Desktop Mission Control Mockup/Basic Shell

**Goal:** Define the operator experience and runtime view model. Prove the UI can render realistic state without a real backend.

**Produces:**
- `RuntimeSnapshot` contract
- `RuntimeEvent` contract
- `TaskRunView`, `WorkerView`, `GateVerdictView`, `CircuitBreakerView`, `GovernorView`, `HumanActionView` contracts
- Contract docs (`docs/contracts/*.md`)
- Pipeline docs (`docs/pipelines/overview.md`, `docs/pipelines/taskrun-lifecycle.md`)
- Interactive desktop mockup (Electron + React shell)
- Mission Control dashboard with fake runtime data
- Plan List view, TaskRun Detail view, Worker Grid, Evidence/Logs panel, Human Action Queue, Circuit Breaker panel

**Acceptance criteria:**
- [ ] Mockup opens locally
- [ ] Mockup uses typed mock data
- [ ] UI displays state only (does not decide completion)
- [ ] Snapshot/event contracts are documented
- [ ] No backend dependency required

**Gate:** Desktop mockup renders all required panels with mock data. Contracts are documented and reviewed.

---

### P2 -- Mock Runtime Vertical Slice

**Goal:** Prove the full UI + runtime event model works end-to-end before real worker integration.

**Produces:**
- `server/event-bus` implementation
- `server/control-plane` minimal HTTP app (Hono)
- `GET /api/snapshot` endpoint
- `GET /api/events?after=<seq>` SSE endpoint
- In-memory runtime event log
- `interface/client` typed HTTP/SSE client
- Desktop connected to snapshot + SSE with mock data
- `adapters/mock-worker` with multiple simulation modes

**Acceptance criteria:**
- [ ] Desktop receives initial snapshot from server
- [ ] Desktop applies SSE events in sequence
- [ ] Sequence gap triggers snapshot refresh
- [ ] Mock worker events are visible in UI
- [ ] Gate verdict events are visible in UI
- [ ] Circuit Breaker state appears in dashboard
- [ ] No real Claude Code dependency exists

**Gate:** Full vertical slice works: server produces events, SSE streams them, desktop renders them. Mock worker simulates success, empty-diff, failing test, namespace violation, crash, rate limit.

---

### P3 -- Kernel Safety Core

**Goal:** Implement and prove the PRAXIS safety model with mock evidence. This is the heart of the system.

**Produces:**
- `kernel/core` TaskRun FSM (from scratch)
- `kernel/psag` minimal admission gate
- `kernel/evidence` minimal evidence model, EHC record, hash chain, EHCBreakClassifier
- `kernel/truth-engine` with EvidenceGate, ExecGate, FinalGate
- `kernel/circuit-breaker` with CLOSED/OPEN/HALF_OPEN states, all triggers
- `kernel/rim` basic strategy rotation
- TestOutputParser minimal parser
- False-done tests, namespace violation tests, empty diff tests, zero-test-ran tests
- Circuit Breaker transition tests

**Acceptance criteria:**
- [ ] Agent claim without diff does not complete
- [ ] Agent-generated checklist is rejected
- [ ] Missing human acceptance criteria is rejected
- [ ] Empty test suite does not pass ExecGate
- [ ] Namespace violation fails
- [ ] Confirmed evidence integrity failure opens Circuit Breaker
- [ ] Circuit Breaker OPEN rejects new admissions
- [ ] HALF_OPEN permits exactly one probe

**Gate:** All false-done scenarios caught. All gate logic correct. Circuit Breaker transitions tested. P3 is the most critical phase for PRAXIS safety.

---

### P4 -- Real Worker Integration (Claude Hook + Adapter)

**Goal:** Integrate real Claude Code only after the kernel safety core is proven with mock evidence.

**Precondition:** Day 0 Spike must return GO. If NO-GO, fall back to Messages API adapter path.

#### Day 0 Spike (can start during P-1/P0, gates P4 implementation)

**Verifies:**
- Claude Code headless mode behavior under PRAXIS supervision
- PreToolUse hook reliability
- PostToolUse hook reliability
- Stop hook reliability
- Divergence capture: hook result vs Claude-reported result
- Rate limit ceiling under autonomous operation

**Gate:** GO/NO-GO decision. GO = proceed with hook-primary adapter. NO-GO = fall back to Messages API custom agent loop (ADR-005).

#### P4 Implementation (after GO)

**Produces:**
- `hooks/praxis-hook` (PreToolUse, PostToolUse, Stop capture, local spool)
- `adapters/claude-code` (command builder, settings writer, hook installer, env builder, session runner, output normalizer, rate limit detector)
- KernelOwnedTranscript production
- Divergence detection
- Real attempt in isolated workspace

**Acceptance criteria:**
- [ ] One real Claude Code attempt runs in isolated workspace
- [ ] Hook events reach runtime server
- [ ] KernelOwnedTranscript is captured
- [ ] Real command output evaluated by ExecGate
- [ ] Empty diff false-done caught with real worker
- [ ] Rate limit symptom detected
- [ ] Worker crash normalized
- [ ] Adapter does not perform Truth Engine decisions

**Gate:** Real Claude attempt completes the full PRAXIS pipeline: admit -> run -> capture -> verify. False-done is caught. Divergence is detected.

---

### P5 -- Parallel Execution + Assembler

**Goal:** Safely run multiple workers with namespace isolation and deterministic assembly.

**Produces:**
- Workspace manager + namespace locks
- Plan queue + wave scheduler + dependency graph
- `kernel/governor` (stable_3 concurrency tier, demotion rules, clean operation window)
- `kernel/assembler` (namespace recheck, semantic signature extraction, callsite scanner, mismatch detector, atomic patch apply, rollback, ConflictReport)
- 3 mock workers running concurrently -> 3 real workers (after mock proof)

**Acceptance criteria:**
- [ ] 3 workers run in isolated workspaces
- [ ] Namespace collision rejected before execution
- [ ] Shared integration writes are assembler-only
- [ ] Assembler rollback restores previous state
- [ ] ConflictReport produced on assembly failure
- [ ] Governor demotes on instability
- [ ] Circuit Breaker opens on cascade failure
- [ ] Average parallelism measurable

**Gate:** Three workers run in parallel. Assembler produces correct integration. Rollback works on conflict. Governor tiers function.

---

### P6 -- ACCP Artifacts + Production Hardening

**Goal:** Produce audit artifacts and stabilize the product for real use.

**Produces:**
- ACCP async job queue + FVR builder/schema + PRR builder/schema
- FVR per TaskRun, PRR per wave
- PostgreSQL durable storage + runtime event replay
- Runtime restart recovery
- Worker cleanup on crash
- Hook spool replay
- Desktop production build
- Full CLI commands
- Installer / packaging
- Playwright e2e tests
- Long-run stability baseline
- Documentation cleanup

**Acceptance criteria:**
- [ ] ACCP does not block execution critical path
- [ ] FVR and PRR generated asynchronously
- [ ] Runtime recovers after restart
- [ ] Desktop works in production build
- [ ] Full e2e suite passes
- [ ] Long-run stability baseline exists

**Gate:** Production readiness. All e2e tests pass. Stability baseline meets thresholds.

---

## Phase Gates Summary

| Phase | Gate Name | What Must Pass | Blocks |
|-------|-----------|----------------|--------|
| P-1 | Decision Lock | All decision docs consistent. No conflicts between decisions.md, architecture.md, ADR index. | P0+ |
| P0.1 | Scaffold | `bun install`, `bun run typecheck`, `bun test` pass. No root `src/`. | P0.2+ |
| P0.2 | Contracts | `@praxis/contracts` stable. Ported tests pass. No old namespace. | P0.3+ |
| P0.3 | ACCP Compiler | All 135 tests pass. No `pi/` imports. | P0 Gate |
| P0.4 | FSM Reference | Doc exists. Clearly marks old runtime as reference-only. | P0 Gate (parallel-safe) |
| P0 Gate | Reuse Foundation | All P0.1-P0.4 gates met. Boundary checker passes. | P2, P3, P4 |
| P1 | Desktop Mockup | Mockup opens. All panels render with mock data. | P2 (desktop connection) |
| P2 | Mock Runtime Slice | Full vertical slice: server -> SSE -> desktop. Mock worker simulates scenarios. | P3 (real kernel), P4 (real worker) |
| P3 | Kernel Safety Core | All false-done scenarios caught. Circuit Breaker transitions tested. | P4 (real worker), P5 (parallel) |
| Day 0 Spike | GO/NO-GO | Hook reliability, rate limit ceiling confirmed. | P4 (if NO-GO, fallback path) |
| P4 | Real Worker | Real Claude attempt completes full pipeline. False-done caught. | P5 (parallel real workers) |
| P5 | Parallel + Assembler | 3 workers run in parallel. Assembler produces correct integration. | P6 (production) |
| P6 | Production | All e2e tests pass. Stability baseline meets thresholds. | Release |

---

## Allowed Parallelism

### Within P-1 (safe to run concurrently)

```
All P-1 documents can be drafted in parallel:
  - docs/adr/README.md
  - docs/phase-map.md
  - docs/product-scope.md
No file overlap. No dependency on each other.
```

### Within P0 (partially parallel)

```
Safe parallel set:
  A: P0.1 Monorepo Scaffold + CI
  B: P0.4 FSM Reference Doc
  C: Day 0 Claude Spike
These have no file overlap.

Sequential dependencies:
  P0.1 -> P0.2 (contracts port needs scaffold)
  P0.2 -> P0.3 (ACCP compiler needs stable contracts shape)
```

### Across P-1 and P0

```
P-1 docs can finalize while P0.1 scaffold begins.
P-1 lock matrix and P0.4 FSM reference doc can run in parallel (no file overlap).
Day 0 Spike can run during P-1/P0.
```

### Across P1 and P2

```
P1 (desktop mockup) can overlap with early P2 (server scaffold).
P1 contract docs inform P2 API design, so P1 should be substantially complete before P2 API hardens.
```

### Across P2 and P3

```
P2 (mock runtime) and P3 (kernel safety core) can partially overlap:
  - P2 focuses on server/event-bus/control-plane
  - P3 focuses on kernel/core, kernel/evidence, kernel/truth-engine, kernel/circuit-breaker
  - P2 and P3 have no file overlap (server/ vs kernel/)
  - But: P3 truth-engine tests benefit from P2 mock worker, so P2 should be ready first
```

### Across P4 and P5

```
P4 (single real worker) must complete before P5 (parallel workers).
No overlap. Sequential dependency: single worker proof -> multi-worker scaling.
```

---

## Do-Not-Start List

The following components must NOT begin implementation before their gate conditions are met. Starting early produces rework, coupling, or architectural violations.

| Component | Earliest Start | Gate Condition |
|-----------|---------------|----------------|
| `server/runtime` | P2 | P0 Gate must pass |
| `kernel/core` (full FSM) | P3 | P0 Gate must pass, P2 mock runtime provides test harness |
| `kernel/truth-engine` (full) | P3 | P0 Gate must pass |
| `kernel/assembler` | P5 | P4 real worker must prove single-worker pipeline |
| Real Claude adapter (`adapters/claude-code`) | P4 | P3 safety core must pass. Day 0 Spike must return GO |
| `interface/desktop` real runtime connection | P2 | P1 mockup must prove UI design. P0 Gate must pass |
| `hooks/praxis-hook` implementation | P4 | Day 0 Spike GO. P3 safety core must pass |
| `kernel/governor` full implementation | P5 | P4 single real worker must prove stability baseline |
| PostgreSQL storage | P2-P3 | P0 Gate must pass. SOFT_LOCK on exact schema |
| ACCP async job queue | P6 | P5 parallel execution must prove assembly model |

---

## Old Phase Label Mapping

Earlier discussions used a Phase 0/1/2/3 labeling. These labels are deprecated and do NOT map 1:1 to the canonical P-1/P0/P1-P6 model.

**Deprecation rule:** Any document or prompt using "Phase 0", "Phase 1", "Phase 2", or "Phase 3" must be updated to use the canonical P-1/P0/P1/P2/P3/P4/P5/P6 labels.

### Mapping Table

| Old Label | Closest Canonical Phase(s) | Notes |
|-----------|---------------------------|-------|
| "Phase 0" | **P-1** or **P0** | Ambiguous. If context is "decision lock, architecture, reuse policy" -> P-1. If context is "foundation port, scaffold, contracts" -> P0. Must not be assumed to equal P-1 exclusively. |
| "Phase 1" | **P0**, **P1**, or **P2** | Ambiguous. If context is "port contracts and compiler" -> P0. If context is "desktop mockup" -> P1. If context is "mock runtime" -> P2. Must not be assumed to equal P0 exclusively. |
| "Phase 2" | **P2**, **P3**, or **P4** | Ambiguous. If context is "mock runtime slice" -> P2. If context is "kernel safety core" -> P3. If context is "real worker integration" -> P4. |
| "Phase 3" | **P4**, **P5**, or **P6** | Ambiguous. If context is "real Claude worker" -> P4. If context is "parallel execution" -> P5. If context is "hardening" -> P6. |

**How to resolve old references:**

1. Read the context of the old label. What specific work was being discussed?
2. Match the work to the closest canonical phase description.
3. Replace the old label with the correct canonical P-N label.
4. If the mapping is ambiguous, document both possible mappings and seek clarification.

**Examples of correct usage:**

| Old Statement | Correct Canonical Statement |
|---------------|----------------------------|
| "Phase 0: decision lock" | "P-1: decision lock" |
| "Phase 0: scaffold the repo" | "P0.1: monorepo scaffold" |
| "Phase 1: contracts port" | "P0.2: contracts port" |
| "Phase 1: desktop mockup" | "P1: desktop mockup" |
| "Phase 2: kernel safety" | "P3: kernel safety core" |
| "Phase 3: production" | "P6: production hardening" |

---

## Control Flow Between Phases

```
P-1 ──(decision docs complete)──> P0
                                    │
P0.1 ──(scaffold passes)────> P0.2 ──(contracts stable)──> P0.3
P0.4 (parallel with P0.1)
                                    │
                              P0 Gate (all sub-phase gates pass)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
                   P1              P2              P3
          (desktop mockup)  (mock runtime)  (kernel safety)
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                            Day 0 Spike GO
                                    │
                                    ▼
                                   P4
                          (real Claude worker)
                                    │
                                    ▼
                                   P5
                        (parallel + assembler)
                                    │
                                    ▼
                                   P6
                        (artifacts + hardening)
```

---

## MUST / MUST NOT Rules

### MUST

- MUST use the canonical P-1/P0/P1/P2/P3/P4/P5/P6 labels in all new documents, prompts, and code.
- MUST pass the P0 Gate before starting P2, P3, or P4 implementation.
- MUST complete the Day 0 Spike and obtain GO before starting P4 implementation.
- MUST run 3 mock workers concurrently and pass mock proof before running 3 real workers.
- MUST respect sequential dependencies marked in the Do-Not-Start list.
- MUST map old Phase 0/1/2/3 labels to canonical phases when updating legacy documents.

### MUST NOT

- MUST NOT say "Phase 0 always equals P-1." Phase 0 is ambiguous and requires context to map.
- MUST NOT say "Phase 1 always equals P0." Phase 1 is ambiguous and requires context to map.
- MUST NOT start server/runtime before P0 Gate passes.
- MUST NOT start kernel/core full implementation before P0 Gate passes.
- MUST NOT start real Claude adapter before P3 kernel safety core proves false-done detection.
- MUST NOT start assembler before P4 proves single-worker pipeline.
- MUST NOT start desktop real runtime connection before P1 mockup proves UI design.
- MUST NOT use old Phase 0/1/2/3 labels in new documents.

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Starting P2/P3/P4 before P0 Gate | Foundation is unstable; ported contracts or compiler have bugs that propagate | P0 Gate is a hard checkpoint. Gate failures must be fixed before proceeding |
| Starting P4 before P3 safety core | Real worker runs without false-done detection; unsafe autonomous execution | P3 gate is mandatory before P4 implementation |
| Starting P5 before P4 single worker proof | Parallel execution bugs interact with adapter bugs; undebuggable | Sequential: single worker -> multi worker |
| Misinterpreting old Phase labels | Agents work on wrong phase tasks; coordination breaks | Map old labels using the mapping table in this document |
| Running P0.3 before P0.2 | ACCP compiler port has broken contract imports; tests fail or compile errors | Sequential: P0.2 (stable contracts) -> P0.3 (compiler port) |
| Skipping P2 mock runtime | Real worker bugs are hard to isolate without mock event model proof | P2 proves the event model before real workers are introduced |

---

## Test / Gate Implications

- **P-1 Gate:** All decision documents consistent. No contradictions.
- **P0 Gate:** All sub-phase gates pass. Boundary checker passes. Ported tests pass.
- **P1 Gate:** Desktop mockup renders all required panels.
- **P2 Gate:** Full vertical slice: mock server -> SSE -> desktop.
- **P3 Gate:** All false-done scenarios caught. Circuit Breaker transitions tested.
- **Day 0 Gate:** GO/NO-GO decision backed by spike evidence.
- **P4 Gate:** Real Claude attempt completes full PRAXIS pipeline.
- **P5 Gate:** 3 workers run in parallel. Assembler integration correct.
- **P6 Gate:** All e2e tests pass. Stability baseline meets thresholds.

---

## Decision Compliance Checklist

- [x] P-1 through P6 is canonical phase model (D-052)
- [x] P0 is "Selective pi/ Reuse Foundation Port" (D-054)
- [x] Old Phase 0/1/2/3 labels are deprecated (D-061)
- [x] Do not say "Phase 0 always equals P-1" (explicit rule)
- [x] Do not say "Phase 1 always equals P0" (explicit rule)
- [x] Do-not-start list matches D-116 constraints
- [x] P0 gate must pass before P2/P3/P4 (D-110)
- [x] Parallel tasks match D-112, D-113, D-114, D-115
- [x] Desktop Mission Control is included in P1 (D-055)
- [x] Circuit Breaker is in P3 (kernel safety core), not P6 (D-090)

---

## Open Questions

1. **Should P2 and P3 be fully sequential or partially overlapping?** Currently defined as partially overlapping (server/ vs kernel/ have no file overlap). Review during P1 planning.
2. **What is the exact Day 0 Spike duration?** Estimate 1-2 days of real Claude Code usage under hook supervision. Spike plan needed before P-1 completes.
3. **Should P5 governor tiers be proved with mock workers before real workers?** Tentative: yes. Mock proof required before real parallel workers.
4. **What is the long-run stability baseline duration for P6?** Tentative: 48 hours continuous clean operation at stable_3. Adjust based on P5 findings.

---

## Audit Notes

- This phase map resolves the ambiguity between `ai_summary.md` phase descriptions and `architecture.md` section 30 roadmap. Both describe the same phases; this document is the canonical reference.
- The Do-Not-Start list is particularly important for preventing agents from jumping ahead. It is derived from D-116 and the sequential gate dependencies defined in `docs/decisions.md` Section 17.
- The old Phase 0/1/2/3 mapping is intentionally non-1:1. Older discussions used fewer phases with broader scope. This document provides a mapping table to resolve ambiguity case by case.
