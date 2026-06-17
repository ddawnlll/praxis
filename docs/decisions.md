# PRAXIS Decisions

**Canonical decision summary for PRAXIS v2.0.**

This file is the central decision register. ADR files (`docs/adr/*`) may provide detailed rationale and formal change records, but this file is the quick canonical reference for humans and AI coding agents.

**All implementation tasks, ACCP prompts, and agents must read this file before starting work.** If architecture documents conflict, this file wins until an ADR index is created.

---

## 1. Status Legend

Every decision in this file carries one of four status labels. The label determines how the decision can be changed.

| Status | Label | Meaning | Change Policy |
|--------|-------|---------|---------------|
| 🔒 | **HARD_LOCK** | Core project decision. Foundation of PRAXIS architecture and safety model. | Changing requires a formal ADR or explicit human approval. Do not deviate without it. |
| 🔓 | **SOFT_LOCK** | Default decision. Established direction with room to evolve. | Can evolve during implementation as long as HARD_LOCK boundaries and laws are preserved. Update decisions.md and relevant pipeline/contract docs when changed. |
| ❓ | **OPEN** | Requires spike, mockup, implementation proof, or further discovery. | Becomes SOFT_LOCK or HARD_LOCK after investigation is complete. |
| 🚫 | **REJECTED** | Explicitly rejected alternative. | Cannot be reintroduced without a formal ADR. Future agents must not propose it. |

**How to read decisions below:** Each entry includes a decision ID (`D-NNN`), title, status label, rationale, implications, and rejected alternatives where applicable.

---

## 2. Canonical Source of Truth

PRAXIS documentation is organized by purpose. This section defines which document to consult for what.

| Document | Purpose | Authority |
|----------|---------|-----------|
| `docs/decisions.md` | Canonical decision summary. Quick register of all locked/open/rejected decisions. | **Primary** — if documents conflict, this file wins until ADR index is created. |
| `docs/adr/*` | Detailed rationale and formal change records for individual decisions. | Authoritative for decision history. Referenced by decisions.md. |
| `architecture.md` | Target architecture baseline, product model, directory layout, component boundaries. | Architecture reference. Must not contradict decisions.md. |
| `todo.md` | Implementation tracker with phase progress, task checkboxes, gates. | Current state source for what is done vs. not done. |
| `docs/pipelines/*` | Pipeline specifications (lifecycle, gates, data flow). | Process definition. Must respect decisions.md. |
| `docs/contracts/*` | Contract specifications (TaskSpec, RuntimeEvent, etc.). | Shape/API reference. Must respect decisions.md. |
| `README.md` | Project overview and onboarding document for new readers. | Entry point and high-level summary. |

**Conflict resolution order:** If documents contradict each other:
1. `docs/decisions.md` wins on decision content.
2. `architecture.md` wins on architecture boundaries.
3. ADR files provide historical context to resolve ambiguity.
4. If ambiguity remains, ask the human project owner.

---

## 3. MVP Scope Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-001 | PRAXIS is a local-first execution platform for autonomous AI coding workers. | **HARD_LOCK** | PRAXIS runs workers in isolated local workspaces; no cloud dependency for core execution. | All architecture assumes local-first. Cloud features are optional and post-MVP. |
| D-002 | Desktop Mission Control is part of MVP and is the main operator control panel. | **HARD_LOCK** | Operators need real-time visibility into worker state, gate verdicts, and system health. A desktop app provides rich observability. | All MVP phases must include Desktop Mission Control as the primary interface. See Section 10. |
| D-003 | Basic Electron operator shell is in scope for MVP. | **HARD_LOCK** | Desktop shell is the hosting layer for Mission Control. | Electron + React is the expected stack. |
| D-004 | Mission Control dashboard is in scope for MVP. | **HARD_LOCK** | Dashboard is the main view operators use. | Must render: runtime state, worker grid, task runs, gate verdicts, circuit breaker status. |
| D-005 | Runtime state viewer is in scope for MVP. | **HARD_LOCK** | Operators must see current runtime state at a glance. | Snapshot-based rendering via server/client contracts. |
| D-006 | TaskRun list/detail is in scope for MVP. | **HARD_LOCK** | Task lifecycle visibility is required. | List and detail views for all task runs. |
| D-007 | Worker grid is in scope for MVP. | **HARD_LOCK** | Shows which workers are active, their status, and workspace assignments. | Essential for parallel execution phases. |
| D-008 | Evidence/log stream is in scope for MVP. | **HARD_LOCK** | Real-time evidence and log visibility for debugging and verification. | SSE-backed event stream in UI. |
| D-009 | Gate verdicts are in scope for MVP. | **HARD_LOCK** | Operators must see EvidenceGate, ExecGate, FinalGate results. | Verdict display in Mission Control. |
| D-010 | Circuit Breaker / Governor status are in scope for MVP. | **HARD_LOCK** | Safety system state must be visible. | Status panels for both in Mission Control. |
| D-011 | Human action queue is in scope for MVP. | **HARD_LOCK** | Some outcomes require human intervention; queue must be surfaced. | Actionable items displayed in Mission Control. |
| D-012 | Production polish is not MVP-critical. | **HARD_LOCK** | Correctness and observability come before visual polish. | Basic functional UI is acceptable in MVP. |
| D-013 | Cloud dashboard is out of MVP scope. | **HARD_LOCK** | PRAXIS is local-first. Cloud dashboard is a future consideration. | Do not design or implement cloud features in MVP. |
| D-014 | Old pi/web-ui reuse is rejected. | **REJECTED** | Old UI is overfit to old project and would carry wrong assumptions. | Write Desktop Mission Control from scratch. |
| D-015 | CLI-only MVP is rejected. | **REJECTED** | A CLI-only MVP would lack the observability and control surface needed for safe autonomous execution. | Desktop Mission Control is mandatory. See D-002. |

