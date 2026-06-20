# Product Scope — Plugin-First Pivot

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Canonical decisions:** `docs/decisions.md`
**Authoritative ADR:** `docs/adr/ADR-013-plugin-first-pivot.md`

> **Supersession notice:** This document replaces the previous desktop-first product scope (MVP-A/B/C staging with Desktop Mission Control). For v0.1, Desktop Mission Control, server/runtime, SSE, PostgreSQL, Circuit Breaker, Governor, stable_16, wave scheduler, and multi-worker orchestration are FUTURE scope. See ADR-013.

---

## Product Identity

**PRAXIS is not a coding agent. PRAXIS is a local Truth Kernel for agentic coding tools.**

PRAXIS answers one question: "Did the agent actually complete the task?" (Turkish: "Bitti mi gerçekten?")

The Claude Code plugin is the first UX/integration layer — it exposes slash commands that call the praxis CLI. The plugin is a bridge, not the product core. The product core is the local Truth Kernel that verifies evidence against human-authored acceptance criteria.

### What PRAXIS Is

- A local verification and control layer that sits **above** existing coding agents
- A Truth Kernel that produces PASS/HOLD/FAIL verdicts from evidence, not agent claims
- A CLI tool + Claude Code plugin that lets operators verify agent work post-execution
- A local evidence store (`.praxis/`) with JSONL/YAML/JSON files
- A repair packet generator for failed criteria

### What PRAXIS Is Not

- A coding agent (does not write code itself)
- A Claude Code clone or competitor
- An OpenCode/MiMo clone or competitor
- A desktop-first multi-agent orchestrator (in v0.1)
- A server/runtime platform (in v0.1)
- "Only a Claude Code plugin" — the kernel is independent

---

## v0.1 MVP Scope

### In Scope

| Component | Description |
|-----------|-------------|
| **praxis CLI** | Local binary: `praxis init`, `praxis spec`, `praxis verify`, `praxis repair`, `praxis status`, `praxis report` |
| **local Truth Kernel** | EvidenceGate, ExecGate, FinalGate, TestOutputParser, RepairPacket, local report generation |
| **Claude Code plugin UX** | Six slash commands (`/praxis:init`, `/praxis:spec`, `/praxis:verify`, `/praxis:repair`, `/praxis:status`, `/praxis:report`) that call praxis CLI |
| **`.praxis/task.yaml`** | Human-approved task specification with acceptance criteria |
| **`.praxis/evidence/*.jsonl`** | JSONL evidence store (diffs, command logs, test output, file changes) |
| **`.praxis/reports/*.md`** | Local audit reports after PASS/HOLD/FAIL |
| **EvidenceGate** | Checks that evidence exists: diff, changed files, command logs, test logs, tool/hook captures if available |
| **ExecGate** | Checks that required commands/tests actually ran and produced parseable results |
| **FinalGate** | Checks human-authored acceptance criteria against evidence. Worker self-report does not count |
| **TestOutputParser** | Parses test runner output for pass/fail/count |
| **RepairPacket** | Constrained repair guidance from failed criteria (cannot modify acceptance criteria) |
| **Manual verify/repair loop** | Operator runs `/praxis:verify` after agent finishes; runs `/praxis:repair` on HOLD/FAIL |

### Out of Scope (v0.1 Non-Goals)

| Excluded Component | Why | Target |
|--------------------|-----|--------|
| **Desktop Mission Control (Electron)** | Premature for v0.1; plugin + CLI sufficient | v0.3+ |
| **server/runtime (Hono + HTTP + SSE)** | Not needed for manual verify | v0.2+ |
| **PostgreSQL event log** | JSONL files sufficient for single-session | v0.2+ |
| **RuntimeSnapshot / RuntimeEvent sourcing** | No server, no runtime state to snapshot | v0.2+ |
| **Circuit Breaker** | Manual verify; no automated admission loop | v0.2+ |
| **Governor / stable_N concurrency** | Single-session only; no multi-worker | v0.3+ |
| **Wave scheduler** | No multi-worker orchestration | v0.3+ |
| **Deterministic Assembler** | No multi-worker integration | v0.3+ |
| **Multi-agent orchestration** | Single-agent verification only | v0.3+ |
| **Own coding agent loop** | Killed from v0.1 — agents run independently | N/A |
| **Automatic repair loop** | Manual repair only in v0.1 | v0.2+ |
| **Stop hook automatic verification** | Future hypothesis; not proven | v0.2+ |
| **MiMo/OpenCode/Hermes adapters** | Claude Code plugin first | v0.2+ |
| **ACCP-lite artifact generation** | Optional; reports are Markdown | Future |

