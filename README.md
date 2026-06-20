# PRAXIS

**Bitti mi gerçekten? — Verify whether the agent actually completed the task.**

PRAXIS is a **local Truth Kernel for agentic coding tools**. It verifies coding-agent outputs using human-approved acceptance criteria, local evidence, deterministic gates, and repair packets.

PRAXIS is **not a coding agent**. It does not write code. It does not compete with Claude Code, MiMo Code, or OpenCode. It sits above them and answers one question: did the agent actually do what it claimed?

---

## What Is PRAXIS?

- **A local Truth Kernel** — deterministic gates (EvidenceGate → ExecGate → FinalGate) that verify agent outputs against human-approved criteria
- **A CLI tool** — `praxis init`, `praxis spec`, `praxis verify`, `praxis repair`, `praxis status`, `praxis report`
- **A Claude Code plugin** — slash commands (`/praxis:verify`, `/praxis:repair`, etc.) that bridge Claude Code to the local kernel
- **A local evidence store** — `.praxis/task.yaml` + `.praxis/runs/<id>/evidence.jsonl` + `.praxis/reports/<id>.md`

## What PRAXIS Is Not

- ❌ A coding agent (does not write code, does not run its own agent loop)
- ❌ A Claude Code clone or competitor
- ❌ An OpenCode/MiMo clone
- ❌ "Only a Claude Code plugin" — the kernel is independent; the plugin is a bridge
- ❌ A desktop-first multi-agent orchestrator (in v0.1)
- ❌ A server/runtime platform (in v0.1)

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

## v0.1 MVP

PRAXIS v0.1 is deliberately minimal — a plugin-first local verification tool.

### In v0.1

| Component | Description |
|-----------|-------------|
| **praxis CLI** | Six commands: init, spec, verify, repair, status, report |
| **local Truth Kernel** | EvidenceGate, ExecGate, FinalGate, TestOutputParser, RepairPacket generator |
| **Claude Code plugin** | Six slash commands bridging Claude Code to the CLI |
| **.praxis/task.yaml** | Human-approved task specification with acceptance criteria |
| **JSONL evidence store** | `.praxis/runs/<id>/evidence.jsonl` — diffs, command logs, test output |
| **Local reports** | `.praxis/reports/<id>.md` — audit reports after verification |
| **Manual verify/repair** | Operator runs `/praxis:verify` after agent work; `/praxis:repair` on failure |

### Not in v0.1 (Future Scope)

- Desktop Mission Control (Electron) → v0.3+
- Server/runtime (Hono, HTTP, SSE) → v0.2+
- PostgreSQL event log → v0.2+
- Circuit Breaker, Governor → v0.2+/v0.3+
- Multi-worker orchestration, Wave Scheduler, Assembler → v0.3+
- Automatic hook-based verification → v0.2+

---

## How It Works

### Manual Verify/Repair Loop

```
1. /praxis:init                      ← Initialize .praxis/ workspace
2. Define .praxis/task.yaml          ← Human-approved acceptance criteria
3. Let Claude Code do the work       ← Agent runs independently
4. /praxis:verify                    ← Kernel checks evidence → PASS / HOLD / FAIL
5. If HOLD/FAIL: /praxis:repair      ← Generate repair packet for failed criteria
6. Let Claude fix only the failures  ← Agent addresses specific criteria
7. /praxis:verify                    ← Re-verify
8. PASS → /praxis:report             ← Generate audit report
```

### The Three Gates

| Gate | Question | Detects |
|------|----------|---------|
| **EvidenceGate** | Does evidence exist? | Empty diff, missing command logs, missing test output |
| **ExecGate** | Did commands/tests actually run? | Zero tests ran, commands not executed, test failures |
| **FinalGate** | Do results meet human criteria? | Criteria not met, task not human-approved, agent claims vs. evidence |

### Verdict Ladder

| EvidenceGate | ExecGate | FinalGate | Overall |
|-------------|----------|-----------|---------|
| PASS | PASS | PASS | **PASS** — task complete |
| HOLD | PASS | PASS | HOLD — evidence gaps |
| * | HOLD | * | HOLD — execution gaps |
| * | * | HOLD | HOLD — criteria gaps |
| FAIL | * | * | **FAIL** |
| * | FAIL | * | **FAIL** |
| * | * | FAIL | **FAIL** |

---

## Example Workflow

```bash
# 1. Initialize PRAXIS in your project
> /praxis:init
Created .praxis/task.yaml (skeleton)
Created .praxis/runs/
Created .praxis/reports/

# 2. Define the task (agent can draft, human must approve)
> /praxis:spec --description "Add a health check endpoint to the API"
Task ID: PRAXIS-2026-001
Acceptance criteria: 3 drafted
⚠ Human approval required. Review .praxis/task.yaml and set human_approved: true.

# 3. Let Claude Code implement the task (independently — PRAXIS not involved)

# 4. Verify
> /praxis:verify
Collecting evidence...
  ✓ git diff: 3 files changed
  ✓ bun test: 12 passed, 0 failed
  ✓ command logs: bun test, bun run typecheck

EvidenceGate: PASS
ExecGate: PASS
FinalGate: PASS (3/3 criteria met)

Verdict: PASS ✓

# 5. Generate report
> /praxis:report
Report saved to .praxis/reports/run-20260618-143000.md

# --- Alternative: failure path ---
> /praxis:verify
EvidenceGate: PASS
ExecGate: FAIL (bun test: 0 tests ran — false-done detected)
FinalGate: FAIL (0/3 criteria met)

Verdict: FAIL ✗

> /praxis:repair
RepairPacket:
  AC-001: Health endpoint file does not exist → Create src/server/routes/health.ts
  AC-002: No test output — bun test not executed → Run bun test
  AC-003: No command output → Run curl http://localhost:3000/health
```