---

## 4. Core Architecture Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-016 | PRAXIS is a local-first execution platform. | **HARD_LOCK** | See D-001. Workers run in isolated local workspaces. | Server binds to 127.0.0.1 only in MVP. |
| D-017 | PRAXIS has a Desktop Mission Control control panel. | **HARD_LOCK** | See Section 10. Desktop is the primary operator interface. | All operator interactions go through Mission Control. |
| D-018 | No root `src/` directory. | **HARD_LOCK** | Top-level directories are domain-boundaries (`kernel/`, `server/`, etc.), not a flat src/. | Structure is: `kernel/`, `adapters/`, `hooks/`, `server/`, `interface/`, `lib/`. |
| D-019 | `lib/contracts` contains shared contracts and no business logic. | **HARD_LOCK** | Contracts are shared types only. Business logic belongs in kernel. | Any package may import `lib/contracts`. `lib/contracts` must not import kernel/server/adapters/interface. |
| D-020 | `kernel/` owns pure execution, domain, and safety logic. | **HARD_LOCK** | Kernel is the brain: FSM, PSAG, evidence, Truth Engine, RIM, Governor, Circuit Breaker, Assembler, ACCP. | Kernel must not import server, adapters, or interface. |
| D-021 | `adapters/` integrate external workers. | **HARD_LOCK** | Adapters are bridges to concrete tools (Claude Code, OpenCode, etc.). | Adapters do not decide completion. They normalize worker output. |
| D-022 | `hooks/` capture external tool events. | **HARD_LOCK** | Hook binaries intercept tool calls in external processes (esp. Claude Code). | Hooks do not decide truth. They emit raw events. |
| D-023 | `server/` composes runtime, storage, API, event bus, and adapters. | **HARD_LOCK** | Server is the wiring layer that brings everything together. | Server composes concrete dependencies. Kernel must not import server. |
| D-024 | `interface/` displays runtime and kernel state only. | **HARD_LOCK** | Interface is a view into the system, not a decision maker. | Interface must not decide completion or invent state. |
| D-025 | HTTP commands/queries + SSE event stream is MVP communication model. | **HARD_LOCK** | REST for commands/queries, SSE for real-time events. Simple, well-understood, sufficient for MVP. | WebSocket is explicitly rejected for MVP (see Section 19). |
| D-026 | UI state comes from snapshot + RuntimeEvent replay. | **HARD_LOCK** | Initial state from snapshot, incremental updates from event stream. Gaps trigger snapshot refresh. | Server exposes `GET /api/snapshot` and `GET /api/events?after=<seq>`. |
| D-027 | Server composes concrete dependencies; kernel must not import server/adapters/interface. | **HARD_LOCK** | Dependency direction: kernel ← lib ← server → adapters, interface. Kernel is dependency-free from higher layers. | Enforced by boundary checker. |

---

## 5. The Three Laws

The Three Laws are the non-negotiable foundation of PRAXIS. All architecture, implementation, and operation must obey them.

### Law 1 — Completion Authority

> **Agent says done is not done. Truth Engine FinalGate PASS is done.**

| Field | Value |
|-------|-------|
| Status | **HARD_LOCK** |
| Rationale | Worker self-report is inherently unreliable. An agent may claim completion without producing evidence, or produce output that fails acceptance criteria. Only the Truth Engine, evaluating evidence against human-authored criteria, can declare completion. |
| Implications | Worker self-report (exit code 0, Claude "Task completed" message) is evidence, not completion. The Truth Engine runs EvidenceGate, ExecGate, and FinalGate in sequence. No other component decides completion. |
| Rejected alternatives | Worker self-report as completion (REJECTED). UI-owned completion (REJECTED). Adapter-owned truth (REJECTED). Agent-generated acceptance criteria (REJECTED). |

### Law 2 — Write Authority

> **No worker writes shared integration files. The Deterministic Assembler is the only shared writer.**

| Field | Value |
|-------|-------|
| Status | **HARD_LOCK** |
| Rationale | If multiple workers write to the same file, integration conflicts become undetectable and unrecoverable. Centralizing shared writes in the Assembler ensures atomic, verifiable integration. |
| Implications | Workers operate in isolated namespaced workspaces. Shared files (integration points) are written only by the Assembler after all worker gates pass. The Assembler performs namespace recheck, semantic check, atomic apply, and rollback on failure. |
| Rejected alternatives | Workers writing directly to shared locations (REJECTED — violates namespace isolation). No assembler (REJECTED — no safe integration point). |

### Law 3 — Verification Authority

> **FinalGate criteria come from human-authored TaskSpec only.**

| Field | Value |
|-------|-------|
| Status | **HARD_LOCK** |
| Rationale | An agent cannot verify its own work. Acceptance criteria must be specified by a human before execution begins. Agent-generated criteria create an echo chamber where the agent passes gates it defined for itself. |
| Implications | TaskSpec `criteria_source` must be `'human'`. PSAG rejects `'generated'` criteria. Missing human-authored acceptance criteria blocks TaskSpec admission. |
| Rejected alternatives | Agent-generated acceptance criteria (REJECTED — creates circular verification). Auto-generated criteria from plan (REJECTED — agent still wrote the plan). |

---