---

## Killed from v0.1

These are permanently removed from the v0.1 roadmap:

- Own terminal coding agent loop
- Own Claude Code clone
- Own OpenCode/MiMo clone
- Own subagent engine
- Own memory/context compaction system
- Own autonomous coding runtime
- Provider routing layer
- Model-hosting layer

---

## Future Scope

Components deferred to post-v0.1. All are preserved in the roadmap but not designed or implemented now.

| Target | Components |
|--------|------------|
| **v0.2** | server/runtime (Hono, HTTP, SSE), PostgreSQL event log, RuntimeSnapshot, Circuit Breaker, MiMo/OpenCode adapters, automatic repair loops |
| **v0.3** | Desktop Mission Control (Electron + React), Governor, Wave scheduler, Deterministic Assembler, multi-worker orchestration |
| **v0.4+** | Multi-agent Mission Control, stable_16, full semantic conflict detection, cloud dashboard (optional) |

---

## User Journey (v0.1)

### Manual Verify/Repair Loop

```
1. Operator initializes PRAXIS workspace:
   /praxis:init
   → creates .praxis/ with task.yaml skeleton

2. Operator (or agent, with human approval) defines task:
   /praxis:spec
   → drafts .praxis/task.yaml with acceptance criteria
   → human reviews and approves (human_approved: true)

3. Agent (Claude Code, independently) does the work:
   → writes code, runs tests, edits files
   → PRAXIS does NOT orchestrate this step in v0.1

4. Operator verifies:
   /praxis:verify
   → reads .praxis/task.yaml
   → collects evidence (diff, changed files, command logs, test output)
   → runs EvidenceGate → ExecGate → FinalGate
   → produces PASS / HOLD / FAIL verdict

5. If HOLD or FAIL, operator requests repair:
   /praxis:repair
   → generates RepairPacket from failed criteria
   → operator gives repair packet to agent
   → agent fixes issues (independently)
   → operator runs /praxis:verify again

6. Operator generates final report:
   /praxis:report
   → produces .praxis/reports/<run_id>.md
```

### Key Principle

**The agent runs independently. PRAXIS verifies after.** PRAXIS does not interrupt, modify, or control the agent's execution loop in v0.1. The operator decides when to verify.

---

## Why Not Desktop-First?

The original PRAXIS design targeted Desktop Mission Control as the primary operator interface. This was downgraded to future scope for v0.1 because:

1. **Desktop is a large investment.** Electron + React + Tailwind + TanStack + SSE client + all panels (dashboard, worker grid, evidence stream, CB status, etc.) is months of work before proving the core verification model.

2. **Plugin + CLI proves the kernel faster.** A Claude Code plugin with six slash commands can be validated with real sessions immediately.

3. **The kernel is the product, not the UI.** If the Truth Kernel works, any UI can wrap it later. If it doesn't work, no UI saves it.

4. **Desktop observability is valuable but premature.** Operators need to see evidence and verdicts. A CLI with Markdown reports provides this for v0.1. Rich visualization can follow.

---

## Why Not an Agent Clone?

PRAXIS explicitly does NOT build its own coding agent loop for v0.1 because:

1. **Claude Code, MiMo Code, and OpenCode already exist.** They are mature, well-funded, and rapidly improving. Competing at the agent harness layer is a losing strategy.

2. **The unique PRAXIS value is verification, not execution.** No existing tool verifies agent outputs with independent evidence gates and human-authored criteria.

3. **Building an agent loop would delay the kernel.** The agent loop (tool use, stop detection, context management, provider routing) is a separate and large engineering problem. PRAXIS focuses on what happens after the agent finishes.

---

## Command UX (v0.1)

