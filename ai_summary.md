# PRAXIS / Pi — Project State

> This file is maintained by agents on every change. Read first each session.

---

## Identity

| Field | Value |
|-------|-------|
| Project | PRAXIS v2.0 |
| Root | `/Users/hootie/praxis` |
| Purpose | Local Truth Kernel for agentic coding tools — verifies whether the agent actually completed the task |
| Concept | A plugin-first local verification layer: praxis CLI + Truth Kernel + Claude Code plugin UX. Answers "Bitti mi gerçekten?" / "Did the agent actually complete the task?" |
| Status | D3/P1/P2 LOCKED. Remaining MVP architecture design pack COMPLETE. Implementation 0% — NOT authorized. Post-ADR-013 Plugin-First Pivot. |
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

## Phase & Milestone Status (Post-Pivot)

| # | Phase | Scope | Status |
|---|-------|-------|--------|
| D0 | Pivot Decision Lock | ADR-013, decisions.md D-127–D-148 | COMPLETE |
| D1 | Plugin-First Design Pack | Product scope, phase map, task YAML contract, MVP scope, plugin flow, kernel flow | COMPLETE |
| D3 | PlanSpec v0.1 Schema Pack | Canonical schema, 5 examples, 10 fixtures, validation script | **PASS_LOCKED** 9.2/10 |
| P1 | @praxis/contracts | Parser, validator, hasher, fixture runner | **PASS_LOCKED** 31/31 tests, 17/17 ACs |
| P2 | @praxis/kernel — SchemaGate + LockGate | SchemaGate, LockGate, lock helpers, P2 pipeline | **PASS_LOCKED** 28/28 tests, 18/18 ACs |
| DP | Remaining MVP Architecture Design Pack | EvidenceGate, EvidenceLedger, WiringGate, ExecGate, FinalGate, RepairPacket, reports, CLI, plugin bridge, roadmap | **COMPLETE** 17/17 ACs, 8.6/10 scorecard |
| P3 | EvidenceGate implementation | EvidenceLedger reader/writer, namespace checker, diff analyzer, evidence gate, P3 pipeline | **PASS** 36/36 tests, 18/18 ACs |
| P4 | WiringGate implementation | Declared unit matcher, export checker, orphan detector, mode validator | **Design ready** |
| P5 | ExecGate implementation | Command runner, timeout, safety, test output parsing, evidence capture | **Design ready** |
| P6 | FinalGate + Repair + Reports + CLI + Plugin | Criterion evaluator, verdict aggregator, report gen, CLI, plugin bridge | **Design ready** |
| I0 | Implementation Scaffold | Monorepo, contracts, build infra | FUTURE — not authorized |
| I1 | Manual Verify MVP | init, spec, verify commands | FUTURE — not authorized |

**Overall design progress:** ~90% (D3/P1/P2/P3 locked, P4-P6 designed)
**Overall implementation progress:** ~30% (P2 + P3 locked, P4-P6 NOT started)
**Implementation NOT authorized** without explicit human approval per phase.

### Quick Reference — Next Actions