## 6. Completion, Truth, and Evidence Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-028 | Worker self-report is not completion. | **HARD_LOCK** | Law 1 enforcement. Worker exit code, stdout claims, "done" messages are evidence, not verdicts. | All worker output feeds into EvidenceGate but does not shortcut the gate pipeline. |
| D-029 | UI never decides completion. | **HARD_LOCK** | The interface layer renders state; it does not evaluate it. A "Mark Complete" button in the UI must not override Truth Engine verdict. | All completion decisions flow through Truth Engine. UI displays verdicts, does not create them. |
| D-030 | Adapter never decides completion. | **HARD_LOCK** | Adapters normalize worker output; they do not evaluate it. An adapter must not emit a PASS/HOLD/FAIL verdict. | Adapters produce normalized AttemptManifests. Gates consume them. |
| D-031 | Hook never decides truth. | **HARD_LOCK** | Hooks capture raw events from external tools. They must not interpret, filter, or evaluate those events for truth. | All hook events are raw evidence. The Evidence Hash Chain preserves integrity. |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL. | **HARD_LOCK** | The Truth Engine is the sole authority for attempt completion status. | Three gates: EvidenceGate (was there evidence?), ExecGate (did output pass tests?), FinalGate (did output meet all acceptance criteria?). |
| D-033 | EvidenceGate, ExecGate, FinalGate are kernel-owned. | **HARD_LOCK** | Gate logic lives in kernel/truth-engine. | Gates are not in adapters, server, or interface. |
| D-034 | EvidenceRecord and EHC are required for trustworthy verification. | **HARD_LOCK** | Without a verifiable evidence chain, gate verdicts cannot be audited. The Evidence Hash Chain (EHC) provides tamper-evident evidence linking. | Every attempt produces an EvidenceRecord chain. EHC break classification (NOISE/SUSPECTED/CONFIRMED) feeds Circuit Breaker. |
| D-035 | Agent-generated acceptance criteria are rejected. | **REJECTED** | See Law 3. Agents cannot define their own completion criteria. | PSAG rejects any TaskSpec with `criteria_source: 'generated'`. |
| D-036 | Missing human-authored acceptance criteria blocks completion. | **HARD_LOCK** | TaskSpec without acceptance criteria cannot pass FinalGate because there are no criteria to evaluate against. | Plan admission (PSAG) must check for criteria presence. FinalGate without criteria defaults to FAIL. |

---

## 7. ACCP Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-037 | ACCP artifacts are async and non-blocking. | **HARD_LOCK** | ACCP artifact generation (FVR, PRR) must not block the execution critical path. TaskRun completion does not wait for ACCP artifact production. | ACCP artifacts are produced by async background jobs. Server must not require ACCP completion before returning gate verdicts. |
| D-038 | ACCP must not block the execution critical path. | **HARD_LOCK** | Same as D-037. Execution flow (admit → run → capture → verify → assemble) must not depend on ACCP artifact completion. | Any ACCP generation failure must not roll back or block execution. |
| D-039 | `accp-compiler` from `pi/` may be ported to `kernel/accp`. | **HARD_LOCK** | The accp-compiler is well-tested (135 tests), has clean API boundaries, and provides deterministic YAML-to-JSON compilation. | Port with adaptation: rename namespace, align with PRAXIS contracts, remove old project coupling. |
| D-040 | ACCP compiler is not the Truth Engine. | **HARD_LOCK** | The ACCP compiler produces compiled plans and artifacts. The Truth Engine evaluates attempt completion. They are separate concerns. | The ACCP compiler's gate evaluator primitives may be reused as validation utilities, but the compiler itself must not perform Truth Engine functions. |
| D-041 | Old ACCP gate/evidence primitives may be reused as validation primitives. | **HARD_LOCK** | The old accp-compiler has evidence validation and gate evaluation utilities that can inform PRAXIS Truth Engine design. | Reuse as reference/patterns only. PRAXIS Truth Engine is a rewrite from scratch. |
| D-042 | FVR and PRR may be produced later as async artifacts. | **HARD_LOCK** | Final Verification Report and Phase Review Report are post-execution artifacts. Their format and production can be deferred. | FVR per TaskRun, PRR per wave. Both async and non-blocking. |
| D-043 | Do not expand to many ACCP report types in MVP unless evidence requires it. | **HARD_LOCK** | ACCP defines many report types (RAR, FVR, PRR, etc.). Only implement what MVP evidence practices require. | Start with minimal ACCP types. Expand only when a concrete need is demonstrated. |

---

## 8. pi/ Reuse Decisions

This section defines the reuse strategy for the old `pi/` monorepo.

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-044 | P0 is **Selective pi/ Reuse Foundation Port**, not migration from the old repo. | **HARD_LOCK** | The old `pi/` codebase is reference and selective port source, not a codebase to wholesale migrate. Full migration would carry old coupling and architectural assumptions into PRAXIS. | All P0 documentation, prompts, and plans must use the term "Selective pi/ Reuse Foundation Port." Do not describe P0 as "migration from old repo." |
| D-045 | **PORT_AND_ADAPT:** `pi/packages/execution-contracts` → `lib/contracts`. | **HARD_LOCK** | The execution-contracts package has clean TypeScript interfaces, 247 tests, and minimal dependencies. It is the right foundation for `@praxis/contracts`. | Rename `@earendil-works/*` to `@praxis/*`. Adapt types to PRAXIS naming and laws. Remove old-project-specific types. |
| D-046 | **PORT_AND_ADAPT:** `pi/packages/accp-compiler` → `kernel/accp`. | **HARD_LOCK** | The accp-compiler has 135 tests, deterministic output, and clean pipeline boundaries. Porting saves months of reimplementation. | Replace old contract imports with `@praxis/contracts`. Remove old namespace. Ensure compiler remains async/non-blocking. |
| D-047 | **REFERENCE_ONLY:** `pi/packages/execution-runtime` FSM, completion, state-authority, deadline patterns. | **HARD_LOCK** | The old runtime has well-designed FSM and completion patterns but is coupled to old DB/Kysely and coding-agent internals. | Document patterns for PRAXIS kernel/core rewrite. Do not copy old runtime code directly. |
| D-048 | **REWRITE_FROM_SCRATCH:** kernel/core, evidence, truth-engine, circuit-breaker, adapters, hooks, server, interface, storage. | **HARD_LOCK** | These components are either too coupled to old project, need PRAXIS-law compliance from day one, or don't exist in old repo. | Write from scratch with PRAXIS architecture, Three Laws compliance, and contract-first development. |
| D-049 | **REJECTED / DO NOT COPY:** `pi/packages/coding-agent`, `agent`, `brain`, `ai`, `db`, `web-server`, `web-ui`, `tui`, `worker-adapters`, `execution-service`. | **REJECTED** | These packages are overfit to the old project, have wrong architectural assumptions, or are irrelevant to PRAXIS. | Do not copy, reference for design only, or fully discard. |
| D-050 | Old runtime controller code coupled to DB/Kysely must not become PRAXIS kernel. | **REJECTED** | The old execution-runtime imports `@earendil-works/pi-db` and kysely directly. This coupling would violate PRAXIS kernel purity. | PRAXIS kernel/core is a clean rewrite with storage abstraction, not DB-coupled logic. |
| D-051 | Full pi/ migration is rejected. | **REJECTED** | See D-044. Full `pi/` migration is rejected because wholesale migration would import old coupling, wrong architecture, and unneeded packages. | Selective port only as defined in D-045 through D-048. |

