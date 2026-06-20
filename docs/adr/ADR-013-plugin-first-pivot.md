# ADR-013: Plugin-First Pivot

**Status:** Accepted for design direction; implementation still not authorized
**Date:** 2026-06-18
**Canonical decisions:** `docs/decisions.md`
**Supersedes:** D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-015, D-062, D-063, D-064, D-065, D-066, D-067, D-068, D-069, D-084, D-085, D-086, D-087, D-088, D-089, D-090, D-091, D-092, D-093, D-094, D-095 (reclassified to future scope for v0.1)
**Preserves:** Three Laws, human-authored acceptance criteria, Truth Kernel completion authority, agent-claims-are-not-completion

---

## Context

PRAXIS was originally designed as a desktop-first multi-agent coding orchestrator: an Electron-based Desktop Mission Control, a local HTTP+SSE server, PostgreSQL event log, multi-worker scheduling with Governor tiers up to stable_16, a Deterministic Assembler, and a full runtime event-sourcing model. The v0.1 MVP was defined as MVP-A (Desktop mockup), MVP-B (single real Claude worker), MVP-C (three parallel workers).

Since that design was locked, the landscape has shifted:

- **Claude Code, MiMo Code, OpenCode, and similar tools** already cover the agent harness / terminal coding workflow layer exceptionally well.
- **Competing by building another terminal-native coding agent** is no longer a strong MVP direction — the market has multiple mature options.
- **PRAXIS's original unique value** was never simply "make an agent write code"; it was completion authority, evidence, verification, false-done prevention, and auditability.
- **The correct product layer is above existing agents**: a local truth/control layer that verifies their outputs rather than replacing their execution loops.

This ADR documents the decision to pivot PRAXIS from a desktop-first multi-agent orchestrator to a **plugin-first local Truth Kernel** with Claude Code plugin as the first UX/integration layer.

---

## Decision

**PRAXIS is not a coding agent. PRAXIS is a local Truth Kernel for agentic coding tools.**

The Claude Code plugin is the first UX/integration layer, not the product core. PRAXIS answers: "Did the agent actually complete the task?" (Turkish: "Bitti mi gerçekten?")

The v0.1 product is:
1. **praxis CLI** — local binary that runs the Truth Kernel
2. **local Truth Kernel** — EvidenceGate, ExecGate, FinalGate, TestOutputParser, RepairPacket, local report generation
3. **Claude Code plugin** — slash commands (`/praxis:init`, `/praxis:spec`, `/praxis:verify`, `/praxis:repair`, `/praxis:status`, `/praxis:report`) that call the praxis CLI
4. **`.praxis/` workspace** — `task.yaml`, `evidence/*.jsonl`, `reports/*.md`

### What This Means

| Question | Old Answer | New Answer |
|----------|-----------|------------|
| What is PRAXIS? | Desktop-first multi-agent coding orchestrator | Local Truth Kernel for agentic coding tools |
| What is the primary interface? | Desktop Mission Control (Electron) | Claude Code plugin + praxis CLI |
| What does v0.1 do? | Mock desktop → single worker → 3 parallel workers | Manual `/praxis:verify` and `/praxis:repair` via CLI |
| Where does truth live? | Kernel Truth Engine (same) | Kernel Truth Engine (same — preserved) |
| Who decides completion? | Truth Engine FinalGate (same) | Truth Engine FinalGate (same — preserved) |
| Does PRAXIS run agents? | Yes — orchestrates Claude Code workers | No — Claude Code runs itself; PRAXIS verifies after |

---

## Rationale

### Why Pivot?

1. **Don't compete with agent harnesses.** Claude Code, MiMo Code, and OpenCode are mature, well-funded, and rapidly improving. Building another terminal coding agent loop is a losing strategy.

2. **The unique value is verification, not orchestration.** PRAXIS's Three Laws, evidence model, false-done detection, and gate pipeline solve a real problem that no existing tool addresses: agents lie about completion.

3. **Plugin-first is faster to MVP.** A Claude Code plugin + CLI that verifies post-run evidence is buildable in weeks, not months. Desktop Mission Control + server + PostgreSQL + multi-worker orchestration is a much larger investment.

4. **The Truth Kernel is independently valuable.** Whether the agent is Claude Code, MiMo Code, or a future tool, the need for independent verification doesn't change. The kernel is the product; the plugin is the first bridge.

5. **Smaller surface area, faster validation.** A CLI + plugin MVP can be tested with real Claude Code sessions immediately, proving (or disproving) the core hypothesis before building infrastructure.

### Why Not Kill PRAXIS?

- The core pain points are real and unsolved: false-done, missing evidence, agent self-report as truth, scattered verification.
- The Three Laws are sound architectural foundations.
- The Truth Kernel concept (gates → evidence → verdict) is independently valuable.
- A local verification tool has zero cloud dependency and fits the local-first philosophy.

### Why Not Stay Desktop-First?

- Desktop Mission Control is valuable but premature for v0.1.
- Building Electron + server + PostgreSQL + multi-worker orchestration before proving the verification model works is high-risk.
- The plugin-first approach proves the kernel with real sessions immediately, informing future UI decisions.

