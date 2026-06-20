# PRAXIS Identity

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Purpose:** Short product identity reference and terminology glossary.

---

## One-Liner

**PRAXIS is a local Truth Kernel for agentic coding tools.**

## Tagline

**"Bitti mi gerçekten?"** — Verify whether the agent actually completed the task.

## Product Statement

PRAXIS verifies coding-agent outputs using human-approved acceptance criteria, local evidence, deterministic gates, and repair packets. The Claude Code plugin is the first UX/integration bridge. The product core is the independent praxis CLI and local Truth Kernel.

---

## What PRAXIS Is

- A local verification and control layer above coding agents
- A Truth Kernel that produces PASS/HOLD/FAIL from evidence
- A CLI + Claude Code plugin
- A local evidence store (`.praxis/`)

## What PRAXIS Is Not

- A coding agent
- A Claude Code / OpenCode / MiMo clone
- Only a Claude Code plugin
- A desktop-first orchestrator (in v0.1)
- A server platform (in v0.1)

---

## Terminology

| Term | Definition |
|------|------------|
| **Truth Kernel** | The local verification engine: EvidenceGate → ExecGate → FinalGate. Sole completion authority. |
| **praxis CLI** | Local binary: init, spec, verify, repair, status, report. Primary v0.1 interface. |
| **Claude Code plugin** | Thin bridge: six slash commands calling the praxis CLI. Does not own truth. |
| **.praxis/** | Local workspace: task.yaml + evidence + verdicts + reports. |
| **task.yaml** | Human-approved task specification with acceptance criteria. |
| **EvidenceGate** | First gate: checks evidence exists (diff, files, logs). |
| **ExecGate** | Second gate: checks commands/tests actually ran. |
| **FinalGate** | Third gate: checks human criteria against evidence. |
| **PASS / HOLD / FAIL** | The only three verdicts. Kernel-owned. |
| **RepairPacket** | Constrained fix guidance from failed criteria. Cannot modify acceptance criteria. |
| **human_approved** | Boolean flag on criteria. Must be true for FinalGate to PASS. Only human can set. |
| **Three Laws** | Non-negotiable foundation: Completion Authority, Write Authority, Verification Authority. |

## Reframed Terms (Post-Pivot)

| Old Term | New Framing |
|----------|-------------|
| Desktop Mission Control MVP | Desktop Mission Control future scope (v0.3+) |
| Runtime server MVP | Future local control plane (v0.2+) |
| PostgreSQL event log MVP | Future durable event store (v0.2+) |
| SSE runtime stream MVP | Future UI/control-plane stream (v0.2+) |
| Multi-agent orchestrator | Future multi-agent control plane (v0.3+) |
| Claude Code adapter owns run lifecycle | Claude Code plugin bridges user commands to praxis CLI |
| WorkerAdapter completion | Agent output is evidence only |
| stable_16 target | Future concurrency hypothesis |