---

## 9. Phase Model Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-052 | P-1 through P6 is the canonical phase model. | **HARD_LOCK** | The phase model (P-1, P0, P1–P6) provides clear staging from decision lock through production hardening. | All planning, ACCP prompts, and progress tracking must use this phase model. |
| D-053 | P-1: Lock/alignment/decision docs. | **HARD_LOCK** | Phase P-1 freezes core decisions before implementation begins. | Produces decisions.md, ADR index, lock matrix, phase map, reuse policy. |
| D-054 | P0: Selective pi/ Reuse Foundation Port. | **HARD_LOCK** | Port only proven reusable foundations from old pi/ monorepo. | P0.1 scaffold, P0.2 contracts, P0.3 accp-compiler, P0.4 FSM reference doc. |
| D-055 | P1: Pipeline docs, runtime contracts, Desktop Mission Control mockup/basic shell. | **HARD_LOCK** | Define operator experience and runtime contracts before building runtime. | Produces contract docs, pipeline specs, interactive desktop mockup. |
| D-056 | P2: Mock runtime vertical slice. | **HARD_LOCK** | Prove UI + runtime event model before real worker integration. | Mock workers, in-memory event log, SSE stream, desktop connection. |
| D-057 | P3: Kernel safety core. | **HARD_LOCK** | Implement FSM, PSAG, evidence, Truth Engine, Circuit Breaker with mock evidence. | All gates, EHC, false-done detection, namespace enforcement. |
| D-058 | P4: Claude hook + adapter. | **HARD_LOCK** | Integrate real Claude Code only after kernel safety core works. | Day 0 Spike gates this phase. Hook-primary, Messages API fallback. |
| D-059 | P5: Parallel execution + assembler. | **HARD_LOCK** | Safely run multiple workers with namespace isolation and deterministic assembly. | Wave scheduler, governor, namespace locks, assembler, conflict detection. |
| D-060 | P6: ACCP artifacts + production hardening. | **HARD_LOCK** | Async ACCP reports, PostgreSQL durability, CLI, packaging, e2e tests. | Production readiness. |
| D-061 | Old Phase 0/1/2/3 labels must be mapped to P-1/P0/P1/P2/P3/P4/P5/P6. | **HARD_LOCK** | Older discussions used different phase numbering. The canonical model supersedes. | Any reference to "Phase 0" in old docs maps to P-1. "Phase 1" maps to P0, etc. |

---

## 10. Desktop Mission Control Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-062 | Desktop app is MVP. | **HARD_LOCK** | See D-002. Desktop Mission Control is the primary operator interface. | All MVP phases include desktop. |
| D-063 | Desktop app is the main control panel. | **HARD_LOCK** | Operators manage PRAXIS through Mission Control: admit plans, view runs, inspect evidence, approve repairs. | CLI is secondary. Desktop is primary. |
| D-064 | Electron + React + Tailwind/Radix/TanStack direction is acceptable unless later ADR changes it. | **SOFT_LOCK** | This stack is familiar, productive, and well-suited to the Mission Control use case. | If a later spike shows significant issues, an ADR may revise. |
| D-065 | Desktop must render runtime state from server/client contracts. | **HARD_LOCK** | The desktop renders snapshots and events. It does not hold independent state. | All state comes from `GET /api/snapshot` and SSE event stream. |
| D-066 | Desktop must not own truth. | **HARD_LOCK** | The desktop is a view into kernel state. It must not make completion decisions or override gate verdicts. | No "override verdict" or "force complete" buttons in MVP (may be added later with ADR and safety review). |
| D-067 | Desktop must support mock runtime first. | **HARD_LOCK** | P1 produces a desktop mockup with fake runtime data. P2 connects it to a mock server. | No real worker dependency for desktop development. |
| D-068 | Desktop must later connect to real runtime through interface/client. | **HARD_LOCK** | After mock proof, desktop connects to real server through typed client. | Migration path: mock → mock server → real server. |
| D-069 | Production-level visual polish is lower priority than correctness and observability. | **HARD_LOCK** | A functional but unpolished desktop is acceptable if it correctly displays system state. | Polish is production hardening (P6). |

---