---

## What Is Kept (CORE v0.1)

| Component | Rationale |
|-----------|-----------|
| **Three Laws** | Non-negotiable foundation. Must not be weakened. |
| **Agent claims are not completion** | Law 1. Core to PRAXIS identity. |
| **Human-authored acceptance criteria** | Law 3. Prevents echo chamber. |
| **TaskSpec / praxis task YAML** | Core v0.1 contract. `.praxis/task.yaml`. |
| **EvidenceGate** | Checks evidence exists: diff, files, logs. |
| **ExecGate** | Checks commands/tests ran and produced results. |
| **FinalGate** | Checks human criteria against evidence. |
| **TestOutputParser** | Parses test output for pass/fail/count. |
| **GateVerdict (PASS/HOLD/FAIL)** | Kernel-owned completion authority. |
| **EvidenceRecord** | JSONL evidence store in `.praxis/evidence/`. |
| **RepairPacket** | Constrained repair guidance from failed criteria. |
| **False-done tests** | Empty diff, zero tests ran, agent claim without evidence. |
| **Local reports** | Markdown/JSON reports in `.praxis/reports/`. |
| **Claude Code plugin as UX/bridge** | Slash commands call praxis CLI. |
| **praxis CLI** | Local binary: init, spec, verify, repair, status, report. |
| **local Truth Kernel** | Gate logic, evidence evaluation, verdict production. |

---

## What Is Downgraded to Future Scope

These components are valuable but not v0.1. They may be reintroduced in v0.2+ after the plugin-first MVP proves the core verification model.

| Component | Future Target | Rationale |
|-----------|---------------|-----------|
| **Desktop Mission Control** | v0.3+ | Valuable observability layer but premature for v0.1 |
| **Electron app** | v0.3+ | Wrapper for Mission Control |
| **server/runtime** | v0.2+ | Local HTTP+SSE server is future control-plane |
| **HTTP API** | v0.2+ | REST endpoints for remote query |
| **SSE event stream** | v0.2+ | Real-time event push |
| **PostgreSQL event log** | v0.2+ | Durable storage; v0.1 uses JSONL files |
| **RuntimeSnapshot** | v0.2+ | Full runtime state snapshot |
| **RuntimeEvent full event sourcing** | v0.2+ | Append-only event log with replay |
| **Circuit Breaker** | v0.2+ | System-level safety; v0.1 is manual verify |
| **Governor** | v0.3+ | Concurrency control; not needed for single-session verify |
| **stable_16** | v0.3+ | Concurrency ceiling; irrelevant without multi-worker |
| **Wave scheduler** | v0.3+ | Multi-worker orchestration |
| **Deterministic assembler** | v0.3+ | Multi-worker integration assembly |
| **Multi-worker orchestration** | v0.3+ | Parallel workers with namespace isolation |
| **Cross-agent Mission Control** | v0.4+ | Multi-agent dashboard |
| **MiMo/OpenCode/Hermes adapters** | v0.2+ | Additional agent bridges after Claude Code plugin proven |

---

## What Is Killed from v0.1

These components are explicitly removed from the PRAXIS roadmap for v0.1 and must not be built:

| Killed Component | Why |
|------------------|-----|
| **Own terminal coding agent loop** | Claude Code and others already do this |
| **Own Claude Code clone** | Not competing with Claude Code |
| **Own OpenCode/MiMo clone** | Not competing with OpenCode/MiMo |
| **Own subagent engine** | Not building agent infrastructure |
| **Own memory/context compaction system** | Not building agent infrastructure |
| **Own autonomous coding runtime** | Agents run themselves; PRAXIS verifies |
| **Provider routing layer** | Not in PRAXIS scope |
| **Model-hosting layer** | Not in PRAXIS scope |

---

## New MVP v0.1: Plugin-First Truth Kernel

### Product Shape

```
~/.praxis/                     ← PRAXIS home (or project-local .praxis/)
  task.yaml                    ← Human-approved task spec
  runs/<run_id>/
    evidence.jsonl             ← Evidence records
    commands.jsonl             ← Command logs
    verdict.json               ← Gate verdict
  reports/<run_id>.md          ← Final audit report

praxis CLI                     ← Local binary
  praxis init                  ← Initialize .praxis workspace
  praxis spec                  ← Help draft task spec (human approves)
  praxis verify                ← Run Truth Kernel gates
  praxis repair                ← Generate repair packet
  praxis status                ← Show current state
  praxis report                ← Generate final report

Claude Code plugin             ← UX/integration layer
  /praxis:init                 ← Calls praxis init
  /praxis:spec                 ← Calls praxis spec
  /praxis:verify               ← Calls praxis verify
  /praxis:repair               ← Calls praxis repair
  /praxis:status               ← Calls praxis status
  /praxis:report               ← Calls praxis report
```

### Commands

