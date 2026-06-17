# P0 Entry Gate

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the entry prerequisites, sub-gates, and exit criteria for P0 (Selective pi/ Reuse Foundation Port). P0 is the first implementation phase; its exit gate must pass before any P2/P3/P4 work begins.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

P0 is the Selective pi/ Reuse Foundation Port phase. It does not build the PRAXIS runtime, kernel, or desktop. It ports only the two approved reusable packages (execution-contracts and accp-compiler) from the old `pi/` monorepo, establishes the new monorepo scaffold, extracts an FSM reference document, and verifies that no forbidden old code has leaked into the new codebase.

This document defines what must be true BEFORE P0.1 can start, what each sub-gate verifies, and what must pass before the P0 Exit Gate opens P2/P3/P4 for implementation.

---

## Scope

- Entry prerequisites that must be satisfied before P0.1 begins
- P0.1 Gate criteria (monorepo scaffold + CI)
- P0.2 Gate criteria (contracts port)
- P0.3 Gate criteria (ACCP compiler port)
- P0.4 Gate criteria (FSM reference document)
- P0 Exit Gate criteria (must pass before P2/P3/P4)
- Forbidden-copy enforcement rules
- Reuse policy verification

---

## Non-Goals

- P2, P3, P4, P5, or P6 gate criteria (those are separate documents)
- Implementation instructions for the port itself (this is a gate definition, not a how-to)
- ACCP compiler internals documentation
- Contract type definitions
- Test case enumeration (that is in `docs/testing/pipeline-test-strategy.md`)

---

## Authoritative Decisions Used

| Decision ID | Decision | How It Applies |
|-------------|----------|----------------|
| D-044 | P0 is Selective pi/ Reuse Foundation Port, not migration | This document uses the correct terminology throughout; "migration" is forbidden |
| D-045 | PORT_AND_ADAPT: execution-contracts to lib/contracts | Defines P0.2 scope and gate criteria |
| D-046 | PORT_AND_ADAPT: accp-compiler to kernel/accp | Defines P0.3 scope and gate criteria |
| D-047 | REFERENCE_ONLY: execution-runtime FSM patterns | Defines P0.4 scope (FSM reference doc) |
| D-048 | REWRITE_FROM_SCRATCH: kernel/core, evidence, truth-engine, etc. | Confirms these are NOT in P0 scope |
| D-049 | REJECTED / DO NOT COPY: coding-agent, agent, brain, ai, db, web-server, web-ui, tui, worker-adapters, execution-service | Defines forbidden-copy list enforced at P0 Exit Gate |
| D-050 | Old runtime controller code coupled to DB/Kysely must not become PRAXIS kernel | REJECTED — confirms this code is not ported |
| D-051 | Full pi/ migration is rejected | REJECTED — this document never describes full migration |
| D-110 | P0 gate must pass before P2/P3/P4 implementation | This is the P0 Exit Gate rule |
| D-098 | Contract-first development is mandatory | Contracts are ported in P0.2 before any runtime/kernel implementation |
| D-018 | No root src/ directory | Enforced at P0.1 scaffold gate |
| D-112 | P0 can be partially parallelized | P0.1 and P0.4 are safe parallel tasks |
| D-113 | Safe parallel tasks: P0.1 scaffold, P0.4 FSM reference doc, Day 0 Spike, P-1 doc alignment | Defines what runs in parallel vs. sequentially |
| D-114 | P0.2 contracts port should follow scaffold | Sequential dependency enforced |
| D-115 | P0.3 accp-compiler port should follow stable contracts shape | Sequential dependency enforced |

---

## Conceptual Model

### P0 Sub-Gate Flow

```
Entry Prerequisites Met
        │
        ▼
   ┌─────────┐
   │  P0.1   │  Monorepo Scaffold + CI
   │  Gate   │
   └────┬────┘
        │ PASS
        ▼
   ┌─────────┐
   │  P0.2   │  Contracts Port (247 tests)
   │  Gate   │
   └────┬────┘
        │ PASS (partial shape stability)
        ▼
   ┌─────────┐
   │  P0.3   │  ACCP Compiler Port (135 tests)
   │  Gate   │
   └────┬────┘
        │ PASS
        ▼
   ┌─────────────────────────────┐
   │  P0.4 Gate                  │  FSM Reference Doc
   │  (parallel with P0.1-P0.3)  │
   └──────────────┬──────────────┘
                  │ PASS
                  ▼
   ┌─────────────────────────────┐
   │  P0 EXIT GATE               │
   │  All sub-gates pass         │
   │  Forbidden copy check clean │
   │  Reuse policy ADR exists    │
   └──────────────┬──────────────┘
                  │ PASS
                  ▼
          P2 / P3 / P4
```