## 11. Claude Code Integration Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-070 | Primary path: Claude Code headless + praxis-hook. | **SOFT_LOCK** | Claude Code headless mode with Pre/PostToolUse hooks provides the most direct integration: PRAXIS sees every tool call without modifying Claude's internal loop. | Hook captures tool events, tool outputs, stop signals. Produces KernelOwnedTranscript. |
| D-071 | Fallback path: Claude Messages API + PRAXIS-instrumented tools if Day 0 Spike returns NO-GO. | **SOFT_LOCK** | If hooks prove unreliable (missed events, timing issues, rate limit gaps), fall back to a custom agent loop using the Messages API. | Fallback is more work but gives PRAXIS full control over tool execution. |
| D-072 | Day 0 Spike must verify headless behavior, hooks, divergence capture, and rate limit ceiling. | **HARD_LOCK** | Real-world hook reliability and Claude Code behavior under PRAXIS supervision must be proven before full adapter implementation. | Spike runs before P4 implementation. GO/NO-GO decision gates P4. |
| D-073 | Claude adapter is an external worker bridge. | **HARD_LOCK** | The adapter starts Claude Code processes, prepares env/config/prompts, normalizes results into AttemptManifests. | Adapter is not kernel, not Truth Engine, not completion authority. |
| D-074 | Claude adapter starts processes, prepares env/config/prompts, normalizes results. | **HARD_LOCK** | Adapter responsibilities are mechanical: launch, configure, capture output, normalize. | See D-030 (adapter never decides completion). |
| D-075 | Claude adapter does not decide completion. | **HARD_LOCK** | Law 1 enforcement. The adapter must not emit gate verdicts. | Adapter produces normalized worker output for the Truth Engine. |
| D-076 | Claude local loop is separate from PRAXIS supervisory loop. | **HARD_LOCK** | Claude's internal tool-use loop is independent. PRAXIS supervises from the outside via hooks and evidence capture. | See Section 12 (Autonomous Loop). |
| D-077 | Claude Code implementation must not start before Day 0 Spike GO. | **HARD_LOCK** | P4 is gated on Day 0 Spike results. Do not write adapter/hook code before the spike confirms feasibility. | See D-072. |

---

## 12. Autonomous Loop Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-078 | Use two-layer autonomous model. | **HARD_LOCK** | Separation of concerns: Claude handles local tool execution; PRAXIS handles supervision, verification, and safety. | Two independent loops that communicate through hooks, evidence, and gate verdicts. |
| D-079 | Claude local loop uses tools, edits files, runs commands, stops. | **HARD_LOCK** | Claude's internal loop is unchanged. Claude writes code, runs commands, and reports completion as normal. | PRAXIS does not intercept or modify Claude's internal decision-making. |
| D-080 | PRAXIS supervisory loop admits attempts, captures evidence, runs gates, dispatches repair, and controls safety. | **HARD_LOCK** | PRAXIS operates at the attempt level: it admits plans, monitors execution via hooks, evaluates evidence through gates, and manages safety via Circuit Breaker. | The supervisory loop is the source of truth for completion and safety. |
| D-081 | RIM starts only after HOLD/FAIL gate outcomes. | **HARD_LOCK** | Repair Intelligence Module activates only when the Truth Engine finds incomplete or failed attempts. | RIM does not run on PASS outcomes. RIM strategies rotate through 6 levels (see ai_summary.md). |
| D-082 | Circuit Breaker can stop new admissions. | **HARD_LOCK** | When the system is unsafe (high failure rate, confirmed EHC break, sustained governor RED), Circuit Breaker OPEN prevents new work from starting. | HALF_OPEN permits exactly one probe attempt. |
| D-083 | Governor controls concurrency, not truth. | **HARD_LOCK** | The Governor manages how many workers can safely run. It does not evaluate completion or evidence. | Governor is separate from Truth Engine. See D-021 (Section 13). |

---

## 13. Circuit Breaker and Governor Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-084 | Circuit Breaker is kernel-owned. | **HARD_LOCK** | System-wide safety authority belongs in the kernel, not server/adapters/interface. | Circuit Breaker lives in `kernel/circuit-breaker`. |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN. | **HARD_LOCK** | Standard circuit breaker pattern: closed (normal operation), open (rejecting admissions), half-open (probing recovery). | Must test all three states and transitions. |
| D-086 | Circuit Breaker answers: is the whole system safe enough to admit work? | **HARD_LOCK** | Circuit Breaker is system-level safety. It is not per-task or per-worker. | OPEN prevents all new admissions, not just specific tasks. |
| D-087 | Governor answers: how many workers can safely run? | **HARD_LOCK** | Governor is concurrency authority. It determines the safe parallelism level based on stability metrics. | Governor does not evaluate task correctness. It evaluates system load and stability. |
| D-088 | Truth Engine answers: is this attempt complete? | **HARD_LOCK** | Truth Engine is attempt-level completion authority. See Sections 5 and 6. | The three authorities (CB, Governor, TE) answer different questions. |
| D-089 | Circuit Breaker implementation belongs in `kernel/circuit-breaker`. | **HARD_LOCK** | Physical location in the codebase. | Package location `kernel/circuit-breaker`. |
| D-090 | Circuit Breaker should not be delayed to production hardening only. | **HARD_LOCK** | Circuit Breaker is a core safety component. It must be implemented in P3 (kernel safety core), not deferred to P6. | Implement Circuit Breaker with all three states, triggers, and tests in P3. |

---

