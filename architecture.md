# PRAXIS Architecture

**Version:** 0.3 (post-ADR-013 Plugin-First Pivot)
**Status:** Draft architecture baseline — design only, implementation not authorized
**Audience:** AI coding agents, maintainers, reviewers
**Canonical decisions:** `docs/decisions.md`
**Authoritative ADR:** `docs/adr/ADR-013-plugin-first-pivot.md`

> **Plugin-First Pivot (ADR-013):** PRAXIS is a local Truth Kernel with Claude Code plugin as the first UX bridge. Desktop Mission Control, server/runtime, SSE, PostgreSQL, Circuit Breaker, Governor, and multi-worker orchestration are **future scope for v0.1**. The previous desktop-first architecture (architecture.md v0.2) is superseded for v0.1 and preserved in the Superseded section below.

---

## Architecture Status

| Field | Value |
|-------|-------|
| Version | 0.3 (post-pivot) |
| v0.1 Product | Local Truth Kernel + praxis CLI + Claude Code plugin bridge |
| v0.1 Scope | Manual verify/repair via CLI and slash commands |
| Implementation | NOT authorized — design stages D0-D4 only |
| Previous version | 0.2 (desktop-first orchestrator — superseded for v0.1) |

---

## Product Identity

**PRAXIS is a local Truth Kernel for agentic coding tools.**

It answers one question: *"Did the agent actually complete the task?"*

PRAXIS is not a coding agent. It does not write code, run agent loops, or compete with Claude Code/MiMo/OpenCode. It is a verification layer above them — an independent completion authority that checks evidence against human-approved criteria.

### Core Invariants

- Agent claims are not completion. Kernel-verified evidence is completion. (Law 1)
- Human-authored acceptance criteria are mandatory. Agent-generated criteria are drafts only. (Law 3)
- The Claude Code plugin is a bridge, not the kernel. Plugin displays verdicts; kernel produces them.
- The kernel is agent-agnostic. It verifies evidence from any coding agent.

---

## v0.1 Architecture Overview

PRAXIS v0.1 is deliberately minimal — a CLI tool plus a Claude Code plugin bridge, both talking to a local Truth Kernel.

```
┌──────────────────────────────────────────┐
│           Claude Code Session             │
│                                          │
│  /praxis:init    /praxis:spec             │
│  /praxis:verify  /praxis:repair           │
│  /praxis:status  /praxis:report           │
└──────────────┬───────────────────────────┘
               │ calls
               ▼
┌──────────────────────────────────────────┐
│            praxis CLI                     │
│                                          │
│  init   spec   verify   repair            │
│  status   report                         │
└──────────────┬───────────────────────────┘
               │ invokes
               ▼
┌──────────────────────────────────────────┐
│         Local Truth Kernel                │
│                                          │
│  EvidenceGate  →  ExecGate  →  FinalGate  │
│                                          │
│  TestOutputParser                        │
│  RepairPacket Generator                  │
│  Report Generator                        │
└──────────────┬───────────────────────────┘
               │ reads/writes
               ▼
┌──────────────────────────────────────────┐
│           .praxis/ Workspace              │
│                                          │
│  task.yaml          (human-approved)      │
│  runs/<id>/evidence.jsonl                │
│  runs/<id>/commands.jsonl                │
│  runs/<id>/verdict.json                  │
│  reports/<id>.md                         │
└──────────────────────────────────────────┘
```

### Architecture Principles

1. **Kernel owns truth.** No other component may produce PASS/HOLD/FAIL.
2. **Plugin bridges, kernel decides.** The plugin calls the CLI and displays results.
3. **Evidence over claims.** Agent self-reports are evidence inputs, not verdicts.
4. **Human over agent.** Only human-approved acceptance criteria can gate completion.
5. **Manual over automatic (v0.1).** Operator explicitly invokes verification.
6. **Local files over server.** `.praxis/` is flat files; no database, no HTTP, no SSE.

---

## High-Level Flow

```
Claude Code
├─ /praxis:init        → praxis init
├─ /praxis:spec        → praxis spec
├─ /praxis:verify      → praxis verify --task .praxis/task.yaml --workspace .
├─ /praxis:repair      → praxis repair --last-run
└─ /praxis:status      → praxis status
        │
        ▼
   praxis CLI
        │
        ▼
  local Truth Kernel
        │
  ┌─────┴─────┐
  │           │
  ▼           ▼
Evidence    .praxis/
Collection  task.yaml
  │           │
  ▼           ▼
EvidenceGate ──► ExecGate ──► FinalGate
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                  PASS                HOLD / FAIL
                    │                       │
                    ▼                       ▼
              Report Gen             RepairPacket Gen
```