| Slash Command | CLI Equivalent | Purpose | Verdicts |
|---------------|---------------|---------|----------|
| `/praxis:init` | `praxis init` | Initialize `.praxis` workspace, config, task skeleton, evidence/report directories | — |
| `/praxis:spec` | `praxis spec` | Help draft task spec; human must approve acceptance criteria | — |
| `/praxis:verify` | `praxis verify --task .praxis/task.yaml --workspace .` | Run Truth Kernel gates against evidence | PASS / HOLD / FAIL |
| `/praxis:repair` | `praxis repair --last-run` | Generate constrained repair packet from failed criteria | — |
| `/praxis:status` | `praxis status` | Show current task, last verdict, evidence count, failed criteria | — |
| `/praxis:report` | `praxis report` | Generate final audit report | — |

### Agent Can Draft, Human Approves

`/praxis:spec` allows the agent to draft a task YAML, but:
- Agent-generated acceptance criteria are marked `human_approved: false`
- FinalGate ignores criteria with `human_approved: false`
- Only the human operator can set `human_approved: true`

---

## Evidence Files (v0.1)

```
.praxis/
  task.yaml                    ← Human-approved task spec
  config.yaml                  ← PRAXIS config (optional)
  runs/
    <run_id>/
      evidence.jsonl           ← Evidence records (diff, files, commands, tests)
      commands.jsonl           ← Command execution logs
      verdict.json             ← Gate verdict (PASS/HOLD/FAIL with details)
  reports/
    <run_id>.md                ← Final audit report
```

### Explicitly NOT v0.1

- PostgreSQL `runtime_events` table
- SSE event stream
- `RuntimeSnapshot` API
- Server-based evidence ingestion

---

## Gates (v0.1)

### EvidenceGate

**Purpose:** Checks that evidence exists — diff, changed files, command logs, test logs, tool/hook captures if available.

**Produces:** PASS (evidence found) / HOLD (insufficient evidence) / FAIL (evidence contradicts claims).

### ExecGate

**Purpose:** Checks that required commands/tests actually ran and produced parseable results.

**Detects:**
- Zero tests ran (test runner invoked but no tests found)
- Tests ran but all skipped
- Required command not executed
- Command exited with error

**Produces:** PASS (commands/tests ran, results parseable) / HOLD (missing execution) / FAIL (execution failed).

### FinalGate

**Purpose:** Checks human-authored acceptance criteria against evidence. Worker self-report does not count.

**Rules:**
- Every criterion must have `human_approved: true`
- Agent-generated criteria (`human_approved: false`) are drafts only
- FinalGate cannot PASS criteria that are not human-approved
- Agent claims ("I completed the task") are evidence, not verdicts

**Produces:** PASS (all criteria met) / HOLD (some criteria unverified) / FAIL (criteria not met).

---

## RepairPacket (v0.1)

Generated by `/praxis:repair` when FinalGate returns HOLD or FAIL.

**Contains:**
- Failed criterion ID and description
- Evidence of failure (what was checked, what was found)
- Suggested fix direction (constrained — cannot modify acceptance criteria)
- Files that need changes

**Constraints:**
- RepairPacket MUST NOT modify acceptance criteria
- RepairPacket MUST NOT change `human_approved` status
- RepairPacket MUST NOT claim the work is done
- RepairPacket is guidance for the agent, not a replacement for human judgment

---

## What Proves MVP

- Operator can `praxis init` and get a valid `.praxis/` workspace
- Operator can define a task with human-approved acceptance criteria in `task.yaml`
- After an agent does work, `praxis verify` produces a correct PASS/HOLD/FAIL verdict
- Empty diff → HOLD (false-done caught)
- Zero tests ran → HOLD (false-done caught)
- Agent claim without evidence → HOLD (false-done caught)
- Missing human approval → FinalGate fails
- `praxis repair` produces a valid RepairPacket for failed criteria
- `praxis report` produces a readable audit report

### What Does NOT Prove MVP

- Automatic hook-based verification (future)
- Real-time agent supervision (future)
- Multi-worker orchestration (future)
- Desktop Mission Control (future)
- Server/SSE/PostgreSQL (future)
- Claude Code plugin implementation (design-only in v0.1)

---

## Package Shape (Design Suggestion Only)

> **Note:** This is a design suggestion for future implementation. No packages are created by this document. Implementation is not authorized.