**Key:** P0.4 (FSM reference doc) can run in parallel with P0.1 through P0.3 since it has no code dependency. P0.2 depends on P0.1 (needs monorepo scaffold). P0.3 depends on P0.2 producing stable-enough contract shapes.

### What P0 Is vs. What P0 Is Not

| P0 IS | P0 IS NOT |
|-------|-----------|
| Selective port of two approved packages | Migration from old repo |
| Foundation for contract-first development | Building any runtime or kernel logic |
| Establishing monorepo structure, CI, and boundary enforcement | Implementing Truth Engine, Circuit Breaker, or adapters |
| Producing a reusable ACCP compiler package | Building the PRAXIS execution platform |
| A gate that blocks P2/P3/P4 until passing | A phase that overlaps with P2/P3/P4 |

---

## MUST / MUST NOT Rules

### MUST

- P0 MUST be described as "Selective pi/ Reuse Foundation Port" in all documentation, prompts, and commit messages
- All P0 sub-gates MUST pass before proceeding to P0 Exit Gate
- P0 Exit Gate MUST pass before any P2, P3, or P4 implementation work begins
- `@earendil-works` namespace MUST be completely removed from all ported code
- All ported tests (247 from execution-contracts, 135 from accp-compiler) MUST pass under Bun test runner
- Boundary import checker MUST be operational and pass (zero violations) before P0.1 exits
- Forbidden copy list MUST be verified clean (zero violations) before P0 Exit Gate
- Every ported package MUST have a valid `package.json` with correct `@praxis/*` naming
- Reuse policy ADR MUST exist in `docs/adr/` before P0 Exit Gate
- The monorepo root MUST have working `bun install`, `bun run typecheck`, and `bun test` commands

### MUST NOT

- MUST NOT describe P0 as "migration" or "migration from old repo" — it is a selective port
- MUST NOT allow P2, P3, or P4 implementation code to be written before P0 Exit Gate passes
- MUST NOT copy any code from forbidden packages (D-049 list)
- MUST NOT import old runtime controller code (D-050)
- MUST NOT create a root `src/` directory
- MUST NOT keep `@earendil-works` namespace in any ported file
- MUST NOT import from `pi/` directory in any PRAXIS source file
- MUST NOT include implementation code in gate definition documents
- MUST NOT treat ACCP compiler's gate evaluator as the PRAXIS Truth Engine
- MUST NOT embed DB, runtime, or controller assumptions in contracts

---

## Entry Prerequisites

Before P0.1 (Monorepo Scaffold + CI) can begin, the following must exist and be accepted:

### 1. docs/decisions.md exists and is accepted

The canonical decision register must exist, be reviewed, and be accepted by the human project owner. All HARD_LOCK decisions must be stable. This document IS `docs/decisions.md` — it already exists at the time of this writing.

**Verification:** File exists, Section 1-23 populated, change policy defined.

### 2. docs/phase-map.md exists

A phase dependency map showing P-1 through P6, their gates, dependencies, and parallelization rules must exist.

**Verification:** File exists, covers all phases, identifies parallel-safe tasks.

### 3. docs/product-scope.md exists

A product scope document defining MVP-A, MVP-B, MVP-C, out-of-scope items, and future considerations must exist.

**Verification:** File exists, covers three MVP stages, lists out-of-scope items.

### 4. ADR index exists

`docs/adr/README.md` must exist, listing all ADRs with status, topic, and date. The ADR index must normalize numbering across `ai_summary.md`, `architecture.md`, and any future ADR files.

**Verification:** File exists, lists at minimum the 5 ADRs from `ai_summary.md` plus the 10 from `architecture.md` (normalized).

### 5. Pipeline docs exist

At minimum, the following pipeline documents must exist:
- `docs/pipelines/overview.md` — end-to-end execution pipeline
- `docs/pipelines/taskrun-lifecycle.md` — TaskRun FSM states, transitions, events, gate positions

**Verification:** Both files exist and are consistent with `docs/decisions.md`.

### 6. Reuse policy is documented and accepted

A reuse policy document (may be an ADR or a standalone doc) must define what can be ported, what cannot, and why. This is distinct from `docs/decisions.md` Section 8 — it is the detailed policy that Section 8 references.

