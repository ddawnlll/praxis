# PRAXIS Documentation Index

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Canonical navigation index for all PRAXIS documentation. Defines the recommended reading order, document inventory, and prerequisite checks for implementation tasks.

> **Plugin-First Pivot (ADR-013):** PRAXIS is now a local Truth Kernel with Claude Code plugin as the first UX/integration layer. Desktop Mission Control, server/runtime, SSE, PostgreSQL, Circuit Breaker, Governor, stable_16, wave scheduler, and multi-worker orchestration are FUTURE scope for v0.1. See `docs/adr/ADR-013-plugin-first-pivot.md` and `docs/decisions.md` Section 23.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Read This First

**Read `README.md` first.** The project README is the clean public face of PRAXIS v0.1. It explains what PRAXIS is, what it's not, the v0.1 MVP, and the manual verify/repair loop with an example workflow.

**Read `architecture.md` second.** The canonical plugin-first architecture baseline: high-level flow, core components, package design, Truth Kernel gates, Claude Code plugin bridge, local state model, and future architecture.

**Read `docs/decisions.md` third.** It is the canonical decision register for PRAXIS v2.0. Every other document in `docs/` derives from it. If any document contradicts `docs/decisions.md`, `docs/decisions.md` wins.

**Read `docs/adr/ADR-013-plugin-first-pivot.md` fourth.** The Plugin-First Pivot ADR explains why PRAXIS changed from desktop-first orchestrator to plugin-first local Truth Kernel, what was kept, what was downgraded to future, and what was killed from v0.1.

**Read `docs/index.md` fifth.** This document. It tells you what exists, what order to read it in, and what you must not start building.

All documents are `DRAFT_FOR_AUDIT v0.1` -- not final implementation specifications. None have been accepted by the human project owner. Do not treat any document as a final design lock. **Implementation is NOT authorized.** Do not start implementation based on these drafts without explicit human approval after the Final Plugin-First Design Lock Audit (D4).

---

## Document Inventory

### Lock / Foundation

| Document | Path | Status |
|----------|------|--------|
| Canonical decision register | `docs/decisions.md` | DRAFT_FOR_AUDIT v0.1 (post-pivot) |
| **ADR-013 Plugin-First Pivot** | `docs/adr/ADR-013-plugin-first-pivot.md` | DRAFT_FOR_AUDIT v0.1 |
| ADR index | `docs/adr/README.md` | DRAFT_FOR_AUDIT v0.1 |
| Phase map (D0-D4 design, I0-I4 future) | `docs/phase-map.md` | DRAFT_FOR_AUDIT v0.1 (post-pivot) |
| Product scope (plugin-first v0.1) | `docs/product-scope.md` | DRAFT_FOR_AUDIT v0.1 (post-pivot) |
| Architecture baseline | `architecture.md` (repo root) | DRAFT_FOR_AUDIT v0.2 |

### New Plugin-First Docs (v0.1)