---

## Core Components

### praxis CLI

The primary operator interface for v0.1. A local binary with six commands:

| Command | Purpose |
|---------|---------|
| `praxis init` | Initialize `.praxis/` workspace |
| `praxis spec` | Help draft task.yaml (human must approve) |
| `praxis verify` | Run Truth Kernel gates against evidence |
| `praxis repair` | Generate repair packet from failed criteria |
| `praxis status` | Show current task state |
| `praxis report` | Generate audit report |

### Local Truth Kernel

The completion authority. Reads task.yaml, collects evidence, runs three gates in sequence, produces verdicts and repair packets.

### Claude Code Plugin Bridge

A thin presentation layer exposing six slash commands. Each slash command calls the equivalent `praxis` CLI command. The plugin does not contain truth logic — it displays what the kernel produces.

### .praxis Workspace

The local state directory containing task specification, evidence records, verdicts, and reports. All plain files (YAML, JSONL, JSON, Markdown).

---

## Package Architecture (Design Only)

> **Design suggestion only.** Packages are not created. Implementation is not authorized.

```
packages/
├─ contracts/          @praxis/contracts
│  └─ Types: TaskSpec, AcceptanceCriterion, EvidenceRecord, GateVerdict, RepairPacket
├─ kernel/             @praxis/kernel
│  └─ Truth Kernel: EvidenceGate, ExecGate, FinalGate, TestOutputParser, reports
├─ cli/                @praxis/cli
│  └─ CLI binary: init, spec, verify, repair, status, report
├─ claude-plugin/      @praxis/claude-plugin
│  └─ Claude Code plugin: slash commands, optional hook capture (future)
└─ test-parsers/       @praxis/test-parsers
   └─ Test output parsers: Vitest, Jest, Pytest, Go test
```

### Explicitly NOT v0.1 Packages

`@praxis/server`, `@praxis/desktop`, `@praxis/electron`, `@praxis/storage`, `@praxis/adapters`, `@praxis/hooks`

### Dependency Direction

```
contracts ← kernel ← cli ← claude-plugin
```

- `contracts` has zero dependencies (shared types only)
- `kernel` imports `contracts` (business logic)
- `cli` imports `kernel` (wires commands to kernel)
- `claude-plugin` calls `cli` (thin bridge, not a code dependency)

---

## Local Project State (.praxis/)

```
.praxis/
  task.yaml                    ← Human-approved task spec
  config.yaml                  ← Optional PRAXIS configuration
  runs/
    <run_id>/
      evidence.jsonl           ← Evidence records (one per line)
      commands.jsonl           ← Command execution logs
      verdict.json             ← Gate verdict with details
  reports/
    <run_id>.md                ← Final audit report
```

### task.yaml (Minimal)

```yaml
task_id: "PRAXIS-2026-001"
title: "Add health check endpoint"
workspace: "."
namespace:
  - "src/server/routes/health.ts"
acceptance_criteria:
  - id: "AC-001"
    description: "Health endpoint file exists"
    verification_method: "file_exists"
    verification_detail: "src/server/routes/health.ts"
    required_evidence: ["file_content"]
    required: true
    human_approved: true
    criteria_source: "human"
required_commands:
  - "bun test"
allowed_files:
  - "src/server/routes/health.ts"
evidence_requirements:
  - type: "git_diff"
    path: "."
    required: true
completion_policy: "all_criteria"
human_approved: true
```

### evidence.jsonl (One Record Per Line)

```jsonl
{"id":"ev-001","timestamp":"2026-06-18T14:30:00Z","source":"git","kind":"diff","content":"3 files changed","hash":"abc123"}
{"id":"ev-002","timestamp":"2026-06-18T14:30:01Z","source":"test-runner","kind":"test_output","content":"12 passed, 0 failed","hash":"def456"}
```

### verdict.json

```json
{
  "run_id": "run-20260618-143000",
  "task_id": "PRAXIS-2026-001",
  "verdict": "PASS",
  "evidence_gate": {"verdict": "PASS", "reason": "Git diff (3 files), command logs, test output found"},
  "exec_gate": {"verdict": "PASS", "reason": "bun test: 12 passed, 0 failed. bun run typecheck: passed"},
  "final_gate": {"verdict": "PASS", "reason": "3/3 criteria met"},
  "failed_criteria": [],
  "timestamp": "2026-06-18T14:30:05Z"
}
```

---

## Truth Kernel Gates

### EvidenceGate

**Question:** Does evidence exist?

**Checks:** git diff non-empty, required files present, command logs present, test output parseable.

