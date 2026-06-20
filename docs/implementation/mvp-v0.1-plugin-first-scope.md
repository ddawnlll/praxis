# MVP v0.1 — Plugin-First Scope

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Canonical decisions:** `docs/decisions.md`
**Authoritative ADR:** `docs/adr/ADR-013-plugin-first-pivot.md`

> **Implementation note:** This document defines the v0.1 MVP scope. Implementation is NOT yet authorized. All phases remain DESIGN ONLY until the Final Plugin-First Design Lock Audit (D4) is complete and the human project owner explicitly authorizes implementation.

---

## Purpose

Define the exact v0.1 Plugin-First Truth Kernel MVP scope, non-goals, and exit criteria. This document is the single reference for what is and is not in v0.1.

---

## Exact v0.1 Scope

### praxis CLI (6 commands)

| Command | Purpose | Input | Output |
|---------|---------|-------|--------|
| `praxis init` | Initialize `.praxis` workspace | — | `.praxis/` with task.yaml skeleton, `runs/`, `reports/` |
| `praxis spec` | Help draft task spec | Agent-provided description, options | Draft task.yaml (human must approve) |
| `praxis verify` | Run Truth Kernel gates | `.praxis/task.yaml` + workspace evidence | PASS / HOLD / FAIL verdict to stdout |
| `praxis repair` | Generate repair packet | Last verify run ID | RepairPacket to stdout/file |
| `praxis status` | Show current state | — | Task ID, last verdict, evidence count, failed criteria |
| `praxis report` | Generate final audit report | Run ID | `.praxis/reports/<run_id>.md` |

### Local Truth Kernel

| Component | Purpose |
|-----------|---------|
| EvidenceGate | Check evidence exists: diff, changed files, command logs, test logs |
| ExecGate | Check commands/tests ran and produced parseable results |
| FinalGate | Check human-authored criteria against evidence |
| TestOutputParser | Parse test runner output (Vitest, Jest, Pytest, Go test) |
| RepairPacket generator | Generate constrained repair guidance from failed criteria |
| Report generator | Produce Markdown audit report |

### Claude Code Plugin (Design Only — 6 slash commands)

| Slash Command | Calls |
|---------------|-------|
| `/praxis:init` | `praxis init` |
| `/praxis:spec` | `praxis spec` |
| `/praxis:verify` | `praxis verify --task .praxis/task.yaml --workspace .` |
| `/praxis:repair` | `praxis repair --last-run` |
| `/praxis:status` | `praxis status` |
| `/praxis:report` | `praxis report` |

The plugin is a thin bridge. It calls the CLI and displays results. It does NOT own truth logic.

### .praxis Workspace

```
.praxis/
  task.yaml                    ← Human-approved task spec
  config.yaml                  ← Optional PRAXIS config
  runs/
    <run_id>/
      evidence.jsonl           ← Evidence records
      commands.jsonl           ← Command execution logs
      verdict.json             ← Gate verdict with details
  reports/
    <run_id>.md                ← Final audit report
```

### Evidence Files

| File | Format | Content |
|------|--------|---------|
| `evidence.jsonl` | JSONL | One EvidenceRecord per line: id, timestamp, source, kind, content, hash |
| `commands.jsonl` | JSONL | One command record per line: command, exit_code, stdout_summary, stderr_summary, duration_ms |
| `verdict.json` | JSON | GateVerdict: verdict (PASS/HOLD/FAIL), evidence_gate, exec_gate, final_gate details, failed_criteria |

### Reports

`<run_id>.md` — Markdown: task summary, verdict, criterion-by-criterion results, evidence summary, repair suggestions.

---

## Exact v0.1 Non-Goals (Must NOT Build)

- Electron Desktop Mission Control
- HTTP server (Hono or any)
- SSE event stream
- PostgreSQL database
- RuntimeSnapshot API
- RuntimeEvent sourcing model
- Circuit Breaker
- Governor (any concurrency tier)
- stable_16 (or any concurrency scaling)
- Wave scheduler
- Deterministic Assembler
- Multi-worker orchestration
- Own coding agent loop
- Subagent engine
- Memory/context compaction system
- Automatic repair loop (manual only)
- Stop hook automatic verification
- MiMo/OpenCode/Hermes adapters
- ACCP-lite artifact generation (beyond Markdown reports)

### Must NOT Require

- Desktop environment (CLI-only is fine)
- Server process (CLI is a one-shot binary)
- Database connection (files only)
- Network access (local only)
- Claude Code running (verification works on any workspace)

---

## Package Shape (Design Suggestion Only)

> This is a design suggestion for future implementation. No packages are created now.

| Package | Purpose | Status |
|---------|---------|--------|
| `@praxis/contracts` | Shared TypeScript types | Future |
| `@praxis/kernel` | Truth Kernel: gates, evidence, reports | Future |
| `@praxis/cli` | CLI binary: init, spec, verify, repair, status, report | Future |
| `@praxis/claude-plugin` | Claude Code plugin: slash commands | Future |
| `@praxis/test-parsers` | Test output parsers | Future |

### Explicitly NOT v0.1 Packages

`@praxis/server`, `@praxis/desktop`, `@praxis/electron`, `@praxis/storage`, `@praxis/adapters`, `@praxis/hooks`

---

## Manual Workflow

```
1. /praxis:init                          ← One-time setup
2. /praxis:spec                          ← Define task (human approves)
3. [Agent does work independently]       ← PRAXIS not involved
4. /praxis:verify                        ← Operator runs after agent
5. [If HOLD/FAIL] /praxis:repair         ← Generate fix guidance
6. [Agent fixes issues]                  ← PRAXIS not involved
7. /praxis:verify                        ← Re-verify
8. /praxis:report                        ← Final audit report
```

---

## Exit Criteria — What Proves v0.1 MVP

1. `praxis init` creates valid `.praxis/` workspace
2. Task defined with human-approved acceptance criteria in `task.yaml`
3. `praxis verify` correctly detects:
   - Agent completed the task → PASS
   - Agent produced empty diff → HOLD
   - Agent ran zero tests → HOLD
   - Agent claimed completion without evidence → HOLD
   - Task spec not human-approved → FAIL
4. `praxis repair` produces actionable RepairPacket
5. `praxis report` produces readable audit report
6. Claude Code plugin slash commands call CLI correctly
7. Kernel produces correct verdicts independent of agent claims

### What Does NOT Prove MVP

Automatic hook-based verification, real-time agent supervision, multi-worker orchestration, Desktop Mission Control, server/SSE/PostgreSQL integration, or any "killed from v0.1" component.

---

## Decision Compliance Checklist

- [x] v0.1 scope: CLI + kernel + plugin + .praxis (D-138)
- [x] Manual verify and repair first (D-133)
- [x] Post-run verification (D-132)
- [x] Desktop Mission Control excluded (D-134)
- [x] Server/SSE/PostgreSQL excluded (D-135)
- [x] Multi-agent orchestration excluded (D-136)
- [x] Own agent loop killed (D-137)
- [x] JSONL evidence store (D-140)
- [x] Six v0.1 commands (D-141)
- [x] Implementation not authorized
- [x] No forbidden claims
- [x] Three Laws preserved