**Verification:** Document exists, lists approved ports (D-045, D-046), reference-only items (D-047), rewrites (D-048), and forbidden copies (D-049).

### 7. Human approval to start P0

The human project owner must explicitly approve starting P0 implementation. This is a manual gate, not an automated one.

**Verification:** Approval recorded in `todo.md` or a P0 kickoff ADR.

---

## P0.1 Gate: Monorepo Scaffold + CI

### Purpose

Establish the PRAXIS monorepo structure with Bun workspaces, TypeScript strict mode, Biome linting/formatting, boundary import checking, and CI pipeline. This is the foundation on which all subsequent packages are built.

### Gate Criteria

| # | Criterion | How Verified | Must Pass? |
|---|-----------|-------------|------------|
| 1 | `bun install` succeeds | Run in CI; exit code 0, no errors in stderr | YES |
| 2 | `bun run typecheck` succeeds | TypeScript strict mode, zero errors across all packages | YES |
| 3 | `bun test` succeeds | All workspace tests pass (even if placeholder/skeleton tests) | YES |
| 4 | No root `src/` directory exists | File system check: `praxis/src/` must not exist | YES |
| 5 | Boundary import checker catches forbidden imports | Run checker against known-bad fixture; must report violations | YES |
| 6 | Boundary import checker reports zero violations on clean tree | Run checker against actual codebase; zero violations | YES |
| 7 | Empty package exports are valid | Each package with an `index.ts` exports at minimum a version constant or placeholder | YES |
| 8 | All packages use `@praxis/*` naming | `package.json` `name` field matches pattern for every package | YES |
| 9 | Biome config exists and passes | `bun run check` (lint + format) passes on all files | YES |
| 10 | CI pipeline exists (GitHub Actions or equivalent) | CI config file exists; runs install + typecheck + test + check on push | YES |

### Package Structure After P0.1

The monorepo must have the following package directories (empty skeletons acceptable):

```
praxis/
├─ package.json              # Root workspace config
├─ tsconfig.base.json        # Shared TS config
├─ biome.json                # Lint + format config
├─ bun.lockb                 # Lockfile
├─ kernel/
│  ├─ core/package.json
│  ├─ psag/package.json
│  ├─ evidence/package.json
│  ├─ truth-engine/package.json
│  ├─ rim/package.json
│  ├─ governor/package.json
│  ├─ circuit-breaker/package.json
│  ├─ assembler/package.json
│  └─ accp/package.json       # P0.3 fills this
├─ adapters/
│  ├─ claude-code/package.json
│  ├─ opencode/package.json
│  ├─ local-model/package.json
│  ├─ mock-worker/package.json
│  └─ adapter-testkit/package.json
├─ hooks/
│  └─ praxis-hook/package.json
├─ server/
│  ├─ runtime/package.json
│  ├─ control-plane/package.json
│  ├─ storage/package.json
│  ├─ event-bus/package.json
│  └─ telemetry/package.json
├─ interface/
│  ├─ cli/package.json
│  ├─ desktop/package.json
│  ├─ client/package.json
│  └─ ui-core/package.json
├─ lib/
│  ├─ contracts/package.json  # P0.2 fills this
│  ├─ config/package.json
│  ├─ logger/package.json
│  ├─ errors/package.json
│  ├─ result/package.json
│  ├─ ids/package.json
│  ├─ time/package.json
│  ├─ fs/package.json
│  ├─ process/package.json
│  ├─ crypto/package.json
│  └─ validation/package.json
└─ tests/
   ├─ integration/
   ├─ e2e/
   ├─ false-done/
   ├─ evidence-chain/
   ├─ assembler/
   └─ fixtures/
```

**Note:** Packages filled by P0.2 and P0.3 are marked. All other packages may remain as empty skeletons (valid `package.json` + placeholder `index.ts`) at P0.1 exit.

### Boundary Import Checker Requirements

The boundary checker must enforce the dependency rules from `architecture.md` Section 6:

| Rule | Enforcement |
|------|-------------|
| `kernel/*` must not import `adapters/claude-code` | Blocked |
| `kernel/*` must not import `server/storage` | Blocked |
| `kernel/*` must not import `interface/desktop` | Blocked |
| `lib/*` must not import anything above `lib/` | Blocked |
| `adapters/*` must not import `interface/*` | Blocked |
| `hooks/*` must not import `kernel/truth-engine` | Blocked |
| `lib/contracts` must not import kernel/server/adapters/interface | Blocked |
| `kernel/circuit-breaker` must not import server/interface/adapters/hooks/storage | Blocked |