**Outcomes:** PASS (sufficient evidence), HOLD (partial evidence), FAIL (evidence contradicts claims or critical evidence missing).

### ExecGate

**Question:** Did commands/tests actually run?

**Checks:** Required commands in command log, tests ran (count > 0), test exit codes, zero-test-ran detection.

**Zero-test-ran detection:** ExecGate catches when a test runner is invoked but finds no tests, all tests are skipped, or the test file is empty. Running zero tests is not evidence of passing tests.

**Outcomes:** PASS (commands executed, tests ran and passed), HOLD (ambiguous), FAIL (tests failed, commands errored, or zero tests ran).

### FinalGate

**Question:** Do results meet human-authored acceptance criteria?

**Flow:**
1. Read `.praxis/task.yaml`
2. Check `human_approved`. If `false` → FAIL immediately.
3. For each criterion: collect evidence → execute verification method → record verdict.
4. Apply `completion_policy` (`all_criteria` / `any_criteria`).
5. Produce FinalGate verdict.

**Key rule:** Agent claims are evidence, not verdicts. Agent-generated criteria (`criteria_source: "agent"`, `human_approved: false`) are skipped with warning.

**Outcomes:** PASS (all required criteria met), HOLD (some unverified), FAIL (criteria not met or not human-approved).

### Verdict Ladder

| EvidenceGate | ExecGate | FinalGate | Overall |
|-------------|----------|-----------|---------|
| PASS | PASS | PASS | **PASS** |
| HOLD | PASS | PASS | HOLD |
| PASS | HOLD | PASS | HOLD |
| PASS | PASS | HOLD | HOLD |
| FAIL | * | * | **FAIL** |
| * | FAIL | * | **FAIL** |
| * | * | FAIL | **FAIL** |

---

## Claude Code Plugin Bridge

The plugin is a **thin bridge**, not the kernel.

### What the Plugin Does

- Exposes six slash commands: `/praxis:init`, `/praxis:spec`, `/praxis:verify`, `/praxis:repair`, `/praxis:status`, `/praxis:report`
- Each command calls the equivalent `praxis` CLI command
- Displays CLI output (verdicts, repair packets, reports) to the user
- Warns when `human_approved: false` on verify

### What the Plugin MUST NOT Do

- Decide PASS/HOLD/FAIL (kernel owns this)
- Modify evidence (kernel reads evidence directly)
- Set `human_approved: true` (human-only action)
- Override kernel verdicts
- Claim completion on behalf of the agent
- Own truth logic of any kind

### Plugin → CLI → Kernel Flow

```
User types /praxis:verify
  → Plugin executes: praxis verify --task .praxis/task.yaml --workspace .
  → CLI invokes kernel
  → Kernel reads task.yaml, collects evidence, runs gates
  → Kernel returns verdict JSON
  → CLI formats output
  → Plugin displays formatted output to user
```

---

## Manual Verify/Repair Loop

v0.1 is explicitly manual. The operator decides when to verify.

```
┌─────────────────────────────────────────┐
│ 1. INITIALIZE                           │
│    /praxis:init                         │
│    → .praxis/ workspace created         │
├─────────────────────────────────────────┤
│ 2. DEFINE TASK                          │
│    /praxis:spec                         │
│    → Agent drafts task.yaml             │
│    → Human reviews and approves         │
├─────────────────────────────────────────┤
│ 3. AGENT WORKS (independent)            │
│    Claude Code writes code, runs tests  │
│    PRAXIS NOT involved in this step      │
├─────────────────────────────────────────┤
│ 4. VERIFY                               │
│    /praxis:verify                       │
│    → Kernel collects evidence           │
│    → EvidenceGate → ExecGate → FinalGate│
│    → Verdict: PASS / HOLD / FAIL        │
├─────────────────────────────────────────┤
│ 5a. IF PASS                             │
│    /praxis:report                       │
│    → Audit report generated             │
├─────────────────────────────────────────┤
│ 5b. IF HOLD/FAIL                        │
│    /praxis:repair                       │
│    → RepairPacket generated             │
│    → Operator gives to agent             │
│    → Agent fixes issues (step 3 again)   │
│    → /praxis:verify (step 4 again)      │
└─────────────────────────────────────────┘
```

### Why Manual First?

- Proves the kernel works before adding automation complexity
- Operator stays in the loop for safety
- No hook reliability dependency in v0.1
- Simpler to debug and validate

---

## Evidence Model

### Evidence Types

