# PRAXIS

**Bitti mi gerçekten? — Verify whether the agent actually completed the task.**

PRAXIS is a **local Truth Kernel for agentic coding tools**. It verifies coding-agent outputs using human-approved acceptance criteria, local evidence, deterministic gates, and repair packets.

PRAXIS is **not a coding agent**. It does not write code, run its own agent loops, or compete with Claude Code, MiMo Code, or OpenCode. It sits above them and answers one question: *did the agent actually do what it claimed?*

---

## Project Status — v0.5

| Milestone | Status | Components |
|-----------|--------|------------|
| **v0.1** — Truth Kernel | ✅ Complete | 6-gate pipeline (Schema → Lock → Evidence → Wiring → Exec → Final), CLI (11 commands), Claude Code plugin (9 slash commands + 3 hooks), 167 tests |
| **v0.2** — Control Plane | ✅ Complete | Hono HTTP/SSE server (`@praxis/server`), Circuit Breaker, TestOutputParser, ACCP reports |
| **v0.3** — Desktop + Multi-Worker | ✅ Complete | Desktop Mission Control (`@praxis/desktop`, Electron + React + Vite), Governor (stable_3→16), Deterministic Assembler, Wave Scheduler |
| **v0.4** — Intelligence | ✅ Complete | AST import analysis, coverage gates, stable_16 concurrency, multi-agent desktop orchestration |
| **v0.5** — Daemon + MCP + Attestation | ✅ Latest | Daemon mode (warm state), MCP server (agent integration), evidence attestation (PEL-1), lock GC, 259 tests |

---

## What Is PRAXIS?

- **A deterministic Truth Kernel** — six gates (SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate) that verify agent outputs against human-approved criteria with PASS / HOLD / FAIL verdicts
- **A daemon mode** — persistent warm server that caches plan state, evidence index, and gate results for near-instant re-verification (`praxis daemon`, `praxis verify --daemon`)
- **An MCP server** — Model Context Protocol server for autonomous agent integration (Hermes, Claude Code, etc.) via stdio JSON-RPC (`@praxis/mcp-server`)
- **Evidence attestation (PEL-1)** — HMAC-SHA256 DSSE envelope signing for evidence records, preventing agent forgery of deterministic source claims
- **A CLI tool** — `praxis init`, `praxis plan validate`, `praxis plan lock`, `praxis plan gc`, `praxis verify`, `praxis daemon`, `praxis status`, `praxis ledger show`, `praxis report show`, `praxis repair show`, `praxis help`, `praxis version`
- **A Claude Code plugin** — slash commands (`/praxis:verify`, `/praxis:repair`, etc.) plus PreToolUse / PostToolUse / Stop hooks for automatic evidence capture
- **A local control plane** — Hono HTTP server with SSE streaming (`@praxis/server`, `127.0.0.1:3457`)
- **A Desktop Mission Control** — Electron + React dashboard for rich observability (`@praxis/desktop`)
- **A Circuit Breaker** — CLOSED / OPEN / HALF_OPEN safety mechanism with failure-rate and evidence-hash-chain break detection
- **A Repair Intelligence Module (RIM)** — 6 repair strategies across 7 attempts: initial → context_expand → tool_restrict → scope_narrow → knowledge_inject → hint_inject → ABORT
- **An Adaptive Concurrency Governor** — stable_3 → 6 → 8 → 12 → 16 tiers (each requiring 48h clean operation)

## What PRAXIS Is Not

- ❌ A coding agent (does not write code, does not run its own agent loop)
- ❌ A Claude Code clone or competitor
- ❌ An OpenCode / MiMo clone
- ❌ "Just a Claude Code plugin" — the kernel is independent; the plugin is a bridge

---

## Why PRAXIS Exists

AI coding agents are powerful but unreliable completion reporters.

| Problem | Symptom |
|---------|---------|
| **False Done** | Agent says "done" but the diff is empty |
| **Echo Chamber** | Agent writes the acceptance criteria AND passes them |
| **Missing Evidence** | Agent claims tests passed but never ran them |
| **Self-Reported Truth** | Agent's own status messages treated as completion |
| **Scattered Verification** | Evidence spread across messages, files, and terminal output |

PRAXIS solves these by being an **independent verification authority**. It does not trust agent claims. It checks evidence.

---

## The Three Laws

```
LAW 1 — COMPLETION AUTHORITY
  Agent says done ≠ done.
  Truth Kernel FinalGate PASS = done.
  Nothing else counts.

LAW 2 — WRITE AUTHORITY
  No worker writes to shared integration files.
  The Deterministic Assembler is the only shared writer.

LAW 3 — VERIFICATION AUTHORITY
  FinalGate criteria come from human-authored TaskSpec only.
  An agent cannot define or verify its own completion criteria.
```