## 14. Storage and Event Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-091 | Durable event log is required. | **HARD_LOCK** | Without durable event storage, runtime state is lost on restart, and audit/debug capabilities are severely limited. | All runtime events are persisted. Event replay is core to state recovery and debugging. |
| D-092 | PostgreSQL is primary MVP storage unless later ADR changes it. | **SOFT_LOCK** | PostgreSQL is mature, well-understood, and sufficient for PRAXIS data models (events, task runs, plans, evidence). | If a spike shows significant issues (setup complexity on target OS, performance problems), an ADR may revise. |
| D-093 | Kysely + raw SQL migrations direction is acceptable. | **SOFT_LOCK** | Kysely provides type-safe query building without heavy ORM overhead. Raw SQL migrations give full control over schema evolution. | If during P0.1 scaffold or early implementation this proves problematic, an ADR may revise. |
| D-094 | PostgreSQL setup automation is required. | **HARD_LOCK** | PRAXIS must set up its own database (or guide the user through setup) automatically. Requiring manual PostgreSQL administration is not acceptable. | Setup script or embedded solution. This is an OPEN decision until a specific approach is proven. |
| D-095 | `runtime_events` append-only log is core to replay/debugging. | **HARD_LOCK** | The append-only event log is the source of truth for runtime state reconstruction. | Every state mutation produces a RuntimeEvent. Events are never modified or deleted. |
| D-096 | Snapshot + event replay is UI state source. | **HARD_LOCK** | See D-026. UI state is initialized from snapshot and updated via event replay. | Server produces periodic snapshots. UI applies events incrementally. |
| D-097 | Exact table names are SOFT_LOCK until implementation. | **SOFT_LOCK** | Table naming can be refined during implementation. The requirement is that tables exist and store events durably. | Rename tables during implementation as needed. Update contracts docs after changes. |

---

## 15. Contract Strategy Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-098 | Contract-first development is mandatory. | **HARD_LOCK** | Contracts define the API boundaries between all PRAXIS components. Writing contracts before implementation prevents integration failures and ensures component isolation. | Every implementation phase must start with contract definition. Server/runtime/kernel integration requires contract docs first. |
| D-099 | `lib/contracts` should be ported/adapted from `pi/packages/execution-contracts`. | **HARD_LOCK** | See D-045. The old contracts package is a proven foundation. | Port with adaptation, rename, and PRAXIS law compliance. |
| D-100 | Contract docs must exist before implementing server/runtime/kernel integration. | **HARD_LOCK** | Integration requires shared understanding of shapes and boundaries. Contracts are the shared language. | Write `docs/contracts/*.md` before P2/P3 implementation. |
| D-101 | Required contracts include: TaskSpec, PlanSpec, AcceptanceCriterion, WorkerAdapter, RunAttemptInput, RunAttemptResult, RuntimeEvent, RuntimeSnapshot, EvidenceRecord, GateVerdict, CircuitBreakerState, GovernorState, RepairPacket, ConflictReport. | **HARD_LOCK** | These contracts cover the core PRAXIS domain: plans, execution, evidence, gates, safety, repair, assembly. | Each contract must be defined in `lib/contracts` and documented in `docs/contracts/*.md`. |
| D-102 | Contract shapes are SOFT_LOCK until P0.2 completes and tests pass. | **SOFT_LOCK** | Contracts will be refined during porting as old types are adapted to PRAXIS naming and requirements. | Lock shapes after P0.2 tests pass. Changes after that require updating contract docs and ADR if HARD_LOCK boundary is affected. |

---

## 16. Testing and Gate Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-103 | Every implementation phase must have gate criteria. | **HARD_LOCK** | Phase gates prevent proceeding with broken or incomplete foundations. | Each phase's acceptance criteria in todo.md must pass before next phase begins. |
| D-104 | Agent claims are not completion evidence. | **HARD_LOCK** | See Law 1. An agent saying "test passed" is not evidence. Test output, exit codes, and file diffs are evidence. | Gates evaluate concrete evidence, not agent claims. |
| D-105 | False-done tests are mandatory. | **HARD_LOCK** | PRAXIS must detect and reject attempts that appear complete but are not (empty diff, zero tests ran, agent claiming completion without output). | Every gate must include false-done test cases. |
| D-106 | Empty diff must not complete. | **HARD_LOCK** | A worker that produces no changes but claims completion must fail FinalGate. | ExecGate checks diff content. Empty diff is a HOLD or FAIL signal. |
| D-107 | Zero tests ran must not pass ExecGate. | **HARD_LOCK** | Running zero tests is not evidence of passing tests. | TestOutputParser must detect zero-test-run scenarios. |
| D-108 | Namespace violation must fail. | **HARD_LOCK** | A worker writing outside its assigned namespace is a safety violation. | Namespace check runs before assembly and during evidence evaluation. |
| D-109 | Circuit Breaker transitions must be tested. | **HARD_LOCK** | All three CB states and all triggers (failure rate, governor RED, EHC CONFIRMED) must have tests. | P3 must include complete Circuit Breaker test suite. |
| D-110 | P0 gate must pass before P2/P3/P4 implementation. | **HARD_LOCK** | Foundation port (P0) must be complete and passing before runtime (P2) and kernel (P3) implementation. | Merge order: P0 → P0 Gate → P2/P3. |

---

## 17. Parallel Development Decisions

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-111 | Parallel work is allowed only with namespace ownership. | **HARD_LOCK** | Teams/agents must own clear namespace boundaries. No two parallel tasks may write to the same package without coordination. | Each parallel task has a defined file scope. Cross-package coordination requires sequential merge. |
| D-112 | P0 can be partially parallelized. | **HARD_LOCK** | P0 sub-phases have some independence that permits parallel execution. | Safe parallel sets defined below. |
| D-113 | Safe parallel tasks: P0.1 scaffold, P0.4 FSM reference doc, Day 0 Spike, P-1 doc alignment. | **HARD_LOCK** | These tasks have no file overlap and no dependency on each other's outputs. | Run in parallel without coordination risk. |
| D-114 | P0.2 contracts port should follow scaffold. | **HARD_LOCK** | Contracts port depends on monorepo scaffold (P0.1) for package structure, build config, and test runner. | Sequential dependency: P0.1 → P0.2. |
| D-115 | P0.3 accp-compiler port should follow stable contracts shape. | **HARD_LOCK** | The ACCP compiler depends on contract types. Porting should wait until contracts shape is stable enough. | Sequential dependency: P0.2 (partial) → P0.3. |
| D-116 | Do not start server/runtime, kernel/core, real Claude adapter, assembler, or desktop real runtime connection before gates. | **HARD_LOCK** | These components depend on foundation stability. Starting before gates produces rework. | See D-110. P0 gate must pass first. |