| Type | Source | Collection Method |
|------|--------|-------------------|
| `git_diff` | Git working tree | `git diff --stat` / `git diff` |
| `command_log` | Shell history or capture | Read from `.praxis/runs/<id>/commands.jsonl` |
| `test_output` | Test runner stdout | Read from `.praxis/runs/<id>/test-output.txt` |
| `file_content` | Workspace files | `stat` / file read for `file_exists` checks |
| `hook_capture` | Claude Code hooks (future) | Read from hook spool directory |

### EvidenceRecord (JSONL)

```json
{
  "id": "ev-001",
  "attempt_id": "run-20260618-143000",
  "timestamp": "2026-06-18T14:30:00Z",
  "source": "git",
  "kind": "diff",
  "content": "src/server/routes/health.ts | 15 +++++++++++",
  "content_hash": "sha256:abc123..."
}
```

### Evidence Principles

- Evidence is collected from the workspace, not from agent claims
- Agent self-report ("I ran the tests") is recorded but not trusted as sole evidence
- Missing evidence → HOLD (cannot verify without evidence)
- Contradictory evidence → FAIL (evidence contradicts agent claims)

---

## Report Model

`praxis report` generates a Markdown audit report:

```markdown
# PRAXIS Audit Report

**Task:** PRAXIS-2026-001 — Add health check endpoint
**Run ID:** run-20260618-143000
**Verdict:** PASS
**Date:** 2026-06-18T14:30:05Z

## Evidence Summary
- Git diff: 3 files changed
- Commands: bun test, bun run typecheck
- Tests: 12 passed, 0 failed

## Gate Results
### EvidenceGate: PASS
### ExecGate: PASS
### FinalGate: PASS (3/3 criteria met)

## Criteria Results
| ID | Description | Verdict |
|----|-------------|---------|
| AC-001 | Health endpoint file exists | PASS |
| AC-002 | Health endpoint tests pass | PASS |
| AC-003 | GET /health returns 200 | PASS |
```

---

## Security and Trust Boundaries

### Trust Model

```
Trusted (kernel)            Untrusted (agents)
─────────────────────       ─────────────────────
praxis CLI                  Claude Code
Truth Kernel                MiMo Code
.praxis/task.yaml           OpenCode
evidence collection         Agent self-reports
gate evaluation             Agent-generated criteria
verdict production          Agent completion claims
repair packet generation
```

### Key Boundaries

1. **Kernel ↔ Agent:** Kernel reads agent output as evidence only. Agent cannot influence gate logic.
2. **Plugin ↔ Kernel:** Plugin calls CLI. Plugin has no direct access to kernel internals.
3. **Human ↔ Kernel:** Human writes acceptance criteria in task.yaml. Kernel enforces `human_approved` flag.
4. **File System:** `.praxis/` is the trust boundary. Evidence outside `.praxis/` (in the workspace) is read but not modified by the kernel.

---

## Future Architecture (v0.2+)

The following components are preserved in the roadmap but are NOT v0.1. All are design-only until the kernel is proven.

### v0.2 — Local Control Plane

```
                     ┌─────────────────────┐
                     │  Claude Code Plugin   │
                     │  (slash commands)     │
                     └─────────┬───────────┘
                               │
                     ┌─────────▼───────────┐
                     │  praxis CLI           │
                     │  (11 commands)        │
                     └─────────┬───────────┘
                               │
┌──────────────────────────────▼──────────────────────────┐
│  Local Server (@praxis/server, Hono)                    │
│  127.0.0.1:3457                                         │
│  REST: GET /health, GET /api/snapshot, GET /api/events  │
│  SSE:  GET /api/events/stream                           │
│  POST: /api/verify (delegates to kernel)                │
│  Event bus: in-memory ring buffer (1000 events)         │
└──────────────────────────────┬──────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────┐
│  Truth Kernel (@praxis/kernel)                           │
│  6 gates: Schema → Lock → Evidence → Wiring → Exec →    │
│  Final                                                    │
│  Circuit Breaker: CLOSED/OPEN/HALF_OPEN, failure rate    │
│  threshold (30% in 10min)                                │
│  TestOutputParser: Vitest, Jest, Pytest                  │
│  Report formats: JSON, Markdown, ACCP YAML               │
│  Monitored via: 150+ tests, 3100 MC iterations           │
└──────────────────────────────────────────────────────────┘
```

The `@praxis/server` package provides the local control plane. It runs a Hono HTTP server bound to `127.0.0.1` with REST endpoints and SSE streaming. An in-memory event bus stores the last 1000 events with subscriber notification. The server is a thin dispatch layer — it delegates all gate logic to `@praxis/kernel`.

The **Circuit Breaker** (`packages/kernel/src/circuit-breaker/`) is a kernel-owned safety component that prevents work admission when the system is unstable. Three states: CLOSED (normal), OPEN (rejecting), HALF_OPEN (probing). Transitions are triggered by failure rate exceeding threshold (30% in 10-minute sliding window). The Circuit Breaker is independent of the server — it operates at the kernel level and is consumable by any adapter or bridge.