The checker must run as part of `bun run typecheck` or as a separate CI step. Boundary violations must fail the build.

### Failure Modes

- **Empty packages with broken exports:** A package with no `index.ts` or a broken export path causes `bun run typecheck` to fail for consumers. Mitigation: P0.1 must include an export-validation test that imports from every package.
- **CI config references wrong Node version:** CI must use Bun, not Node. Mitigation: CI config must specify `bun` as the runtime.
- **Boundary checker not run in CI:** If the checker exists but is not wired to CI, boundary violations go undetected. Mitigation: CI pipeline must include boundary check step.

---

## P0.2 Gate: Contracts Port

### Purpose

Port `pi/packages/execution-contracts` to `lib/contracts` with full test pass, namespace cleanup, and PRAXIS law compliance. This establishes the shared type foundation that all other packages depend on.

### Gate Criteria

| # | Criterion | How Verified | Must Pass? |
|---|-----------|-------------|------------|
| 1 | `@praxis/contracts` package exists at `lib/contracts` | Directory + package.json check | YES |
| 2 | All 247 ported tests pass under Bun | `bun test` in `lib/contracts` reports 247/247 passed | YES |
| 3 | No `@earendil-works` namespace remains | `grep -r "earendil-works" lib/contracts/` returns empty | YES |
| 4 | No import from `pi/` remains | `grep -r "from.*pi/" lib/contracts/` returns empty | YES |
| 5 | WorkerAdapter does NOT decide completion | Contract interface has no `verdict`, `completed`, `passed`, `PASS`, `HOLD`, `FAIL` fields | YES |
| 6 | No DB/runtime/controller assumptions in contracts | Contracts import only from `lib/`; no Kysely, Express, Fastify, pg, or process imports | YES |
| 7 | Contracts importable by kernel | Test file in `kernel/core/tests/` imports contracts and verifies types | YES |
| 8 | Contracts importable by server | Test file in `server/runtime/tests/` imports contracts and verifies types | YES |
| 9 | Contracts importable by interface | Test file in `interface/client/tests/` imports contracts and verifies types | YES |
| 10 | Contracts importable by adapters | Test file in `adapters/mock-worker/tests/` imports contracts and verifies types | YES |
| 11 | Contracts importable by hooks | Test file in `hooks/praxis-hook/tests/` imports contracts and verifies types | YES |
| 12 | Required contracts from D-101 are present | TaskSpec, PlanSpec, AcceptanceCriterion, WorkerAdapter, RunAttemptInput, RunAttemptResult, RuntimeEvent, RuntimeSnapshot, EvidenceRecord, GateVerdict, CircuitBreakerState, GovernorState, RepairPacket, ConflictReport — all exportable from `@praxis/contracts` | YES |

### Required Contracts (from D-101)

The following contracts must be present in `lib/contracts` and exportable:

| Contract | Purpose | Type |
|----------|---------|------|
| `TaskSpec` | Task definition with namespace, criteria, budget | Interface |
| `PlanSpec` | Plan definition with tasks, waves, dependencies | Interface |
| `AcceptanceCriterion` | Human-authored completion criterion | Interface |
| `WorkerAdapter` | Adapter contract interface | Interface |
| `RunAttemptInput` | Input to worker adapter runAttempt | Interface |
| `RunAttemptResult` | Normalized output from worker adapter | Interface |
| `RuntimeEvent` | Persisted event with seq, type, payload | Interface |
| `RuntimeSnapshot` | Full runtime state at a point in time | Interface |
| `EvidenceRecord` | Evidence Hash Chain record | Interface |
| `GateVerdict` | PASS / HOLD / FAIL verdict with metadata | Interface |
| `CircuitBreakerState` | CLOSED / OPEN / HALF_OPEN state | Type |
| `GovernorState` | Concurrency tier and metrics | Interface |
| `RepairPacket` | Structured repair context for worker retry | Interface |
| `ConflictReport` | Assembly conflict with resolution hint | Interface |

### What "WorkerAdapter does not decide completion" Means

The `WorkerAdapter` interface and `RunAttemptResult` type must not contain:

```typescript
// FORBIDDEN fields on RunAttemptResult:
verdict: 'PASS' | 'HOLD' | 'FAIL';   // Truth Engine owns verdicts
completed: boolean;                    // Truth Engine owns completion
passed: boolean;                       // Truth Engine owns pass/fail
```