| Document | Path | Status |
|----------|------|--------|
| PRAXIS Identity & Glossary | `docs/identity.md` | DRAFT_FOR_AUDIT v0.1 |
| Task YAML contract | `docs/contracts/praxis-task-yaml.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| MVP v0.1 plugin-first scope | `docs/implementation/mvp-v0.1-plugin-first-scope.md` | DRAFT_FOR_AUDIT v0.1 |
| Claude Code plugin flow | `docs/pipelines/claude-code-plugin-flow.md` | DRAFT_FOR_AUDIT v0.1 |
| Local Truth Kernel flow | `docs/pipelines/local-truth-kernel-flow.md` | DRAFT_FOR_AUDIT v0.1 |

### Pipelines (15 documents)

| Document | Path | Status |
|----------|------|--------|
| End-to-end pipeline overview | `docs/pipelines/overview.md` | DRAFT_FOR_AUDIT v0.1 |
| TaskRun lifecycle FSM | `docs/pipelines/taskrun-lifecycle.md` | DRAFT_FOR_AUDIT v0.1 |
| Runtime event flow | `docs/pipelines/runtime-event-flow.md` | DRAFT_FOR_AUDIT v0.1 |
| Worker adapter pipeline | `docs/pipelines/worker-adapter.md` | DRAFT_FOR_AUDIT v0.1 |
| Claude Code adapter pipeline | `docs/pipelines/claude-code-adapter.md` | DRAFT_FOR_AUDIT v0.1 |
| PRAXIS hook capture pipeline | `docs/pipelines/praxis-hook-capture.md` | DRAFT_FOR_AUDIT v0.1 |
| Messages API fallback pipeline | `docs/pipelines/messages-api-fallback.md` | DRAFT_FOR_AUDIT v0.1 |
| Autonomous loop model | `docs/pipelines/autonomous-loop.md` | DRAFT_FOR_AUDIT v0.1 |
| Evidence to Truth Engine flow | `docs/pipelines/evidence-to-truth-engine.md` | DRAFT_FOR_AUDIT v0.1 |
| Circuit Breaker and Governor | `docs/pipelines/circuit-breaker-governor.md` | DRAFT_FOR_AUDIT v0.1 |
| RIM repair loop | `docs/pipelines/rim-repair-loop.md` | DRAFT_FOR_AUDIT v0.1 |
| Wave scheduler | `docs/pipelines/wave-scheduler.md` | DRAFT_FOR_AUDIT v0.1 |
| Namespace ownership and isolation | `docs/pipelines/namespace-ownership.md` | DRAFT_FOR_AUDIT v0.1 |
| Deterministic assembler | `docs/pipelines/deterministic-assembler.md` | DRAFT_FOR_AUDIT v0.1 |
| ACCP artifact pipeline | `docs/pipelines/accp-artifact-pipeline.md` | DRAFT_FOR_AUDIT v0.1 |

### Boundaries (2 documents)

| Document | Path | Status |
|----------|------|--------|
| Runtime-server-kernel wiring contract | `docs/boundaries/runtime-server-kernel.md` | DRAFT_FOR_AUDIT v0.1 |
| Worker adapter boundary contract | `docs/boundaries/worker-adapter-boundary.md` | DRAFT_FOR_AUDIT v0.1 |

### Contracts (12 documents)

| Document | Path | Status |
|----------|------|--------|
| TaskSpec contract | `docs/contracts/task-spec.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| PlanSpec contract | `docs/contracts/plan-spec.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| WorkerAdapter contract | `docs/contracts/worker-adapter.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| RunAttempt contract | `docs/contracts/run-attempt.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| RuntimeEvent contract | `docs/contracts/runtime-event.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| RuntimeSnapshot contract | `docs/contracts/runtime-snapshot.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| EvidenceRecord contract | `docs/contracts/evidence-record.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| GateVerdict contract | `docs/contracts/gate-verdict.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| CircuitBreakerState contract | `docs/contracts/circuit-breaker.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| GovernorState contract | `docs/contracts/governor.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| RepairPacket contract | `docs/contracts/repair-packet.contract.md` | DRAFT_FOR_AUDIT v0.1 |
| ConflictReport contract | `docs/contracts/conflict-report.contract.md` | DRAFT_FOR_AUDIT v0.1 |

### Testing and Implementation (3 documents)

| Document | Path | Status |
|----------|------|--------|
| Pipeline test strategy | `docs/testing/pipeline-test-strategy.md` | DRAFT_FOR_AUDIT v0.1 |
| P0 entry gate | `docs/implementation/p0-entry-gate.md` | DRAFT_FOR_AUDIT v0.1 |
| Day 0 Claude Code Spike | `docs/spikes/day-0-claude-code-spike.md` | DRAFT_FOR_AUDIT v0.1 |

### Meta

| Document | Path | Status |
|----------|------|--------|
| This index | `docs/index.md` | DRAFT_FOR_AUDIT v0.1 |

---

## Recommended Reading Order

### Tier 1: Foundation (Post-Pivot)

Read these first. They define what PRAXIS is after the Plugin-First Pivot.

| Order | Document | Why |
|-------|----------|-----|
| 1 | `docs/decisions.md` | Canonical decision register. The Three Laws, all D-NNN decisions, Section 23 pivot decisions. Every other document derives from this. |
| 2 | `docs/adr/ADR-013-plugin-first-pivot.md` | Why PRAXIS pivoted. KEEP / FUTURE / KILL classification. New MVP v0.1 shape. |
| 3 | `docs/product-scope.md` | Plugin-first v0.1 MVP scope. What is in, what is out, what is future. |
| 4 | `docs/phase-map.md` | D0-D4 design stages, I0-I4 future implementation stages. Implementation NOT authorized. |
| 5 | `docs/adr/README.md` | ADR index with normalized numbering. Historical context. |

After Tier 1, you should understand: PRAXIS is a local Truth Kernel (not a coding agent), Claude Code plugin is the first UX bridge, Desktop/server/multi-agent are future scope, and implementation is not yet authorized.

### Tier 2: System (Post-Pivot)

These documents define how PRAXIS works after the pivot.

| Order | Document | Why |
|-------|----------|-----|
| 1 | `docs/contracts/praxis-task-yaml.contract.md` | The v0.1 `.praxis/task.yaml` contract. Core to all verification. |
| 2 | `docs/implementation/mvp-v0.1-plugin-first-scope.md` | Exact v0.1 scope, non-goals, exit criteria. |
| 3 | `docs/pipelines/claude-code-plugin-flow.md` | How the Claude Code plugin bridges to the kernel. |
| 4 | `docs/pipelines/local-truth-kernel-flow.md` | How the Truth Kernel evaluates evidence and produces verdicts. |

After Tier 2, you should understand: the v0.1 task contract, the exact MVP scope, and how the plugin and kernel interact.

### Tier 3: Existing Docs (Future Scope for v0.1)

> **⚠ Future scope notice:** The following documents describe Desktop Mission Control, server/runtime, SSE, PostgreSQL, Circuit Breaker, Governor, Wave Scheduler, Deterministic Assembler, and multi-worker orchestration. **For v0.1, these are FUTURE scope after ADR-013.** They are preserved as reference for v0.2+ design. Do not treat them as active v0.1 requirements.

The complete inventory is preserved in the Document Inventory section below. Key docs now marked future:

- `docs/pipelines/runtime-event-flow.md` — Future (server/runtime)
- `docs/pipelines/circuit-breaker-governor.md` — Future (Circuit Breaker, Governor)
- `docs/pipelines/wave-scheduler.md` — Future (multi-worker)
- `docs/pipelines/deterministic-assembler.md` — Future (multi-worker)
- `docs/contracts/runtime-event.contract.md` — Future (server/runtime)
- `docs/contracts/runtime-snapshot.contract.md` — Future (server/runtime)
- `docs/contracts/governor.contract.md` — Future (Governor)
- `docs/contracts/circuit-breaker.contract.md` — Future (Circuit Breaker)

### Tier 4: Legacy Reading Order (Pre-Pivot)

The original Tier 2 (System), Tier 3 (Interfaces), and Tier 4 (Implementation Preparation) reading orders below are preserved as reference for the pre-pivot design. For v0.1 plugin-first work, use the Tier 1-2 order above.

### Tier 3: Interfaces

These are the contract documents that define the exact shapes and APIs shared between PRAXIS components. Read them before writing any integration code.

| Order | Document | Why |
|-------|----------|-----|
| 1 | `docs/contracts/task-spec.contract.md` | TaskSpec, AcceptanceCriterion, TaskBudget, PSAG validation rules. |
| 2 | `docs/contracts/plan-spec.contract.md` | PlanSpec, PlanBudget, PSAG plan-level checks, dependency graph, namespace partitioning. |
| 3 | `docs/contracts/worker-adapter.contract.md` | WorkerAdapter interface, WorkerHealth, RunAttemptInput/Result, ErrorSignal taxonomy. |
| 4 | `docs/contracts/run-attempt.contract.md` | RunAttemptInput/Result, AttemptManifest, DivergenceFlag, claim vs. verdict boundary. |
| 5 | `docs/contracts/runtime-event.contract.md` | RuntimeEvent envelope, 10 event type categories, sequencing/gap-detection, SSP ingestion. |
| 6 | `docs/contracts/runtime-snapshot.contract.md` | RuntimeSnapshot shape, sub-types, UI consumption algorithm. |
| 7 | `docs/contracts/evidence-record.contract.md` | EvidenceRecord and Evidence Hash Chain structure. |
| 8 | `docs/contracts/gate-verdict.contract.md` | PASS/HOLD/FAIL verdict structure with metadata. |
| 9 | `docs/contracts/circuit-breaker.contract.md` | CircuitBreakerState and transition payloads. |
| 10 | `docs/contracts/governor.contract.md` | GovernorState and tier definitions. |
| 11 | `docs/contracts/repair-packet.contract.md` | RepairPacket structure: failure signature, strategy, context. |
| 12 | `docs/contracts/conflict-report.contract.md` | ConflictReport structure: conflict type, files, workers, resolution. |

After Tier 3, you should understand: the exact interfaces and data shapes that define every boundary in the system.

### Tier 4: Implementation Preparation

These documents define how implementation is verified and gated. Read them before writing any P0 or later code. They also include the Day 0 Spike specification, which gates P4 (Claude adapter).

| Order | Document | Why |
|-------|----------|-----|
| 1 | `docs/testing/pipeline-test-strategy.md` | Test categories per phase, gate mapping, false-done requirements, Circuit Breaker test mandates. |
| 2 | `docs/implementation/p0-entry-gate.md` | P0 entry prerequisites, P0.1-P0.4 sub-gates, P0 Exit Gate, forbidden-copy enforcement. |
| 3 | `docs/spikes/day-0-claude-code-spike.md` | Day 0 Spike specification: 8 tests, GO/NO-GO criteria, fallback trigger. Gates P4. |
| 4 | Remaining pipeline docs (deep dives) | `docs/pipelines/worker-adapter.md`, `claude-code-adapter.md`, `praxis-hook-capture.md`, `messages-api-fallback.md`, `rim-repair-loop.md`, `wave-scheduler.md`, `namespace-ownership.md`, `deterministic-assembler.md`, `accp-artifact-pipeline.md`, `runtime-event-flow.md` |

After Tier 4, you should understand: what tests are required for each phase, what gates must pass before implementation can proceed, what the Day 0 Spike requires, and the detailed pipeline specifications for each component.

---

## Do Not Start

**No implementation is authorized.** The following must NOT be started:

| Component | Why Not | Gated By |
|-----------|---------|----------|
| **Any implementation (I0-I4)** | Design stages (D0-D4) not complete | D4 Final Plugin-First Design Lock Audit |
| praxis CLI source | Implementation not authorized | D4 + human approval |
| Truth Kernel source | Implementation not authorized | D4 + human approval |
| Claude Code plugin source | Implementation not authorized | D4 + human approval |
| Desktop Mission Control | Future scope for v0.1 (ADR-013) | v0.3+ |
| Server / runtime | Future scope for v0.1 (ADR-013) | v0.2+ |
| PostgreSQL storage | Future scope for v0.1 (ADR-013) | v0.2+ |
| Multi-worker orchestration | Future scope for v0.1 (ADR-013) | v0.3+ |
| Any package from the forbidden copy list | Explicitly rejected by decisions.md | D-049, D-050, D-051 |

---

## Decision ID Integrity

All decision IDs (D-NNN) referenced throughout the documentation were checked against `docs/decisions.md`, which is the canonical decision register.

**Rule:** If any document references a D-ID with a definition that differs from `docs/decisions.md`, `docs/decisions.md` wins. The document with the conflicting reference must be corrected to match the canonical definition.

**Current D-ID range:** D-001 through D-148, O-001 through O-010.

**Cross-reference status:** Updated 2026-06-18 for Plugin-First Pivot. D-127 through D-148 are new pivot decisions. D-002 through D-095 desktop-first decisions are superseded for v0.1 (see Section 23.6 of decisions.md).

---

## stable_16 Hypothesis

**stable_16 is an OPEN hypothesis, not a proven capability.**

The concurrency governor defines tiers from stable_3 through stable_16, each requiring 48 hours of consecutive clean operation before advancing. MVP-C targets stable_3 (three parallel workers). stable_16 is the theoretical ceiling and requires a formal architecture review before being accepted.

Do not design for stable_16 concurrency in MVP. Do not assume stable_16 is achievable. The Day 0 Spike (DAY0-T006) tests only 2/3/4 concurrent sessions -- it does not attempt to validate stable_16.

Reference: `ai_summary.md` Concurrency Governor Tiers section, `docs/decisions.md` Section 21 (O-001, O-002, O-010).

---

## Docs Artifact Package

The complete documentation set (`docs/` and select root files) is packaged in:

```
artifacts/praxis-docs-plugin-first-rebrand-aligned-v0.1.zip    ← Latest (post-rebrand)
artifacts/praxis-docs-plugin-first-pivot-v0.1.zip               ← Post-pivot
```

These zips contain the full snapshot of DRAFT_FOR_AUDIT v0.1 documentation after the Plugin-First Pivot (ADR-013) and subsequent rebrand alignment. They are point-in-time archives for audit and review, not living document sources. The canonical source is the git repository.

Previous artifacts:
- `artifacts/praxis-docs-v0.1-draft-fixed.zip` — Pre-pivot snapshot (desktop-first scope)

---

## Status of All Documents

All documents listed in this index are **DRAFT_FOR_AUDIT v0.1**. None have been accepted by the human project owner. None constitute a final design lock. Do not start implementation based on these drafts without explicit human approval.

Documents are numbered for purposes of this audit:
- 1 `decisions.md` (lock/foundation)
- 1 `adr/README.md` (lock/foundation)
- 1 `phase-map.md` (lock/foundation)
- 1 `product-scope.md` (lock/foundation)
- 15 pipeline docs
- 2 boundary docs
- 12 contract docs
- 1 test strategy doc
- 1 implementation gate doc
- 1 spike spec
- 1 index (this file)
- 1 `architecture.md` (repo root)

**Total: 38 DRAFT_FOR_AUDIT documents.**

---

## Document Authority Hierarchy

```
docs/decisions.md           ← CANONICAL. All other docs must not contradict.
        │