| Command | Purpose | Verdicts |
|---------|---------|----------|
| `/praxis:init` | Initialize `.praxis` workspace, config, task skeleton | — |
| `/praxis:spec` | Draft task spec; human must approve acceptance criteria | — |
| `/praxis:verify` | Run Truth Kernel against task.yaml + evidence | PASS / HOLD / FAIL |
| `/praxis:repair` | Generate constrained repair packet from failed criteria | — |
| `/praxis:status` | Show current task, last verdict, evidence count, next action | — |
| `/praxis:report` | Generate final audit report after verdict | — |

### Gates (unchanged from original design, adapted for local execution)

- **EvidenceGate:** Checks that evidence exists (diff, changed files, command logs, test logs).
- **ExecGate:** Checks that required commands/tests actually ran and produced parseable results.
- **FinalGate:** Checks human-authored acceptance criteria against evidence. Worker self-report does not count.

### UX Policy

- Manual verify first (`/praxis:verify`).
- Manual repair first (`/praxis:repair`).
- Hooks may capture evidence if safe (future enhancement).
- Stop hook automatic loops are future hypotheses, not v0.1 guarantees.
- Plugin shows verdicts; kernel decides verdicts.

---

## Non-Goals (This ADR Does NOT Authorize)

- Implementation of any source code
- Creation of package.json, tsconfig, Bun config, CI config
- Plugin source, CLI source, kernel source
- Porting of pi/ packages
- Day 0 Spike execution
- Claude Code plugin files under `.claude/` or plugin directories
- Slash command implementation files
- Server, desktop app, or PostgreSQL schema
- Final design lock
- Claim that implementation can start

---

## Migration Impact on Existing Docs

### Docs That Remain Active (v0.1 Core)

- `docs/decisions.md` — Updated with new D-127+ pivot decisions
- `docs/adr/ADR-013-plugin-first-pivot.md` — This document
- `docs/index.md` — Updated reading order
- `docs/product-scope.md` — Rewritten for plugin-first MVP
- `docs/phase-map.md` — Rewritten for design-first stages
- Three Laws documentation — Unchanged

### Docs That Receive Supersession Notices (Future for v0.1)

- `docs/pipelines/runtime-event-flow.md`
- `docs/pipelines/circuit-breaker-governor.md`
- `docs/pipelines/wave-scheduler.md`
- `docs/pipelines/deterministic-assembler.md`
- `docs/contracts/runtime-event.contract.md`
- `docs/contracts/runtime-snapshot.contract.md`
- `docs/contracts/governor.contract.md`
- `docs/contracts/circuit-breaker.contract.md`

### New Docs Created

- `docs/contracts/praxis-task-yaml.contract.md`
- `docs/implementation/mvp-v0.1-plugin-first-scope.md`
- `docs/pipelines/claude-code-plugin-flow.md`
- `docs/pipelines/local-truth-kernel-flow.md`

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Plugin-only perception: PRAXIS seen as "just a Claude Code plugin" | Medium | All docs must state kernel is independent; plugin is bridge |
| Claude Code dependency: kernel tied to Claude Code specifics | Low | Kernel design is agent-agnostic; Claude plugin is adapter |
| Premature desktop abandonment: Mission Control never built | Medium | Keep in future roadmap; revisit after v0.1 validates kernel |
| Scope creep: future features pulled into v0.1 | Medium | Strict v0.1 scope doc with explicit exclusions |
| Implementation temptation: agents start coding before design lock | Medium | Explicit "implementation not authorized" in all docs |

---

## Open Questions

1. **Should v0.1 support project-local `.praxis/` or only global `~/.praxis/`?** Tentative: both. Project-local takes precedence.
2. **Should RepairPacket be machine-readable (JSON) or human-readable (Markdown)?** Tentative: both. JSON for tool consumption, Markdown for human review.
3. **Should the Truth Kernel be a standalone binary or a library?** Tentative: CLI binary first; library extraction later if needed.
4. **When should Desktop Mission Control be reconsidered?** After v0.1 validates the kernel with real Claude Code sessions and user feedback confirms need for richer observability.
5. **Should MiMo/OpenCode plugins follow the same pattern?** Yes — same kernel, different plugin bridges. The kernel is agent-agnostic.

---

## Decision Compliance Checklist

- [x] PRAXIS is not a coding agent (HARD_LOCK)
- [x] PRAXIS is a local Truth Kernel (HARD_LOCK)
- [x] Claude Code plugin is first UX/integration layer (HARD_LOCK)
- [x] Plugin calls praxis CLI/kernel; does not own truth logic (HARD_LOCK)
- [x] v0.1 is post-run verification first (HARD_LOCK)
- [x] Desktop Mission Control is future scope (HARD_LOCK)
- [x] Server/SSE/PostgreSQL/multi-worker orchestration are future scope (HARD_LOCK)
- [x] Own terminal coding agent loop is killed from v0.1 (HARD_LOCK)
- [x] Three Laws preserved and not weakened
- [x] Human-authored acceptance criteria preserved
- [x] No implementation authorized
- [x] PRAXIS is not described as "only a Claude Code plugin"
- [x] Plugin does not own Truth Kernel