### v0.3 — Desktop + Multi-Worker

```
Desktop Mission Control (Electron)
     │
     ▼
Local Server + SSE
     │
     ▼
Truth Kernel + Circuit Breaker + Governor
     │
     ▼
Wave Scheduler → Worker A, Worker B, Worker C
     │
     ▼
Deterministic Assembler
```

### Future Component Summary

| Component | Target | Purpose |
|-----------|--------|---------|
| Server/runtime (Hono) | v0.2 | HTTP API + SSE for remote/desktop query |
| PostgreSQL | v0.2 | Durable event log with replay |
| Circuit Breaker | v0.2 | System safety — OPEN on high failure rate |
| MiMo/OpenCode adapters | v0.2 | Additional agent bridges |
| Automatic repair loops | v0.2 | Hook-based verify/repair dispatch |
| Desktop Mission Control | v0.3 | Rich observability UI (Electron + React) |
| Governor | v0.3 | Concurrency control (stable_3 first) |
| Wave Scheduler | v0.3 | Multi-worker task scheduling |
| Deterministic Assembler | v0.3 | Safe multi-worker integration |
| stable_16 | v0.3+ | Concurrency ceiling (hypothesis) |
| Multi-agent dashboard | v0.4+ | Cross-agent Mission Control |

---

## Superseded Desktop-First Architecture

The previous architecture (architecture.md v0.2) described PRAXIS as:

- A desktop-first multi-agent coding orchestrator
- Primary interface: Desktop Mission Control (Electron + React)
- Runtime: local Hono server with SSE event stream
- Storage: PostgreSQL with append-only event log and RuntimeSnapshot
- Concurrency: Governor with stable_3 → stable_16 tiers
- Safety: Circuit Breaker with CLOSED/OPEN/HALF_OPEN states
- Integration: Deterministic Assembler for multi-worker output

This architecture is **superseded for v0.1** by the Plugin-First Pivot (ADR-013). These components are preserved in the Future Architecture section above but are not v0.1 requirements.

The original architecture docs remain in:
- `docs/pipelines/runtime-event-flow.md` (marked future)
- `docs/pipelines/circuit-breaker-governor.md` (marked future)
- `docs/pipelines/wave-scheduler.md` (marked future)
- `docs/pipelines/deterministic-assembler.md` (marked future)
- `docs/contracts/runtime-event.contract.md` (marked future)
- `docs/contracts/runtime-snapshot.contract.md` (marked future)
- `docs/contracts/governor.contract.md` (marked future)
- `docs/contracts/circuit-breaker.contract.md` (marked future)

---

## Non-Goals (v0.1)

- Desktop Mission Control (Electron app)
- Local HTTP server (Hono)
- SSE event stream
- PostgreSQL storage
- RuntimeSnapshot / RuntimeEvent sourcing
- Circuit Breaker
- Governor / concurrency control
- Multi-worker orchestration
- Wave Scheduler / Deterministic Assembler
- Automatic hook-based verification
- Automatic repair dispatch
- MiMo/OpenCode/Hermes adapters
- Own coding agent loop
- Subagent engine

---

## Implementation Readiness

| Factor | Status |
|--------|--------|
| Product identity locked | ✅ HARD_LOCK (D-127, D-128) |
| v0.1 scope defined | ✅ D-132 through D-141 |
| Design stages D0-D1 complete | ✅ |
| Design stages D2-D4 remaining | 🔜 Next steps |
| Implementation authorized | ⛔ No |
| Blocking gate | D4 Final Plugin-First Design Lock Audit |

**Implementation must not start until D4 is complete and the human project owner explicitly authorizes it.**

---

## Open Questions

1. **Should v0.1 support project-local `.praxis/` or only global `~/.praxis/`?** Tentative: both, local takes precedence.
2. **Should evidence collection be automatic (git) or manual (operator provides paths)?** Tentative: automatic for git/known locations, manual for test output if hooks unavailable.
3. **Should RepairPacket be JSON (machine-readable) or Markdown?** Tentative: both — JSON for tool consumption, Markdown for human review.
4. **Should the kernel be a standalone binary or a library?** Tentative: CLI binary first; library extraction later if needed.
5. **When should Desktop Mission Control be reconsidered?** After v0.1 validates the kernel with real sessions and user feedback confirms need for richer observability.
6. **Should MiMo/OpenCode plugins follow the same CLI-bridge pattern?** Yes — same kernel, different plugin bridges.
