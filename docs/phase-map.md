# Phase Map — Plugin-First Pivot

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Canonical decisions:** `docs/decisions.md`
**Authoritative ADR:** `docs/adr/ADR-013-plugin-first-pivot.md`

> **Supersession notice:** The previous P-1 through P6 implementation-first phase map (with Desktop Mission Control, server/runtime, PostgreSQL, multi-worker orchestration) is superseded for v0.1 by this plugin-first design-stage phase map. The old phase map remains in git history but is not active for v0.1. Implementation stages (I0-I4) are FUTURE and must not start.

---

## Purpose

Define the canonical phase model for PRAXIS after the Plugin-First Pivot. v0.1 is DESIGN ONLY. Implementation stages are defined but not authorized.

---

## Phase Model

```
D0 → D1 → D2 → D3 → D4 → [DESIGN LOCK GATE] → I0 → I1 → I2 → I3 → I4
```

- **D0-D4:** Design stages. Produce documentation, contracts, and design specs.
- **I0-I4:** Implementation stages. FUTURE — not authorized until D4 gate passes.

---

## Design Stages (D0-D4)

### D0 — Pivot Decision Lock

**Goal:** Lock product identity: local Truth Kernel + Claude Code plugin UX. Replace desktop-first scope with plugin-first scope.

**Produces:**
- `docs/adr/ADR-013-plugin-first-pivot.md` — Formal ADR
- `docs/decisions.md` — Updated with D-127+ pivot decisions
- Old desktop-first decisions marked superseded

**Status:** COMPLETE (2026-06-18)

**Gate:** ADR-013 exists. Decisions.md contains explicit Plugin-First Pivot decisions. Product identity locked.

---

### D1 — Plugin-First Design Pack

**Goal:** Define the full v0.1 design: plugin flow, CLI/kernel flow, task YAML contract, MVP scope.

**Produces:**
- `docs/product-scope.md` — Rewritten for plugin-first v0.1 MVP
- `docs/phase-map.md` — This document (updated)
- `docs/contracts/praxis-task-yaml.contract.md` — Task YAML contract
- `docs/implementation/mvp-v0.1-plugin-first-scope.md` — Exact v0.1 scope
- `docs/pipelines/claude-code-plugin-flow.md` — Plugin flow design
- `docs/pipelines/local-truth-kernel-flow.md` — Kernel flow design
- `docs/index.md` — Updated reading order

**Status:** IN PROGRESS (2026-06-18)

**Gate:** All D1 docs exist. Cross-references consistent. No forbidden claims in any doc.

---

### D2 — Truth Kernel Proof Design

**Goal:** Define gates, evidence model, false-done fixtures, repair packets in detail.

**Produces:**
- Detailed evidence model (JSONL schema, hash chain if applicable)
- False-done test case catalog (empty diff, zero tests, missing evidence, etc.)
- RepairPacket schema and examples
- TestOutputParser format coverage matrix

**Status:** NOT STARTED

**Gate:** Evidence model complete. False-done catalog covers all known patterns. RepairPacket schema validated against task YAML contract.

---

### D3 — Claude Code Plugin Spike Spec

**Goal:** Design slash command and hook behavior without implementation.

**Produces:**
- Plugin slash command specification (exact behavior per command)
- Hook integration design (PreToolUse, PostToolUse, Stop) — optional for v0.1
- Plugin-to-CLI interface contract
- Error handling matrix

**Status:** NOT STARTED

**Gate:** Spike spec complete. All slash commands have defined behavior. CLI interface contract is clear.

---

### D4 — Final Plugin-First Design Lock Audit

**Goal:** Decide whether implementation may begin.

**Produces:**
- Cross-document consistency audit
- Decision compliance verification (all HARD_LOCK decisions respected)
- Forbidden claims sweep
- Readiness assessment

**Status:** NOT STARTED

**Gate:** All D0-D3 docs consistent. No forbidden claims. All HARD_LOCK decisions respected. Human project owner explicitly authorizes implementation (or not).

---

## Implementation Stages (I0-I4) — FUTURE ONLY

> **⚠ These stages are FUTURE. Do not start. Implementation is not authorized until D4 gate passes.**

### I0 — Implementation Scaffold