---

## 18. Stack Decisions

These decisions cover the core tooling and runtime stack. They are SOFT_LOCK unless otherwise noted — implementation experience may refine them.

| ID | Decision | Status | Rationale | Implications |
|----|----------|--------|-----------|--------------|
| D-117 | TypeScript strict mode is the implementation language. | **HARD_LOCK** | TypeScript with strict mode provides the type safety, contract enforcement, and tooling ecosystem needed for a verification-heavy codebase. | All packages use TypeScript strict. Contracts are TypeScript interfaces. |
| D-118 | Bun is the runtime, package manager, and test runner. | **SOFT_LOCK** | Bun provides fast installs, native TypeScript support, and a built-in test runner compatible with Vitest. Single tool for runtime + package management reduces complexity. | `bun install`, `bun test`, `bun run typecheck`. Workspaces managed via Bun workspaces. |
| D-119 | Hono is the HTTP framework for the control plane. | **SOFT_LOCK** | Hono is lightweight, TypeScript-native, and well-suited to the REST + SSE communication model. | Control plane routes use Hono. SSE streaming via Hono's stream helper. |
| D-120 | PostgreSQL is the primary storage backend. | **SOFT_LOCK** | See D-092. PostgreSQL provides strong indexing, JSONB, transactions, and durable event logs needed for evidence-heavy workloads. | No SQLite in MVP. PostgreSQL setup automation required (D-094). |
| D-121 | Kysely + raw SQL migrations for database access. | **SOFT_LOCK** | See D-093. Kysely provides type-safe query building without ORM overhead. Raw SQL migrations give full control over schema evolution. | No ORM. Migration files in `server/storage/migrations/`. |
| D-122 | Zod for runtime validation of API payloads and contracts. | **SOFT_LOCK** | Zod provides runtime type checking that complements TypeScript compile-time types, especially at API boundaries. | Used in control plane routes, client, and contract validation. |
| D-123 | Biome for linting and formatting. | **SOFT_LOCK** | Biome is fast, unified (lint + format in one tool), and TypeScript-native. | Single `biome.json` config at root. |
| D-124 | Vitest is the test framework. | **SOFT_LOCK** | Vitest is Bun-compatible, fast, and uses the same API as Jest (familiar to most developers). | All package tests use Vitest. Cross-package tests in `tests/`. |
| D-125 | Playwright for desktop e2e tests (P6). | **SOFT_LOCK** | Playwright provides cross-browser testing for Electron apps. | e2e tests in `tests/e2e/`. Not required until P6. |
| D-126 | Desktop stack: Electron + React + Tailwind + Radix UI + TanStack Query + Zustand. | **SOFT_LOCK** | See D-064. This stack is familiar, productive, and covers state management, UI components, and styling. | Desktop app in `interface/desktop/`. Monaco Editor and xterm.js for code/terminal views. |

---

## 19. MVP Definition

PRAXIS MVP is staged, not one giant release. Each stage adds a layer of capability.

| Stage | Name | Scope | Gate Verdict |
|-------|------|-------|--------------|
| **MVP-A** | Mock Runtime Proof | Desktop Mission Control mockup with fake data. Mock worker producing events. In-memory event log. SSE stream. UI displays simulated task runs, gate verdicts, CB state. | Desktop opens and displays realistic mock state without backend dependency. |
| **MVP-B** | Single Real Worker | One real Claude Code worker with hooks, evidence capture, and Truth Engine. False-done detection. Divergence detection. Gate verdicts for real attempts. | Real Claude attempt runs in isolated workspace. Empty diff false-done is caught. Gate verdicts are correct. |
| **MVP-C** | Three Parallel Workers | Wave scheduler, namespace isolation, Deterministic Assembler. Three workers running concurrently on a coordinated plan. Assembler produces atomic patches or ConflictReport. | Three workers run in parallel. Assembler produces correct integration. Rollback works on conflict. |

**What MVP is not:** MVP is not a production-ready polished product. It is a proof of the PRAXIS safety model with real workers. Production hardening (installer, CLI, ACCP artifacts, visual polish) is P6.

---

## 20. Rejected Decisions

This section lists all explicitly rejected alternatives. Future agents must not reintroduce these without a formal ADR.