---

## The 6-Gate Pipeline

```
PlanSpec YAML
    │
    ▼
SchemaGate — YAML parse → schema validate → semantic validate → hash
    │ PASS
    ▼
LockGate — create lock → verify lock → hash match → criteria freeze
    │ PASS
    ▼
EvidenceGate — read JSONL ledger → namespace check → required evidence → diff check
    │ PASS
    ▼
WiringGate — declared unit match → export check → entrypoint → orphan detect
    │ PASS
    ▼
ExecGate — validate commands → run → capture output → check results
    │ PASS
    ▼
FinalGate — evaluate criteria → aggregate verdict → produce report
    │
    ▼
PASS / HOLD / FAIL  ←  Repair packet generated on failure
```

### Verdict Ladder

| EvidenceGate | ExecGate | FinalGate | Overall |
|-------------|----------|-----------|---------|
| PASS | PASS | PASS | **PASS** — task complete |
| HOLD | PASS | PASS | HOLD — evidence gaps |
| PASS | HOLD | PASS | HOLD — execution gaps |
| PASS | PASS | HOLD | HOLD — criteria gaps |
| FAIL | * | * | **FAIL** |
| * | FAIL | * | **FAIL** |
| * | * | FAIL | **FAIL** |

---

## Architecture

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

---

## Project Layout

```
praxis/
├─ README.md                    ← This file
├─ architecture.md              ← Canonical architecture baseline
├─ ai_summary.md                ← Agent-readable project state
├─ todo.md                      ← Implementation todo / completion tracking
├─ CLAUDE.md                    ← Agent instructions
├─ package.json                 ← Root workspace monorepo
├─ tsconfig.base.json           ← Shared TypeScript config
│
├─ packages/
│  ├─ contracts/                @praxis/contracts — shared types, parsers, validators
│  ├─ kernel/                   @praxis/kernel — Truth Kernel (all 6 gates, evidence,
│  │                              wiring, executor, final, report, repair, lock, daemon, attestation)
│  ├─ cli/                      @praxis/cli — CLI binary (13 commands)
│  ├─ claude-plugin/            @praxis/claude-plugin — Claude Code plugin
│  │                              (9 slash commands + 3 hooks)
│  ├─ mcp-server/               @praxis/mcp-server — MCP server for agent integration
│  │                              (stdio JSON-RPC, Content-Length framing)
│  ├─ server/                   @praxis/server — Hono HTTP + SSE control plane (v0.2)
│  └─ desktop/                  @praxis/desktop — Electron + React Mission Control (v0.3)
│
├─ docs/                        Architecture docs, ADRs, contracts, pipeline specs
│  ├─ decisions.md              ← Canonical decision register
│  ├─ adr/                      ← Architecture Decision Records
│  ├─ contracts/                ← Contract specifications
│  ├─ pipelines/                ← Pipeline/flow specifications
│  ├─ implementation/           ← Implementation gates
│  └─ testing/                  ← Test strategies
│
├─ reports/                     ACCP readiness reports
│  └─ accp/                     ACCP YAML audit reports
│
├─ design/                      Architecture design packs (historical)
├─ artifacts/                   Zip archives of documentation snapshots
└── pi/                         Old Pi monorepo (reference only — NOT active code)
```

---

## Packages

| Package | Location | Tests | Status |
|---------|----------|-------|--------|
| `@praxis/contracts` | `packages/contracts/` | 31/31 | ✅ PASS_LOCKED |
| `@praxis/kernel` | `packages/kernel/` | 212/212 | ✅ PASS_LOCKED |
| `@praxis/cli` | `packages/cli/` | 13/13 | ✅ COMPLETE |
| `@praxis/claude-plugin` | `packages/claude-plugin/` | 20/20 | ✅ COMPLETE |
| `@praxis/mcp-server` | `packages/mcp-server/` | 3/3 | ✅ COMPLETE |
| **Total** | | **279** | **ALL PASS** |

### CLI Commands

| Command | Description |
|---------|-------------|
| `praxis init` | Initialize PlanSpec YAML template |
| `praxis plan validate` | Validate PlanSpec schema + semantics |
| `praxis plan lock` | Create/verify plan lock file |
| `praxis plan gc` | Garbage collect old lock files (`--keep-latest`) |
| `praxis verify` | Run 6-gate pipeline, persist results |
| `praxis verify --daemon` | Connect to warm daemon for fast re-verification |
| `praxis verify --gates` | Gate filter (e.g., `--gates=schema,lock,exec,final`) |
| `praxis daemon` | Start persistent daemon server |
| `praxis status` | Show current/previous run status |
| `praxis ledger show` | Display evidence ledger records |
| `praxis report show` | Generate verification report |
| `praxis repair show` | Show repair packet for failed runs |
| `praxis help` | Usage information |
| `praxis version` | Version string |