docs/adr/README.md          ← ADR index with formal decision history.
        │
architecture.md             ← Architecture baseline (must not contradict decisions.md).
        │
docs/pipelines/*.md         ← Process specifications (must respect decisions.md).
docs/contracts/*.md         ← Shape/API references (must respect decisions.md).
docs/boundaries/*.md        ← Wiring contracts between components.
docs/spikes/*.md            ← Spike specifications (must respect decisions.md).
docs/testing/*.md           ← Test strategy and gate definitions.
docs/implementation/*.md    ← Phase entry/exit gate definitions.
        │
docs/index.md               ← This file. Organizational only. Lowest authority in docs/.
```

---

## Change Policy

- Adding a new document: place it in the appropriate `docs/` subdirectory, use the standard DRAFT_FOR_AUDIT header, and update this index.
- Removing a document: remove the file and update this index.
- Changing a document's status from DRAFT_FOR_AUDIT to ACCEPTED: requires explicit human approval. Update both the document's header and this index.
- `docs/decisions.md` change policy: see Section 22 of `docs/decisions.md`. HARD_LOCK changes require a formal ADR or explicit human approval.

---

## Audit Notes

- This index was rewritten on 2026-06-18 to reflect the complete documentation set created during the P-1 phase. The prior version listed many documents as "Not yet created" (marked ⬜). Those documents have since been created and are now listed with their actual paths and DRAFT_FOR_AUDIT v0.1 status.
- All 38 documents (including `architecture.md` at the repo root) are DRAFT_FOR_AUDIT v0.1 status. None have been accepted.
- The Day 0 Claude Code Spike has NOT been executed. The spike specification exists; the spike itself is a future task gating P4.
- This index must not be treated as an authoritative specification. It is a navigation aid. All authority resides in `docs/decisions.md`.
- **Decision Compliance Checklist exemption:** This document is intentionally exempt from the Decision Compliance Checklist requirement (AC-012). As a navigation index, it organizes and points to other documents; it does not define architectural decisions, contracts, or pipelines that must comply with `docs/decisions.md`. All 35 specification documents under `docs/` carry the checklist.