Instead, `RunAttemptResult` contains normalized evidence:
```typescript
// ALLOWED fields on RunAttemptResult:
exitCode: number;
stdout: string;
stderr: string;
changedFiles: string[];
diff: string;
transcript?: TranscriptEntry[];
durationMs: number;
workerClaimedComplete: boolean;        // THIS is evidence, not a verdict
crashDetected?: CrashInfo;
rateLimitDetected?: RateLimitInfo;
```

The distinction is critical: `workerClaimedComplete` is a fact about what the worker SAID. It is not a verdict about whether the task IS complete.

### Failure Modes

- **Port misses tests:** Old test files not discovered by Bun test runner glob. Mitigation: verify test count matches 247 before declaring pass.
- **Silent type incompatibility:** TypeScript compiles but runtime behavior differs because old code assumed Node.js APIs. Mitigation: tests must exercise runtime behavior, not just types.
- **Contract carries old assumptions:** A type from the old project embeds a concept that does not exist in PRAXIS (e.g., old project's coding-agent-specific fields). Mitigation: manual review of every exported type before P0.2 exit.

---

## P0.3 Gate: ACCP Compiler Port

### Purpose

Port `pi/packages/accp-compiler` to `kernel/accp` with full test pass, namespace cleanup, and integration with `@praxis/contracts`. Ensure the compiler remains async and non-blocking, and that it is NOT treated as the PRAXIS Truth Engine.

### Gate Criteria

| # | Criterion | How Verified | Must Pass? |
|---|-----------|-------------|------------|
| 1 | `kernel/accp` package exists | Directory + package.json check | YES |
| 2 | All 135 ported tests pass under Bun | `bun test` in `kernel/accp` reports 135/135 passed | YES |
| 3 | No import from `pi/` remains | `grep -r "from.*pi/" kernel/accp/` returns empty | YES |
| 4 | No `@earendil-works` namespace remains | `grep -r "earendil-works" kernel/accp/` returns empty | YES |
| 5 | Evidence validator still detects false positives | Run validator against known false-positive test fixtures; validator flags them | YES |
| 6 | ACCP gate evaluator NOT treated as PRAXIS Truth Engine | ACCP compiler does not import from or export to `kernel/truth-engine`; compiler's own gate primitives are internal validation utilities only | YES |
| 7 | Compiler is async and non-blocking | `compiler.compile()` returns `Promise<CompiledPlan>`; no synchronous blocking I/O | YES |
| 8 | Compiler uses `@praxis/contracts` types | All contract imports come from `@praxis/contracts`, not from old packages | YES |
| 9 | Compiler has no Claude Code dependency | No import of Claude Code SDK or CLI; compiler is worker-agnostic | YES |
| 10 | Compiler has no runtime/server dependency | No import from `server/`, `adapters/`, or `interface/` | YES |

### What "ACCP Gate Evaluator is Not Truth Engine" Means

The old `accp-compiler` contains gate evaluation primitives (evidence validators, criteria matchers) that were used within ACCP's own pipeline. These primitives are internal to the ACCP compiler and serve ACCP's compilation and validation needs.

In PRAXIS, the Truth Engine (`kernel/truth-engine`) is a completely separate component that evaluates attempt completion. The ACCP compiler's internal validators:

- MAY be used to validate ACCP artifacts (FVR, PRR) during compilation
- MAY be used as reference patterns when designing Truth Engine gates
- MUST NOT be used to declare a task run complete
- MUST NOT be wired into the execution critical path
- MUST NOT emit PASS/HOLD/FAIL verdicts that affect TaskRun state

The boundary is: ACCP compiler validates ACCP artifacts. Truth Engine validates task completion. They are separate concerns with separate code and separate authority.

### Failure Modes

- **Compiler tests assume old contracts:** Tests import old contract types and pass because old types are still present. Mitigation: after removing old contracts package, verify tests still pass with `@praxis/contracts`.
- **Evidence validator false-negative:** Validator misses a known false positive because validation logic changed during port. Mitigation: port the false-positive test fixtures first, run them, confirm they still flag.
- **Compiler imports accidentally added during port:** A porting step adds an import from `server/` or `adapters/` for convenience. Mitigation: boundary checker (from P0.1) catches this automatically.

---

## P0.4 Gate: FSM Reference Doc

### Purpose

Extract and document the FSM, completion, state-authority, and deadline patterns from the old `pi/packages/execution-runtime` for reference in PRAXIS kernel/core design. This is a documentation-only artifact. No code is copied.

### Gate Criteria

| # | Criterion | How Verified | Must Pass? |
|---|-----------|-------------|------------|
| 1 | `docs/reference/old-pi-fsm-patterns.md` exists | File exists check | YES |
| 2 | Doc explicitly states old runtime must NOT be ported directly | Content check for rejection language | YES |
| 3 | Doc identifies useful patterns for PRAXIS kernel/core | Content check for pattern list with at least: FSM structure, completion predicate, state authority, deadline watchdog | YES |
| 4 | Doc identifies coupling risks (DB/Kysely) | Content check for coupling section naming Kysely and PostgreSQL specifics | YES |
| 5 | Doc references authoritative PRAXIS decisions | Content check for references to D-047, D-048, D-050 | YES |
| 6 | Doc does not contain copied source code | Content check: no TypeScript code blocks longer than 5 lines from old runtime | YES |
| 7 | Every identified pattern includes a rewrite recommendation | Each pattern section ends with "For PRAXIS, rewrite as: ..." guidance | YES |

### Required Pattern Coverage

The FSM reference doc must cover at minimum:

| Pattern | What to Document | Rewrite Guidance |
|---------|-----------------|-----------------|
| FSM structure | How old runtime models states, transitions, guards | PRAXIS kernel/core FSM is a clean rewrite; use old state names only if they map cleanly to PRAXIS TaskRun FSM |
| Completion predicate | How old runtime decides "is this task done?" | PRAXIS Truth Engine replaces this entirely; document old approach as anti-pattern for comparison |
| State authority | Which component owns state transitions | PRAXIS kernel owns all state authority; old code mixed state authority across modules |
| Deadline watchdog | How old runtime enforces time limits | Document timeout/abort patterns; PRAXIS may reuse the concept but with evidence-preservation on abort |
| Attempt lifecycle | How old runtime manages retry attempts | RIM strategy rotation replaces old retry logic; document old approach for comparison |
| Coupling risks | Where old runtime depends on Kysely, DB schema, coding-agent internals | Each coupling point is a warning for PRAXIS: do NOT replicate this dependency |

### Failure Modes

- **Doc copies code instead of describing patterns:** Mitigation: P0.4 gate criterion 6 limits code blocks to 5 lines max.
- **Doc presents old patterns as recommendations:** Mitigation: every pattern must have an explicit "For PRAXIS, rewrite as:" section that overrides the old approach.
- **Doc misses coupling risks:** Mitigation: the coupling risks section must be a dedicated, prominent section, not buried in pattern descriptions.

---

## P0 Exit Gate

### Purpose

The P0 Exit Gate is the final checkpoint before P2, P3, and P4 implementation can begin. It verifies that all sub-gates have passed, the forbidden-copy list is clean, and the reuse policy is documented and accepted.

### Gate Criteria

| # | Criterion | How Verified | Must Pass? |
|---|-----------|-------------|------------|
| 1 | P0.1 Gate passes | All P0.1 criteria verified | YES |
| 2 | P0.2 Gate passes | All P0.2 criteria verified | YES |
| 3 | P0.3 Gate passes | All P0.3 criteria verified | YES |
| 4 | P0.4 Gate passes | All P0.4 criteria verified | YES |
| 5 | Forbidden copy list verified clean | `grep -r` for each forbidden package name in PRAXIS tree returns zero results in source files (docs MAY reference them) | YES |
| 6 | No old runtime code directly imported | `grep -r "from.*execution-runtime"` in PRAXIS source returns empty | YES |
| 7 | No `pi/` imports in any PRAXIS source file | `grep -r "from.*['\"]\.\.\/.*pi\/"` or similar patterns return empty | YES |
| 8 | Reuse policy ADR exists | `docs/adr/` contains an ADR for the pi/ reuse policy | YES |
| 9 | All ported tests pass collectively | `bun test` at repository root passes (includes P0.2 247 + P0.3 135 + scaffold tests) | YES |
| 10 | Boundary checker reports zero violations | Run against entire PRAXIS tree; zero violations | YES |
| 11 | `bun run typecheck` passes | TypeScript strict mode, zero errors across all packages | YES |
| 12 | `bun run check` (Biome) passes | Lint + format, zero errors | YES |

### Forbidden Copy Verification

The following package names and paths must NOT appear in any PRAXIS source file (TypeScript, config, or build files). Documentation files (`.md`) MAY reference these packages by name for explanatory purposes.

**Forbidden in source code:**

```
coding-agent
pi/packages/coding-agent
@earendil-works/coding-agent
pi/packages/ai
@earendil-works/ai
pi/packages/db
@earendil-works/pi-db
pi/packages/web-server
@earendil-works/web-server
pi/packages/web-ui
@earendil-works/web-ui
pi/packages/tui
pi/packages/worker-adapters
pi/packages/execution-service
```

**Also forbidden:**
```
pi/packages/execution-runtime  (except in docs/reference/old-pi-fsm-patterns.md)
pi/packages/agent
pi/packages/brain
```

**Verification command (approximate):**
```bash
# Exclude docs/, node_modules/, .git/
grep -r --include='*.ts' --include='*.tsx' --include='*.json' \
  -l 'coding-agent\|pi/packages/ai\|pi/packages/db\|pi/packages/web-server\|pi/packages/web-ui\|pi/packages/tui\|pi/packages/worker-adapters\|pi/packages/execution-service\|pi/packages/agent\|pi/packages/brain' \
  praxis/kernel praxis/adapters praxis/hooks praxis/server praxis/interface praxis/lib praxis/tests
# Expected output: empty (no matches)
```

### What Happens After P0 Exit Gate Passes

Once the P0 Exit Gate passes:

1. **P2 (Mock Runtime Vertical Slice)** can begin — the mock worker, event bus, control plane, and SSE stream can be implemented using `@praxis/contracts`.
2. **P3 (Kernel Safety Core)** can begin — the Truth Engine, Circuit Breaker, PSAG, EHC, and RIM can be implemented, depending on `@praxis/contracts` and `kernel/accp`.
3. **P4 (Real Worker Integration)** can begin — the Claude Code adapter and hooks can be implemented, depending on `@praxis/contracts` and P2's runtime infrastructure.

P1 (Desktop mockup + runtime contract docs) can proceed in parallel with P0 since it has no code dependency on P0 outputs (it uses mock data).

### What MUST NOT Happen Before P0 Exit Gate

- No P2 server/runtime, control-plane, or event-bus implementation code
- No P3 kernel/core, truth-engine, circuit-breaker, or evidence implementation code
- No P4 adapter/claude-code or hooks/praxis-hook implementation code
- No P5 assembler or governor implementation code
- No real worker integration code of any kind
- No desktop-real-runtime connection code (mock connection is P1/P2 and is fine)

---

## Failure Modes (Cross-Cutting)

### Failure Mode 1: "Port" Becomes "Copy-Paste Migration"

**Scenario:** An agent, when asked to "port P0.2", copies the entire `pi/packages/execution-contracts` directory without adapting types, removing old namespace, or verifying PRAXIS law compliance.

**Detection:** P0.2 gate criteria 3-6 will fail (old namespace present, old imports, WorkerAdapter has completion fields).

**Prevention:** Porting prompts must explicitly list adaptation requirements (namespace rename, type removal, import replacement).

### Failure Mode 2: P2/P3/P4 Work Starts Before P0 Gate Passes

**Scenario:** Implementation of kernel, server, or adapters begins in parallel with P0, creating merge conflicts and rework when contracts change.

**Detection:** Git branch analysis shows P2/P3/P4 code merged before P0 test pass is confirmed.

**Prevention:** Branch protection or CI gate that blocks P2/P3/P4 branches from merging until P0 gate status is confirmed.

### Failure Mode 3: Forbidden Code Leaks Through Tests

**Scenario:** Test fixtures or test helpers import from old `pi/` packages or forbidden packages "just for testing."

**Detection:** Forbidden copy check runs on test files as well as source files.

**Prevention:** Boundary checker scope includes `tests/` directories.

### Failure Mode 4: Ported Tests Pass But Are Wrong

**Scenario:** 247 tests pass but they test old behavior that does not match PRAXIS requirements (e.g., WorkerAdapter with completion verdict field).

**Detection:** P0.2 gate criteria 5 (WorkerAdapter does not decide completion) and manual review of test assertions.

**Prevention:** Before declaring P0.2 pass, manually spot-check 10% of test files for PRAXIS law compliance.

### Failure Mode 5: ACCP Compiler Blocking the Critical Path

**Scenario:** During port, ACCP compiler is modified to return results synchronously or is wired into the attempt execution flow.

**Detection:** P0.3 gate criterion 7 (compiler is async and non-blocking) and criterion 6 (not wired to Truth Engine).

**Prevention:** Code review of ACCP compiler port must verify no synchronous I/O and no import from `kernel/truth-engine`.

---

## Test/Gate Implications

### For Implementation Planning

- P0.1 scaffold tests are NEW tests (no existing test suite to port). They must be written as part of P0.1.
- P0.2 contract tests are EXISTING tests (247 from execution-contracts) that must be ported and passing. Additional tests for importability and namespace cleanup are NEW.
- P0.3 compiler tests are EXISTING tests (135 from accp-compiler) that must be ported and passing. Additional tests for async behavior and non-Truth-Engine assertion are NEW.
- P0.4 has no code tests (it is a documentation artifact). Gate criteria are content checks.

### For CI Configuration

- CI must run on every push and every PR
- CI must fail if any gate criterion is not met
- CI artifacts must include test output in machine-parseable format (JSON reporter)
- CI must run boundary checker and forbidden copy checker as separate steps for clear failure attribution

### For Parallel Work

- P0.1 and P0.4 can be implemented in parallel (no file overlap, no code dependency)
- P0.2 must wait for P0.1 (needs monorepo scaffold)
- P0.3 must wait for P0.2 to produce stable contract shapes (not necessarily all 247 tests, but stable enough types)
- P1 (desktop mockup + contract docs) is independent of P0 and can run in parallel
- Day 0 Spike (Claude Code feasibility) is independent of P0 and can run in parallel

---

## Decision Compliance Checklist

- [ ] D-044: Document uses "Selective pi/ Reuse Foundation Port" terminology; "migration" is absent
- [ ] D-045: P0.2 defined as PORT_AND_ADAPT of execution-contracts to lib/contracts
- [ ] D-046: P0.3 defined as PORT_AND_ADAPT of accp-compiler to kernel/accp
- [ ] D-047: P0.4 defined as REFERENCE_ONLY extraction of FSM patterns
- [ ] D-048: Rewrite components are listed as NOT in P0 scope
- [ ] D-049: Forbidden packages are listed and verified at P0 Exit Gate
- [ ] D-050: Old runtime controller code is explicitly forbidden
- [ ] D-051: Full migration is rejected; no migration language in document
- [ ] D-110: P0 Exit Gate explicitly blocks P2/P3/P4
- [ ] D-018: No root src/ enforced at P0.1
- [ ] D-098: Contracts ported in P0.2; contract-first development is the foundation
- [ ] D-112: Parallelization rules documented (P0.1 + P0.4 parallel, P0.2 sequential after P0.1, P0.3 sequential after P0.2 shape stability)
- [ ] D-113: Safe parallel tasks identified
- [ ] D-114: P0.2 sequential dependency on P0.1 documented
- [ ] D-115: P0.3 sequential dependency on P0.2 documented

---

## Open Questions

1. **Contract shape stability threshold:** How many contracts must be stable before P0.3 can begin? "Stable enough" is subjective. Proposal: the 14 required contracts from D-101 must have their top-level fields defined (even if nested types are still in flux).
2. **P0.1 package skeleton depth:** How much source structure should each package skeleton have? Proposal: `package.json` + `src/index.ts` with a version export + `tsconfig.json` extending `tsconfig.base.json`. No implementation code.
3. **Boundary checker implementation:** Should the boundary checker be a custom Bun script, an ESLint plugin, or a separate tool? This is an implementation decision for P0.1, not a gate definition concern.
4. **Test porting tool:** Should tests be ported using a scripted namespace replacement or manually? Manual is safer but slower. Scripted is faster but risks missing semantic changes. This is an implementation decision.
5. **P0 Exit Gate automation:** Should the P0 Exit Gate be fully automated (CI check), or require manual sign-off? Proposal: automated criteria (tests, grep checks, boundary checker) run in CI. Manual review of ported types for PRAXIS law compliance. Both must pass.

---

## Audit Notes

- This document defines gate criteria, not implementation instructions. Separate implementation prompts must be written for P0.1 through P0.4.
- The 247 and 135 test counts are from the current `pi/` monorepo and must be verified against actual source before porting begins. Test files may have been added or removed.
- The forbidden copy list must be kept in sync with D-049. If D-049 is updated (via ADR), this document must be updated.
- Entry prerequisites 1-7 represent the P-1 phase completion criteria. If any prerequisite is not met, P0 cannot start.
- The P0 Exit Gate is referenced by D-110 as a HARD_LOCK. Changing P0 gate criteria requires an ADR if it affects the gate's ability to block P2/P3/P4.