| Decision | Rejected Because |
|----------|-----------------|
| **CLI-only MVP** | D-015. A CLI-only MVP lacks the observability and control surface needed for safe autonomous execution supervision. Desktop Mission Control is mandatory. |
| **Full `pi/` migration** | D-051. Would import old coupling, wrong architecture, and unneeded packages. Only selective port is permitted. |
| **Copying old `pi/packages/coding-agent`** | D-049. Overfit to old project. PRAXIS adapters are a rewrite from scratch. |
| **Copying old `pi/packages/web-ui`** | D-014. D-049. Overfit to old project. Desktop Mission Control is from scratch. |
| **Copying old `pi/packages/agent`, `brain`, `ai`, `db`, `web-server`, `tui`, `worker-adapters`, `execution-service`** | D-049. Too coupled or irrelevant to PRAXIS. |
| **Worker self-report as completion** | D-028. Violates Law 1. Only Truth Engine FinalGate PASS is completion. |
| **UI-owned completion** | D-029. Interface must not decide completion. UI renders verdicts, does not create them. |
| **Adapter-owned truth** | D-030. Adapters normalize output, not evaluate it. |
| **ACCP compiler replacing Truth Engine** | D-040. The ACCP compiler produces compiled plans and artifacts. The Truth Engine evaluates attempt completion. Separate concerns. |
| **WebSocket in MVP** | D-025. HTTP commands/queries + SSE is sufficient for MVP. WebSocket would add complexity without clear MVP benefit. |
| **Root `src/` directory** | D-018. Top-level directories are domain boundaries, not a flat src/. |
| **Agent-generated acceptance criteria** | D-035. D-024. Violates Law 3. Agents cannot define their own completion criteria. |
| **Unbounded concurrency** | D-087 (implied by stable_16 ceiling). Governor controls concurrency with defined tiers and ceiling. |
| **More than required ACCP artifact scope in MVP** | D-043. Only implement ACCP types that MVP evidence practices require. |
| **Circuit Breaker delayed to production hardening** | D-090. Circuit Breaker is P3 (kernel safety core), not P6. |
| **Old runtime controller code as kernel** | D-050. Old runtime coupled to DB/Kysely. PRAXIS kernel is a clean rewrite. |

---

## 21. Open Decisions

These decisions require a spike, mockup, implementation proof, or further discovery before locking.

| ID | Decision | What's Needed |
|----|----------|---------------|
| O-001 | Claude Code hook reliability | Day 0 Spike must verify hook behavior under real conditions. Can hooks reliably capture every tool call? What events are missed? |
| O-002 | Claude Code rate limit ceiling | Day 0 Spike must determine the practical rate limit ceiling for Claude Code in autonomous mode. What happens at the limit? |
| O-003 | Exact desktop UX layout | P1 mockup will explore layout options. Final layout is determined by usability testing with mock data. |
| O-004 | Exact RuntimeEvent payloads | Event shapes will be refined during P0.2 contracts port and P2 mock runtime. Locked after P2 tests pass. |
| O-005 | Exact RuntimeSnapshot shape | Snapshot shape will be refined during P1 runtime contracts and P2 mock runtime. |
| O-006 | Exact DB schema | Schema will be designed during P2/P3 when storage requirements are concrete. Currently SOFT_LOCK until implementation. |
| O-007 | Packaging/installer approach | How is PRAXIS installed and launched on target OS? Spike needed in P6. Options: Homebrew, npm, standalone binary, etc. |
| O-008 | PostgreSQL distribution/setup mechanism | How is PostgreSQL provided/configured? Built-in? External dependency? Docker? Spike needed. |
| O-009 | Full TestOutputParser runner coverage | TestOutputParser scope and format support determined during P3 implementation. |
| O-010 | Long-run stability metrics | Stability baseline requires running PRAXIS continuously and measuring behavior. Collected during P6. |

---

## 22. Change Policy

This section defines how decisions in this file can be changed.

| Status | Change Process |
|--------|----------------|
| **HARD_LOCK** | Requires a formal ADR (`docs/adr/ADR-NNN-title.md`) or explicit human approval. The ADR must state the original decision, rationale for change, and implications. After ADR approval, update this file. |
| **SOFT_LOCK** | Can evolve during implementation. Update this file and any relevant pipeline/contract docs when a SOFT_LOCK decision changes. No ADR required unless the change touches a HARD_LOCK boundary. |
| **OPEN** | Becomes SOFT_LOCK or HARD_LOCK after the spike, mockup, or proof is complete. Update this file with the new status, rationale, and implications. |
| **REJECTED** | Cannot be reintroduced without a formal ADR. An ADR proposing a previously rejected decision must explain what has changed since the original rejection. |

**General rules:**
- All implementation prompts must respect the decisions in this file.
- If documents conflict, `docs/decisions.md` wins until an ADR index (`docs/adr/README.md`) is created.
- After the ADR index exists, the ADR index resolves conflicts between `docs/decisions.md` and ADR files.
- Adding new decisions requires updating this file with a new D-NNN ID.
- Removing decisions requires an ADR.

---

## 23. Current Next Actions

The following actions are the immediate next steps after this document is complete:

1. **Create ADR index** (`docs/adr/README.md`) — list all ADRs with status, topic, date.
2. **Create phase map** (`docs/phase-map.md`) — map P-1 through P6 with gates, dependencies, and parallelization rules.
3. **Create product scope doc** (`docs/product-scope.md`) — define MVP-A/B/C, out-of-scope, future considerations.
4. **Create pipeline overview** (`docs/pipelines/overview.md`) — describe the end-to-end execution pipeline.
5. **Create TaskRun lifecycle pipeline** (`docs/pipelines/taskrun-lifecycle.md`) — states, transitions, events, gate positions.
6. **Create runtime-server-kernel boundary doc** (`docs/boundaries/runtime-server-kernel.md`) — define the wiring contract between server and kernel.
7. **Then write contract docs and P0 implementation prompts** — accelerate P0.1 (scaffold), P0.2 (contracts), P0.3 (accp-compiler), P0.4 (FSM reference).

These actions are ordered by dependency: documents that inform subsequent documents come first.

**ADR numbering note:** `ai_summary.md` lists ADRs 001–005 and `architecture.md` lists ADR-001 through ADR-010 with different topics under the same numbers. Neither set has corresponding files in `docs/adr/`. The ADR index (action 1 above) must normalize numbering across all three files. Until then, `ai_summary.md` ADR numbers are the most recent and should be treated as the tentative canonical set.