### Claude Code Plugin Slash Commands

`/praxis:init`, `/praxis:plan validate`, `/praxis:plan lock`, `/praxis:verify`, `/praxis:status`, `/praxis:report`, `/praxis:ledger`, `/praxis:repair show`, `/praxis:help`

Plus PreToolUse / PostToolUse / Stop hooks for automatic evidence capture.

---

## Quick Start

```bash
# Install dependencies
bun install

# Run all tests
bun test

# Type-check all packages
bun run typecheck

# Initialize PRAXIS in a project
praxis init

# Validate a plan
praxis plan validate --plan .praxis/plan.yaml

# Lock the plan (freezes acceptance criteria)
praxis plan lock --plan .praxis/plan.yaml

# Run verification (cold path)
praxis verify --plan .praxis/plan.yaml

# Start daemon for fast re-verification (warm path)
praxis daemon

# Verify via daemon (near-instant after first run)
praxis verify --daemon --plan .praxis/plan.yaml

# Garbage collect old lock files
praxis plan gc --keep-latest
```

### Daemon Mode

The daemon keeps plan state, evidence index, and gate results in memory across verify calls. First run is cold (~2-3s), subsequent runs are near-instant (~50ms for cached gates).

```bash
# Start daemon (background)
praxis daemon

# Verify via daemon
praxis verify --daemon --plan .praxis/plan.yaml

# Skip expensive gates during development
praxis verify --daemon --gates=schema,lock,exec,final --plan .praxis/plan.yaml
```

### MCP Server (Agent Integration)

The MCP server exposes PRAXIS verification as MCP tools for autonomous agents:

```bash
# Start MCP server (stdio transport)
bun run packages/mcp-server/src/index.ts
```

Tools available:
- `praxis_verify` — full 6-gate pipeline
- `praxis_validate` — schema-only validation (fast path)
- `praxis_status` — daemon status
- `praxis_cache_stats` — gate cache hit/miss statistics

### Manual Verify/Repair Loop

```
1. praxis init                  ← Initialize .praxis/ workspace
2. Define .praxis/task.yaml     ← Human-approved acceptance criteria
3. Let the agent do the work    ← Agent runs independently
4. praxis verify                ← Kernel checks evidence → PASS / HOLD / FAIL
5. If HOLD/FAIL: praxis repair  ← Generate repair packet for failed criteria
6. Let agent fix failures       ← Agent addresses specific criteria
7. praxis verify                ← Re-verify
8. PASS → praxis report         ← Generate audit report
```

---

## Key Design Decisions

| ADR | Decision |
|-----|----------|
| 001 | ACCP is always async — prevents execution deadlock |
| 002 | Assembler is wave-level only — per-task assembly breaks parallelism |
| 003 | stable_16 is the concurrency ceiling |
| 004 | acceptance_criteria is human-authored only — prevents echo chamber (LAW 3) |
| 005 | Claude Code NO-GO → Messages API fallback — if hooks unreliable, fallback to custom agent loop |

---

## Roadmap

| Version | Focus | Status |
|---------|-------|--------|
| v0.1 | Truth Kernel + CLI + Plugin | ✅ Complete |
| v0.2 | Control Plane (server, SSE, Circuit Breaker) | ✅ Complete |
| v0.3 | Desktop Mission Control + Governor + Assembler | ✅ Complete |
| v0.4 | AST analysis, coverage gates, stable_16, Multi-agent | ✅ Complete |
| v0.5 | Daemon, MCP server, Evidence Attestation (PEL-1), Lock GC | ✅ Latest |
| v0.6+ | PEL-2 (Merkle log), cloud dashboard, postgres persistence | 🔜 Future |

---

## References

- `architecture.md` — Full architecture baseline
- `docs/decisions.md` — Canonical decision register with HARD/SOFT/OPEN lock classification
- `docs/adr/` — Architecture Decision Records
- `docs/pipelines/` — Detailed pipeline specifications
- `docs/contracts/` — Contract specifications (TaskSpec, PlanSpec, WorkerAdapter, etc.)
- `ai_summary.md` — Agent-maintained project state (read first each session)
- `todo.md` — Full implementation tracking