---

## Core Concepts

### The Three Laws

```
LAW 1 — COMPLETION AUTHORITY
  Agent says done ≠ done.
  Truth Kernel FinalGate PASS = done.
  Nothing else counts.

LAW 2 — WRITE AUTHORITY
  No worker writes to shared integration files.
  The Deterministic Assembler is the only shared writer.
  (Future scope — single-session only in v0.1.)

LAW 3 — VERIFICATION AUTHORITY
  FinalGate criteria come from human-authored TaskSpec only.
  An agent cannot define or verify its own completion criteria.
```

### Key Principles

- **Agent claims are not completion.** Kernel-verified evidence is completion.
- **Human-approved acceptance criteria are mandatory.** Agent-generated criteria are drafts only.
- **The plugin is a bridge, not the kernel.** Claude Code plugin displays verdicts; kernel produces them.
- **The kernel is agent-agnostic.** It verifies evidence from any coding agent.
- **Manual before automatic.** v0.1 is explicit operator-driven verify/repair.

---

## Project Layout

```
praxis/
├─ README.md                    ← This file
├─ architecture.md              ← Canonical architecture baseline
├─ ai_summary.md                ← Agent-readable project state
├─ docs/
│  ├─ decisions.md              ← Canonical decision register
│  ├─ adr/                      ← Architecture Decision Records
│  │  └─ ADR-013-*.md           ← Plugin-First Pivot ADR
│  ├─ product-scope.md          ← v0.1 MVP scope
│  ├─ phase-map.md              ← Design + implementation stages
│  ├─ contracts/                ← Contract specifications
│  │  └─ praxis-task-yaml.contract.md
│  ├─ pipelines/                ← Pipeline/flow specifications
│  │  ├─ claude-code-plugin-flow.md
│  │  └─ local-truth-kernel-flow.md
│  └─ implementation/           ← Implementation gates
│     └─ mvp-v0.1-plugin-first-scope.md
├─ artifacts/                   ← Zip archives of documentation
└─ pi/                          ← Old Pi monorepo (reference only)
```

**Implementation packages (design only — not yet created):**

| Package | Purpose |
|---------|---------|
| `@praxis/contracts` | Shared TypeScript types |
| `@praxis/kernel` | Truth Kernel: gates, evidence, reports |
| `@praxis/cli` | CLI binary: init, spec, verify, repair, status, report |
| `@praxis/claude-plugin` | Claude Code plugin: slash commands |
| `@praxis/test-parsers` | Test output parsers |

---

## Roadmap

| Stage | Name | Status |
|-------|------|--------|
| **D0** | Pivot Decision Lock | ✅ Complete |
| **D1** | Plugin-First Design Pack | ✅ Complete |
| **D2** | Truth Kernel Proof Design | 🔜 Next |
| **D3** | Claude Code Plugin Spike Spec | Future |
| **D4** | Final Design Lock Audit | Future |
| **I0–I4** | Implementation | ⛔ Not authorized |

**Implementation has not started.** v0.1 design stages (D0-D1) are complete. D2-D4 remain before any implementation decision.

---

## Future Scope

After v0.1 validates the core verification model with real Claude Code sessions:

| Target | Components |
|--------|------------|
| **v0.2** | Local server/runtime (Hono, HTTP, SSE), PostgreSQL event log, Circuit Breaker, automatic repair loops, MiMo/OpenCode adapters |
| **v0.3** | Desktop Mission Control (Electron + React), Governor, Wave Scheduler, Deterministic Assembler, multi-worker orchestration |
| **v0.4+** | Multi-agent dashboard, stable_16 concurrency, cloud dashboard (optional) |

---

## Current Status

- **Identity:** Local Truth Kernel for agentic coding tools (post-ADR-013 Plugin-First Pivot)
- **Design progress:** ~45% (D0-D1 complete)
- **Implementation progress:** 0% (not authorized)
- **Next step:** Truth Kernel Proof Design (D2)
- **Zip artifact:** `artifacts/praxis-docs-plugin-first-pivot-v0.1.zip`

---

## Quick Reference

```
What is PRAXIS?             →  Local Truth Kernel for agentic coding tools.
What does PRAXIS do?        →  Verifies whether the agent actually completed the task.
Primary interface (v0.1)?   →  Claude Code plugin + praxis CLI.
Completion authority?       →  Truth Kernel FinalGate. Never the agent.
Criteria source?            →  .praxis/task.yaml (human-approved). Never agent-generated.
Plugin owns truth?          →  No. Plugin displays; kernel decides.
Desktop Mission Control?    →  Future (v0.3+). Not in v0.1.
Server/PostgreSQL/SSE?      →  Future (v0.2+). Not in v0.1.
Implementation started?     →  No. Design stages only.
```