**Goal:** Set up monorepo, contracts package, and build infrastructure.

**Produces:**
- Bun workspace configuration
- `@praxis/contracts` package with TypeScript types
- `@praxis/kernel` package skeleton
- `@praxis/cli` package skeleton
- `@praxis/claude-plugin` package skeleton
- `@praxis/test-parsers` package skeleton
- Build, test, lint infrastructure

**Gate:** `bun install`, `bun run typecheck`, `bun test` pass. No forbidden imports.

---

### I1 — Manual Verify MVP

**Goal:** Implement init, spec, and verify commands.

**Produces:**
- `praxis init` — Creates .praxis/ workspace
- `praxis spec` — Drafts task.yaml
- `praxis verify` — Runs EvidenceGate, ExecGate, FinalGate
- Evidence collection from git, files, command logs
- TestOutputParser for at least 2 test runners
- False-done detection: empty diff, zero tests, missing evidence

**Gate:** Manual verify produces correct PASS/HOLD/FAIL on real agent sessions.

---

### I2 — Repair Packet MVP

**Goal:** Implement repair command.

**Produces:**
- `praxis repair` — Generates RepairPacket from failed criteria
- RepairPacket output (JSON + human-readable)

**Gate:** RepairPacket correctly identifies failed criteria and suggests actionable fixes.

---

### I3 — Hook Capture MVP

**Goal:** Implement optional hook-based evidence capture.

**Produces:**
- PreToolUse/PostToolUse/Stop hook capture (Claude Code)
- Evidence auto-collection from hooks
- Hook spool for reliability

**Gate:** Hook evidence flows into verify without manual file collection.

---

### I4 — Reports / ACCP-lite

**Goal:** Implement report generation and optional ACCP-lite artifact export.

**Produces:**
- `praxis report` — Markdown audit report
- Optional ACCP-lite YAML artifact export
- Claude Code plugin slash command integration

**Gate:** Full manual workflow works end-to-end: init → spec → agent work → verify → repair → report.

---

## Do-Not-Start List

| Component | Earliest Start | Gate Condition |
|-----------|---------------|----------------|
| Any implementation (I0-I4) | After D4 | D4 Final Design Lock Audit must pass. Human must authorize. |
| `@praxis/kernel` source | I0 | Scaffold complete |
| `@praxis/cli` source | I1 | Contracts stable |
| `@praxis/claude-plugin` source | I3 | CLI verify/repair working |
| Desktop Mission Control | v0.3+ (future) | v0.1 MVP must prove kernel |
| Server/runtime | v0.2+ (future) | v0.1 MVP must prove kernel |
| PostgreSQL | v0.2+ (future) | Server/runtime exists |
| Multi-worker orchestration | v0.3+ (future) | Server + Governor + Assembler exist |

---

## MUST / MUST NOT Rules

### MUST

- MUST complete D0-D4 design stages before any implementation.
- MUST pass D4 Final Design Lock Audit before I0.
- MUST keep implementation stages (I0-I4) as FUTURE until D4 gate passes.
- MUST preserve Three Laws in all design and implementation stages.
- MUST require human approval for acceptance criteria.

### MUST NOT

- MUST NOT say I0 can start now.
- MUST NOT leave old P0/P1/P2 roadmap as active v0.1.
- MUST NOT build Desktop Mission Control in v0.1.
- MUST NOT build server/runtime/SSE/PostgreSQL in v0.1.
- MUST NOT build multi-agent orchestration in v0.1.
- MUST NOT build own agent loop in v0.1.
- MUST NOT start implementation without explicit human approval after D4.

---

## Decision Compliance Checklist

- [x] Design stages (D0-D4) before implementation (D-127 through D-148)
- [x] Implementation stages (I0-I4) are FUTURE
- [x] Old P0/P1/P2 roadmap superseded
- [x] Desktop Mission Control excluded from v0.1 (D-134)
- [x] Server/SSE/PostgreSQL excluded from v0.1 (D-135)
- [x] Multi-agent orchestration excluded from v0.1 (D-136)
- [x] Own agent loop killed from v0.1 (D-137)
- [x] Three Laws preserved
- [x] Implementation not authorized
- [x] No forbidden claims