| Package | Purpose |
|---------|---------|
| `@praxis/contracts` | Shared types: TaskSpec, AcceptanceCriterion, EvidenceRecord, GateVerdict, RepairPacket |
| `@praxis/kernel` | Truth Kernel: EvidenceGate, ExecGate, FinalGate, TestOutputParser, report generator |
| `@praxis/cli` | CLI binary: init, spec, verify, repair, status, report commands |
| `@praxis/claude-plugin` | Claude Code plugin: slash commands, hook capture (optional/future) |
| `@praxis/test-parsers` | Test output parsers: Vitest, Jest, Pytest, Go test, etc. |

**Explicitly NOT v0.1 packages:** `@praxis/server`, `@praxis/desktop`, `@praxis/electron`, `@praxis/storage`.

---

## Authority Invariants (Must Preserve)

- Agent claims are not completion. Kernel-verified evidence is completion.
- Human-authored acceptance criteria are required.
- Truth Kernel owns PASS/HOLD/FAIL.
- Claude Code plugin does not decide truth.
- Claude Code itself does not decide truth.
- MiMo/OpenCode/Hermes/Codex adapters, if added later, do not decide truth.
- UI/CLI/plugin displays verdicts; kernel produces verdicts.
- RepairPacket cannot modify acceptance criteria.
- ACCP-lite reports do not replace Truth Kernel verdicts.

## Forbidden Claims

These claims must not appear in any PRAXIS document:

- "PRAXIS is a Claude Code plugin only" or "PRAXIS = Claude Code plugin"
- "Claude Code plugin owns Truth Kernel" or "plugin owns truth"
- "Plugin decides completion" or "Claude decides completion"
- "Worker self-report is completion"
- "MVP requires Desktop Mission Control"
- "MVP requires Postgres" / "MVP requires SSE" / "MVP requires server"
- "MVP requires stable_16" / "MVP requires multi-agent orchestration"
- "PRAXIS will build its own coding agent loop in v0.1"

---

## Readiness Impact of Plugin-First Pivot

| Approach | Score | Explanation |
|----------|-------|-------------|
| Old desktop-first MVP | 6.0/10 | Too large and competes with existing agent harnesses |
| Plugin-only, no local kernel | 6.5/10 | Easy but weak; truth depends too much on Claude context |
| **Local Truth Kernel + Claude plugin (current)** | **9.0-9.2/10** | Small, focused, independently verifiable, and directly useful |

> **Note:** This is a design score, not implementation completion. Implementation remains unauthorized until the final plugin-first design lock audit (D4).

---

## Decision Compliance Checklist

- [x] Product identity: local Truth Kernel, not coding agent (D-127, D-128)
- [x] Claude Code plugin is first UX/integration layer (D-129)
- [x] Plugin is not kernel (D-130)
- [x] Post-run verification first (D-132)
- [x] Manual verify and repair first (D-133)
- [x] Desktop Mission Control is future scope (D-134)
- [x] Server/SSE/PostgreSQL are future scope (D-135)
- [x] Multi-agent orchestration is future scope (D-136)
- [x] Own agent loop killed from v0.1 (D-137)
- [x] v0.1 MVP: CLI + kernel + plugin + .praxis (D-138)
- [x] .praxis/task.yaml is core contract (D-139)
- [x] JSONL evidence store for v0.1 (D-140)
- [x] Six v0.1 commands defined (D-141)
- [x] Three Laws preserved and not weakened
- [x] Human-authored acceptance criteria required
- [x] No implementation authorized
- [x] No forbidden claims present

---

## Open Questions

1. **Should v0.1 support project-local `.praxis/` or only global `~/.praxis/`?** Tentative: both, local takes precedence.
2. **Should evidence capture be automatic (hooks) in v0.1 or manual (operator provides paths)?** Tentative: automatic where safe (diff from git, command logs from shell history), manual for test output if hooks unavailable.
3. **Should RepairPacket be machine-readable (JSON) for agent consumption?** Tentative: yes — JSON for tool consumption, Markdown for human review.
4. **When should Desktop Mission Control be reconsidered?** After v0.1 validates kernel with real sessions and user feedback confirms need for richer observability.