```
1. [P-0] Review and accept the Remaining MVP Design Pack
2. [P-1] Tag D3/P1/P2 milestones for traceability
3. [P-2] Run current tests to confirm baseline (bun test)
4. [P3] Implement EvidenceGate — first gate after D3/P1/P2 lock
5. [P4-P6] Sequential implementation per phase roadmap
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
| `reports/accp/planspec-v0.1-fitness-audit.accp.yaml` | Report | PlanSpec v0.1 fitness audit (ACCP-YAML) — scores planspec.json 3.6/10 v0.1, 7.0/10 advanced; verdict HOLD; strategy TASK_YAML_PLUS_ADVANCED_PLANSPEC | 2026-06-20 |
| `reports/accp/planspec-v0.1-fitness-audit.summary.md` | Report | Markdown summary of the PlanSpec v0.1 fitness audit | 2026-06-20 |
| `reports/accp/planspec-v0.1-schema-reanalysis.accp.yaml` | Report | Deep re-analysis of new PRAXIS PlanSpec v0.1 native schema — scores 6.7/10 PASS_WITH_FIXES, identifies dead allOf conditionals (empirically verified), 10 schema patches | 2026-06-20 |
| `reports/accp/planspec-v0.1-schema-reanalysis.summary.md` | Report | Markdown summary of schema re-analysis | 2026-06-20 |
| `reports/accp/current-state-audit.accp.yaml` | Report | Full repo state audit after machine switch — D3/P1/P2 confirmed PASS, clean forbidden-future-work check, 59/59 total tests | 2026-06-20 |
| `reports/accp/remaining-mvp-design-pack.accp.yaml` | Report | Remaining MVP Architecture Design Pack report — 17/17 ACs PASS, design scorecard 8.6/10, next phase recommendation | NEW 2026-06-20 |
| `design/praxis-remaining-mvp-design-pack/` | Design | Remaining MVP architecture design pack — 16 documents covering EvidenceGate through plugin bridge | NEW 2026-06-20 8.6/10 |
| `docs/` | Design | Architecture docs, ADRs, specs, phase map, product scope | DRAFT_FOR_AUDIT |
| `docs/decisions.md` | Design | Canonical decision register — HARD_LOCK/SOFT_LOCK/OPEN/REJECTED | Authoritative |
| `docs/adr/README.md` | Design | ADR index — resolves numbering collisions, registers all ADRs | v0.1 |
| `docs/phase-map.md` | Design | P-1 through P6 canonical phase map, gates, parallelism rules | v0.1 |
| `docs/product-scope.md` | Design | Product scope, MVP-A/B/C staging, in/out of scope | v0.1 |
| `docs/pipelines/overview.md` | Spec | End-to-end pipeline: PlanSpec through ACCP artifacts. Component placement, MVP staging, CB/Governor intervention, ACCP async independence. | DRAFT_FOR_AUDIT v0.1 |
| `docs/pipelines/taskrun-lifecycle.md` | Spec | TaskRun FSM: states, transitions, gate positions, repair loop (max 7), false-done protection, terminal invariants. | DRAFT_FOR_AUDIT v0.1 |
| `docs/pipelines/runtime-event-flow.md` | Spec | RuntimeEvent model, append-only log, SSE streaming, snapshot, event replay, gap detection, UI state rules, in-memory→PG migration. | DRAFT_FOR_AUDIT v0.1 |
| `docs/pipelines/worker-adapter.md` | Spec | Generic worker adapter 5-stage pipeline: healthCheck→prepareAttempt→runAttempt→captureOutput→normalizeResult; RunAttemptResult (no verdict); AdapterError normalization (RateLimitSignal/CrashSignal/TimeoutSignal); mock adapter contract; CLAIM ONLY designation for worker_reported_status. | DRAFT_FOR_AUDIT v0.1 (rewritten) |
| `docs/pipelines/claude-code-adapter.md` | Spec | Claude Code adapter specifics: Day 0 Spike (S1-S5 GO/NO-GO criteria); primary path (headless + praxis-hook); Claude local loop vs. PRAXIS supervisory loop (independent); rate limit/crash/divergence detection; NO adapter-owned FinalGate; NO direct shared writes. | DRAFT_FOR_AUDIT v0.1 |
| `docs/pipelines/praxis-hook-capture.md` | Spec | Hook event capture pipeline: Claude emits→praxis-hook intercepts→normalizes JSON→POSTs to runtime→spool fallback; PreToolUse/PostToolUse/Stop; server ingestion→EvidenceRecord→EHC chain; EHC break (NOISE/SUSPECTED/CONFIRMED)→Circuit Breaker; hook NEVER decides truth. | DRAFT_FOR_AUDIT v0.1 |
| `docs/pipelines/messages-api-fallback.md` | Spec | Messages API fallback (gated on Day 0 Spike NO-GO): PRAXIS-owned tool execution loop; what stays identical (Truth Engine/Three Laws/evidence model/gate pipeline); what changes (adapter impl); tradeoffs; MUST NOT implement now; MUST NOT change Truth Engine authority. | DRAFT_FOR_AUDIT v0.1 |
| `docs/index.md` | Meta | Documentation index — inventory, reading order (4 tiers), required-reading for ACCP/prompts. | DRAFT_FOR_AUDIT v0.1 |
| `docs/testing/pipeline-test-strategy.md` | Spec | Phase-by-phase test categories (P0-P6), gate mapping, false-done mandates, CB test requirements. | DRAFT_FOR_AUDIT v0.1 |
| `docs/implementation/p0-entry-gate.md` | Spec | P0 entry prerequisites, P0.1-P0.4 sub-gates, P0 Exit Gate, forbidden-copy enforcement. | DRAFT_FOR_AUDIT v0.1 |
| `docs/contracts/task-spec.contract.md` | Contract | TaskSpec fields, AcceptanceCriterion, TaskBudget, PredictedInterface, PSAG validation rules V1-V14, forbidden authority fields | DRAFT_FOR_AUDIT v0.1 |
| `docs/contracts/plan-spec.contract.md` | Contract | PlanSpec fields, PlanBudget, PSAG plan-level checks P1-P15, dependency graph validation, namespace partitioning | DRAFT_FOR_AUDIT v0.1 |
| `docs/contracts/worker-adapter.contract.md` | Contract | WorkerAdapter operations, WorkerHealth, RunAttemptInput/Result, ErrorSignal taxonomy, adapter MUST/MUST NOT rules | DRAFT_FOR_AUDIT v0.1 |
| `docs/contracts/run-attempt.contract.md` | Contract | RunAttemptInput/Result, AttemptManifest (kernel-extended), DivergenceFlag, GateResult placeholder, claim vs. verdict boundary | DRAFT_FOR_AUDIT v0.1 |
| `docs/contracts/runtime-event.contract.md` | Contract | RuntimeEvent envelope, 10 event type categories, sequencing/gap-detection, SSP ingestion algorithm, forbidden authority sources | DRAFT_FOR_AUDIT v0.1 |
| `docs/contracts/runtime-snapshot.contract.md` | Contract | RuntimeSnapshot shape, RuntimeStatus/GovernorSummary/CircuitBreakerSummary/TaskRunSummary/WorkerSummary/HumanAction sub-types, UI consumption algorithm, forbidden UI-authored fields | DRAFT_FOR_AUDIT v0.1 |
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
cd0acea  feat: implement @praxis/kernel P2 SchemaGate and LockGate   (2026-06-20)
d6a7d8e  feat: implement @praxis/contracts PlanSpec v0.1 parser/validator/hasher/fixture-runner
97e24fa  feat: lock PRAXIS PlanSpec v0.1 canonical schema pack
27628a3  PRAXIS Plugin-First Pivot: rebrand from desktop-first orchestrator to local Truth Kernel
d554a37  fix
bc45809  Add PRAXIS design documentation pack v0.1 (DRAFT_FOR_AUDIT)
85218cd  Add CLAUDE.md and ai_summary.md for agent session continuity
cacc073  update todo
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

## Design Lock Summary (Post-Pivot)

| Lock level | Definition | Items |
|------------|-----------|-------|
| HARD | Changing requires ADR | Product identity (not a coding agent), local Truth Kernel core, plugin-as-bridge, v0.1 scope exclusions, Three Laws preserved |
| SOFT | Can evolve during implementation | JSONL evidence store format, package names, stack choices, exact CLI interface |
| OPEN | Needs discovery/spike | Automatic hook loops, repair dispatch automation, MiMo/OpenCode adapter feasibility |

Full tracking in `docs/decisions.md` Section 23.

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
| 2026-06-20 | `packages/kernel/src/evidence/` (5 new), `packages/kernel/src/gates/evidenceGate.ts` (new), `packages/kernel/src/runP3Kernel.ts` (new), `packages/kernel/test/evidenceLedger.spec.ts` (new), `packages/kernel/test/evidenceGate.spec.ts` (new), `packages/kernel/test/p3Kernel.spec.ts` (new), `fixtures/kernel/p3/` (11 new), `packages/kernel/src/types.ts` (updated), `packages/kernel/src/diagnostics.ts` (updated), `packages/kernel/src/index.ts` (updated), `reports/accp/p3-kernel-evidencegate-ledger.accp.yaml` (updated), `ai_summary.md` (updated) | **P3 EvidenceLedger + EvidenceGate Implementation (ACCP-PRAXIS-P3-KERNEL-EVIDENCEGATE):** Implemented EvidenceLedger JSONL v0.1 (types, reader/writer/appender, validation) and EvidenceGate (PASS/HOLD/FAIL with namespace checks, required evidence mapping, divergence detection). 18 reason codes. runP3Kernel composes SchemaGate → LockGate → EvidenceGate only. 11 test fixtures (pass/hold/fail scenarios). 36 P3 tests. All regression: P1 31/31, P2 28/28. Total 95/95 tests PASS. 18/18 ACs. No WiringGate, ExecGate, FinalGate, CLI, or plugin created. Enum normalization applied (divergence_file/divergence_tool/divergence_output). Design pack 8.6/10 scorecard unchanged. Next prompt: ACCP-PRAXIS-P4-KERNEL-WIRINGGATE-STATIC. |
| 2026-06-20 | `design/praxis-remaining-mvp-design-pack/` (16 new files), `reports/accp/remaining-mvp-design-pack.accp.yaml` (new), `design/praxis-remaining-mvp-design-pack.zip` (new), `ai_summary.md` (updated), `CLAUDE.md` (updated), `docs/index.md` (updated) | **Remaining MVP Architecture Design Pack (ACCP-PRAXIS-REMAINING-DESIGN-PACK-GLM52-MAX):** Independently designed the remaining PRAXIS MVP architecture after D3/P1/P2 locked state. 16 design documents: executive summary, current state map, 6-gate pipeline, EvidenceGate design, EvidenceLedger JSONL contract, WiringGate v0.1-lite design, ExecGate safety model, FinalGate deterministic evidence policy, RepairPacket JSON contract, dual-format report model, CLI workflow (20+ subcommands), plugin bridge (9 slash commands + 3 hooks), P3-P6 roadmap (48 ACs), risk register (28 risks), design scorecard (8.6/10). All 17 ACs PASS. No implementation files modified. Design-only — not authorized for implementation. Zip: `design/praxis-remaining-mvp-design-pack.zip`. Next prompt: `ACCP-PRAXIS-P3-KERNEL-EVIDENCEGATE`. |
| 2026-06-18 | `README.md` (rewritten), `architecture.md` (rewritten), `docs/identity.md` (new), `docs/index.md` (updated), `docs/pipelines/namespace-ownership.md` (supersession), `docs/contracts/conflict-report.contract.md` (supersession), `ai_summary.md` (updated) | **Plugin-First Rebrand Alignment (ACCP-PRAXIS-PLUGIN-FIRST-REBRAND-DOCS-ALIGNMENT):** Rewrote README.md as public-facing plugin-first overview (local Truth Kernel, Claude Code plugin bridge, manual verify/repair loop, future scope). Rewrote architecture.md as canonical plugin-first v0.1 architecture baseline (high-level flow, core components, package design, gate details, local state model, future architecture, superseded desktop-first section). Created docs/identity.md (product identity + terminology glossary). Updated docs/index.md reading order to include README.md and architecture.md. Added supersession notices to namespace-ownership.md and conflict-report.contract.md (remaining old multi-worker docs). Updated ai_summary.md with current state. Zip: artifacts/praxis-docs-plugin-first-rebrand-aligned-v0.1.zip. Implementation NOT authorized. |
| 2026-06-18 | `docs/adr/ADR-013-plugin-first-pivot.md` (new), `docs/decisions.md` (updated), `docs/product-scope.md` (rewritten), `docs/phase-map.md` (rewritten), `docs/index.md` (updated), `docs/contracts/praxis-task-yaml.contract.md` (new), `docs/implementation/mvp-v0.1-plugin-first-scope.md` (new), `docs/pipelines/claude-code-plugin-flow.md` (new), `docs/pipelines/local-truth-kernel-flow.md` (new), plus 8 supersession notices | **Plugin-First Pivot Decision Pack:** Repositioned PRAXIS from desktop-first orchestrator to plugin-first local Truth Kernel. ADR-013 with KEEP/FUTURE/KILL. D-127-D-148 decisions. Zip: artifacts/praxis-docs-plugin-first-pivot-v0.1.zip. All 19 ACs passed. |: worker-adapter (complete rewrite per user spec with 5-stage pipeline + RunAttemptResult with no verdict + AdapterError normalization + mock adapter), claude-code-adapter (Day 0 Spike S1-S5 GO/NO-GO gates + headless+primary path + two independent loops + NO adapter-owned FinalGate), praxis-hook-capture (hook event capture pipeline + PreToolUse/PostToolUse/Stop + spool fallback + EHC chain feed + 4 design principles), messages-api-fallback (gated on Spike NO-GO + PRAXIS-owned tool loop + what stays same vs. changes + tradeoffs). All respect decisions.md HARD_LOCK decisions and Three Laws. |
| 2026-06-18 | `docs/contracts/*.md` (6 files) | Created six DRAFT_FOR_AUDIT v0.1 contract documentation files: task-spec.contract.md (TaskSpec + AcceptanceCriterion + PSAG V1-V14), plan-spec.contract.md (PlanSpec + PlanBudget + PSAG P1-P15), worker-adapter.contract.md (WorkerAdapter + WorkerHealth + RunAttemptInput/Result + MUST/MUST NOT rules), run-attempt.contract.md (RunAttemptResult + AttemptManifest + DivergenceFlag + GateResult), runtime-event.contract.md (RuntimeEvent envelope + 10 event categories + sequencing/gap-detection + SSP replay), runtime-snapshot.contract.md (RuntimeSnapshot + 6 sub-types + UI consumption algorithm). All use conceptual field tables (not TypeScript). Forbidden authority fields enforced per Three Laws. Contract-first development (D-098). docs/decisions.md NOT modified. |
| 2026-06-18 | `docs/pipelines/overview.md`, `docs/pipelines/taskrun-lifecycle.md`, `docs/pipelines/runtime-event-flow.md` | Created three core pipeline specs DRAFT_FOR_AUDIT v0.1: end-to-end overview (component placement, MVP staging, CB/Governor intervention, ACCP async independence), TaskRun lifecycle FSM (states, transitions, gate positions, repair loop, false-done protection, terminal invariants), RuntimeEvent flow (append-only log, SSE streaming, snapshot, event replay, gap detection, UI state rules). All respect decisions.md HARD_LOCK decisions. |
| 2026-06-18 | `docs/index.md`, `docs/testing/pipeline-test-strategy.md`, `docs/implementation/p0-entry-gate.md` | Created three DRAFT_FOR_AUDIT v0.1 spec docs: documentation index (4-tier reading order), pipeline test strategy (P0-P6 test categories + CB transition tests + false-done mandates), P0 entry gate (prerequisites + P0.1-P0.4 sub-gates + P0 Exit Gate). All respect decisions.md HARD_LOCK decisions. |
| 2026-06-18 | `docs/adr/README.md`, `docs/phase-map.md`, `docs/product-scope.md` | Created three DRAFT_FOR_AUDIT v0.1 spec docs: ADR index (resolves numbering collision), phase map (P-1 through P6 canonical), product scope (MVP-A/B/C staging). All respect decisions.md HARD_LOCK decisions. |
| 2026-06-18 | `docs/decisions.md`, `docs/index.md`, `docs/spikes/day-0-claude-code-spike.md` | Decision register authorization fix: (1) Downgraded D-117 (TypeScript strict) from HARD_LOCK to SOFT_LOCK — all D-117 through D-126 are now SOFT_LOCK stack preference decisions. (2) Added authorization note to Section 18 explaining D-117–D-126 are stack preferences, do not authorize implementation, and may be revised before Final Design Lock. (3) Updated docs/index.md D-ID range from D-125 to D-126. (4) Normalized Day 0 Spike heading from "GO/NO-GO" to "GO / NO-GO Criteria" with spaces. (5) Created artifacts/praxis-docs-v0.1-draft-register-authorized.zip. No source code changed. All 14 acceptance criteria pass. |
| 2026-06-18 | `docs/index.md`, `docs/pipelines/overview.md`, `docs/pipelines/wave-scheduler.md` | Consistency fix pass: (1) Verified all D-NNN references across all 37 docs against docs/decisions.md — no conflicts found; all known-bad-pattern checks passed. (2) Fixed 2 minor stable_16 qualifications in overview.md and wave-scheduler.md to explicitly state stable_16 is an OPEN hypothesis. (3) Updated index.md Decision ID Integrity section with verified audit status and added checklist exemption note. (4) Created artifacts/praxis-docs-v0.1-draft-fixed.zip. No source code or implementation files changed. All 19 acceptance criteria pass. |
| 2026-06-17 | `CLAUDE.md`, `ai_summary.md` | Initial agent documentation baseline |
| 2026-06-17 | `todo.md`, `reports/*.yaml` | Update todo with full phase tracking, add ACCP readiness reports |

---

## Known Issues

- **Environment mismatch**: `pi/AGENTS.md` references macOS paths and tmux commands — not applicable to this Linux environment
- **No workspace root package.json**: Cannot run `bun install` or `bun test` at root yet — per-package only
- **Legacy ai_summary.md**: `pi/ai_summary.md` has 1500+ lines of auto-generated file analysis that may be stale
- **Post-pivot doc reconciliation**: Old desktop/server/runtime docs exist alongside new plugin-first docs. 8 docs received supersession notices; remaining pipeline/contract docs may need review for v0.1 consistency
- **Architecture.md updated**: `architecture.md` rewritten to plugin-first v0.1 architecture (post-ADR-013). Old desktop-first architecture preserved in Superseded section.
- **planspec.json is a foreign schema**: `planspec.json` (Pi P44/v4.11/P45) scored 3.6/10 for v0.1. PRAXIS-native `planspec.v0.1.schema.yaml` is the canonical schema.
- **No git tags for milestones**: D3, P1, P2 milestones have no tags — makes traceability harder
- **.praxis/ untracked**: `.praxis/locks/current.lock.yaml` exists as artifact from prior kernel LockGate test run — should be gitignored
- **Design pack is unaccepted**: The remaining MVP design pack has been produced but has NOT been reviewed by the human project owner. Implementation must not start without explicit acceptance.

---

## Active Work

- **Plugin-First Pivot (COMPLETE 2026-06-18):** Two-pack documentation: (1) Pivot Decision Pack — ADR-013, decisions.md D-127–D-148, product-scope/phase-map rewrites, 4 new docs, 8 supersession notices. (2) Rebrand Alignment — README.md and architecture.md rewritten, identity.md created, 2 additional supersession notices, index.md updated. Both packs zipped.
- **PlanSpec v0.1 Fitness Audit (COMPLETE 2026-06-20):** Audit-only analysis of planspec.json. Reports at `reports/accp/planspec-v0.1-fitness-audit.accp.yaml` + `.summary.md`. 16/16 ACs pass.
- **Remaining MVP Architecture Design Pack (COMPLETE 2026-06-20):** Full 16-document design pack for EvidenceGate through plugin bridge. 17/17 ACs pass, 8.6/10 scorecard. Zip at `design/praxis-remaining-mvp-design-pack.zip`. Report at `reports/accp/remaining-mvp-design-pack.accp.yaml`.
- **Next (P3):** **COMPLETE (2026-06-20)** — EvidenceLedger JSONL v0.1 + EvidenceGate implemented. 36 P3 tests, 95/95 total (31 P1 + 28 P2 + 36 P3). All 18 ACs pass. Report at `reports/accp/p3-kernel-evidencegate-ledger.accp.yaml`.
- **Next (P4):** WiringGate v0.1 static file/pattern matching. Design ready. Prompt: `ACCP-PRAXIS-P4-KERNEL-WIRINGGATE-STATIC`.

---

## Quick Reference

```
What is PRAXIS?             →  Local Truth Kernel for agentic coding tools.
                              Not a coding agent. Not a Claude Code clone.
Primary interface (v0.1)?   →  Claude Code plugin + praxis CLI.
Completion authority?       →  Truth Kernel FinalGate. Never agent.
Completion criteria source? →  .praxis/task.yaml (human-approved). Never agent.
Truth location?             →  Kernel only. Plugin displays, never decides.
Evidence store (v0.1)?      →  .praxis/runs/<id>/evidence.jsonl (JSONL format).
Desktop Mission Control?     →  FUTURE scope for v0.1 (target v0.3+).
Server/SSE/PostgreSQL?      →  FUTURE scope for v0.1 (target v0.2+).
Multi-agent orchestration?  →  FUTURE scope for v0.1 (target v0.3+).
Own agent loop?             →  KILLED from v0.1. Agents run independently.
Implementation authorized?  →  NO. Design stages (D3/P1/P2 locked, remaining architecture designed, awaiting human acceptance).

Design pack?                →  design/praxis-remaining-mvp-design-pack/ (16 docs, 8.6/10)
EvidenceLedger format?      →  JSONL (04-evidenceledger-v0.1.contract.yaml)
WiringGate v0.1?            →  Static file matching only (05-wiringgate-design.md)
ExecGate safety?            →  exactAllowedCommands only (06-execgate-design.md)
Next phase?                 →  P3 EvidenceGate implementation (WAITING for acceptance)
```
