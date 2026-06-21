# Executive Summary — PRAXIS Remaining MVP Architecture Design Pack

## Verdict

**The remaining PRAXIS MVP architecture is design-complete.** This pack provides full specifications for EvidenceGate, EvidenceLedger, WiringGate, ExecGate, FinalGate, RepairPacket, report model, CLI workflow, plugin bridge, and the P3→P6 implementation roadmap. Implementation may proceed with P3 (EvidenceGate) on the next cycle.

## Current State

### Locked and Implemented (Do Not Redesign)

| Phase | Status | What |
|-------|--------|------|
| D3 | **PASS_LOCKED** 9.2/10 | PlanSpec v0.1 canonical schema — 28 `$defs`, 27 `$refs`, 5 examples, 10 fixtures, validation script |
| P1 | **PASS_LOCKED** 31/31 tests | `@praxis/contracts` — PlanSpec parser, validator, semantic validator, canonicalizer, hasher, fixture runner |
| P2 | **PASS_LOCKED** 28/28 tests | `@praxis/kernel` — SchemaGate (+ LockGate only, 18/18 ACs |

### To Be Designed (This Pack)

| Phase | Component | Status |
|-------|-----------|--------|
| P3 | EvidenceGate + EvidenceLedger | **Designed in this pack** |
| P4 | WiringGate v0.1-lite | **Designed in this pack** |
| P5 | ExecGate v0.1 | **Designed in this pack** |
| P6 | FinalGate + RepairPacket + Reports + CLI + Plugin | **Designed in this pack** |

## Remaining Architecture at a Glance

```
PlanSpec YAML
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  P2 Kernel: SchemaGate → LockGate ← already implemented │
└──────────────────────────────────────────────────────────┘
    │ PASS
    ▼
┌──────────────────────────────────────────────────────────────┐
│  P3: EvidenceGate                                             │
│  • Read evidence ledger (.praxis/runs/<id>/evidence.jsonl)    │
│  • Verify namespace compliance (files changed within bounds)  │
│  • Verify diff non-empty for code tasks                       │
│  • Detect forbidden file mutations                            │
│  • PASS/HOLD/FAIL with reason codes                           │
└──────────────────────────────────────────────────────────────┘
    │ PASS
    ▼
┌──────────────────────────────────────────────────────────────┐
│  P4: WiringGate (v0.1-lite)                                   │
│  • Match declaredUnits against filesystem                     │
│  • Verify exportSurface requiredExports exist                 │
│  • Check entrypoint reachability (path-only, no AST)          │
│  • Detect orphan modules (unregistered files)                 │
│  • Defer import graph / AST analysis to v0.2+                 │
└──────────────────────────────────────────────────────────────┘
    │ PASS
    ▼
┌──────────────────────────────────────────────────────────────┐
│  P5: ExecGate                                                  │
│  • Run exactAllowedCommands only                               │
│  • Capture stdout/stderr/exitcode/timeout as evidence          │
│  • Enforce hardDeniedCommands (prevent forbidden commands)     │
│  • Validate watch mode is blocked, noTestsFoundIsFailure       │
│  • Timeout enforcement with SIGTERM/SIGKILL                    │
│  • Command spoofing prevention via hash/signature              │
└──────────────────────────────────────────────────────────────┘
    │ PASS
    ▼
┌──────────────────────────────────────────────────────────────┐
│  P6: FinalGate + Repair + Reports + CLI + Plugin              │
│  • FinalGate: aggregate ALL deterministic evidence against ACs│
│  • RepairPacket: JSON-format structured failure analysis       │
│  • ACCP reports: YAML + summary.md dual format                │
│  • CLI: orchestrate gates, manage plans, run verification      │
│  • Plugin: slash commands, read-only display, no truth         │
└──────────────────────────────────────────────────────────────┘
    │ PASS → Done. FAIL/HOLD → Repair.
```

## Top 10 Design Decisions

### 1. EvidenceLedger is JSONL, not YAML

**Decision:** The evidence ledger format is JSONL (newline-delimited JSON).  
**Rationale:** Evidence capture is fundamentally append-only streaming. YAML's complexity (anchors, multi-line, indentation) adds no value for records that are never hand-edited. JSONL gives: deterministic append, trivial line-based tailing, standard JSON parsing for each record, and native streaming support in Node.js (`fs.createReadStream` line-by-line).  
**Trade-off:** Not human-readable in editor without formatting. Mitigated by `praxis ledger inspect` CLI command.

### 2. EvidenceGate Checks Namespace, Not Correctness

**Decision:** EvidenceGate verifies boundary integrity — did files change within allowed namespace, is diff non-empty for code tasks, are forbidden files untouched.  
**Rationale:** EvidenceGate is the first gate after execution. Its job is to confirm that *evidence exists and is trustworthy*, not that the work is correct. Correctness belongs to FinalGate. This separation prevents gate overlap and keeps each gate's failure modes simple.  
**Trade-off:** A task could pass EvidenceGate but fail FinalGate. This is correct behavior — each gate has one job.

### 3. WiringGate v0.1 is "Static File Matching" Only

**Decision:** WiringGate v0.1 matches declaredUnits against filesystem paths and exports, but does NOT do AST-level import graph analysis or full reachability tracing.  
**Rationale:** AST/import-graph analysis requires heavy dependencies (TypeScript compiler, language parsers). For v0.1, static file-exists and export-surface checks catch 80%+ of wiring failures. Full import graph analysis is explicitly deferred to v0.2+.  
**Trade-off:** Some wiring issues (transitive dependency breaks, circular imports) will not be caught in v0.1. Documented as known gap.

### 4. ExecGate Uses ExactAllowedCommands Only

**Decision:** ExecGate only runs commands explicitly listed in `plan.commands.exactAllowedCommands`. No arbitrary shell execution.  
**Rationale:** This is the core of command safety. Every command must be pre-declared with its timeout, expected exit codes, network policy, shell policy, and evidence requirements. Any command not in this list is rejected before execution.  
**Trade-off:** Plan authors must pre-declare all commands, increasing plan verbosity. Mitigated by command templates and reusable command blocks.

### 5. FinalGate Rejects Advisory-Only Evidence for PASS

**Decision:** Acceptance criteria with `verification.advisoryOnly: true` or `verification.type: llm_advisory` or `verification.type: manual_review` CANNOT satisfy FinalGate PASS. They can produce HOLD or be informational, but PASS requires at least one deterministic evidence source.  
**Rationale:** Prevents false PASS from subjective judgments. If all criteria pass but only through advisory evidence, the verdict is HOLD — the plan must include deterministic verification.  
**Trade-off:** Some criteria (UX quality, code style) cannot be deterministically verified. These must either be accepted as HOLD-able or have their criteria marked `level: optional`.

### 6. RepairPacket is Pure JSON

**Decision:** RepairPacket is generated as JSON only — no dual JSON+markdown output.  
**Rationale:** RepairPacket is consumed by machines (the kernel feeds it to the next attempt), not read by humans directly. JSON is programmatically cleaner: no parsing ambiguity, no format skew between JSON and markdown versions. For human visibility, the `praxis repair show` command formats it.  
**Trade-off:** Raw JSON is not as readable as markdown. Mitigated by CLI display formatting.

### 7. ACCP Reports are Dual YAML+Summary

**Decision:** Each ACCP report has two files: a `.accp.yaml` (machine-readable structured report) and a `.summary.md` (human-readable markdown summary).  
**Rationale:** YAML is ideal for programmatic processing (CI checks, trend analysis, dashboard ingestion). Markdown summaries are ideal for commit messages, PR comments, and human reviews. Both are generated from the same data.  
**Trade-off:** Maintaining two files adds slight generation overhead. Mitigated by generating both from a single report template.

### 8. CLI is a Thin Pass-Through

**Decision:** The `praxis` CLI is a thin orchestrator — it parses flags, reads files, calls kernel library functions, and prints results. It contains NO gate logic.  
**Rationale:** This prevents CLI-specific bugs from producing false PASS. All gate logic lives in `@praxis/kernel` where it is independently testable. The CLI is a view layer.  
**Trade-off:** CLI has an extra dependency on the kernel package. Acceptable — this is the intended architecture.

### 9. Plugin Bridge is Read-Only Display + Dispatch

**Decision:** The Claude Code plugin bridge has two modes: (a) read-only display of gate results and plan status, and (b) slash command dispatch (`/praxis verify`, `/praxis status`, etc.) that delegates to the CLI.  
**Rationale:** LAW 3: FinalGate acceptance criteria come from human-authored TaskSpec. An agent cannot define or verify its own completion criteria. The plugin must never decide truth, never modify criteria, and never override a gate verdict.  
**Trade-off:** The plugin cannot do inline verification during agent runs. This limits automation but upholds the Three Laws.

### 10. Implementation Proceeds in 4 Phases (P3-P6)

**Decision:** Work is split into P3 (EvidenceGate), P4 (WiringGate), P5 (ExecGate), P6 (FinalGate + Repair + Reports + CLI + Plugin).  
**Rationale:** Each phase has well-bounded scope with explicit acceptance criteria and independent testability. P3 and P5 are the high-risk phases (new concepts); P4 and P6 are more mechanical. Split allows each phase to be designed, implemented, and locked independently.  
**Trade-off:** More phase boundaries means more coordination effort. Mitigated by this shared design pack providing the full picture.

## Repository Trace

This design pack was created against **commit cd0acea** (`feat: implement @praxis/kernel P2 SchemaGate and LockGate`).

**Verified:**
- `schemas/planspec.v0.1.schema.yaml` — 1100 lines, 28 `$defs`, locked
- `packages/contracts/` — 13 source files, 31/31 tests PASS, locked
- `packages/kernel/` — 15 source files, 28/28 tests PASS, SchemaGate+LockGate implemented
- `examples/planspec/` — 5 examples, all valid
- `fixtures/planspec/` — 10 fixtures (4 PASS + 2 HOLD + 4 FAIL)
- No `packages/cli/`, `packages/plugin/`, `apps/` — clean state

## Recommended Next Step

**Phase: P3 — EvidenceGate Implementation**

The next prompt should be `ACCP-PRAXIS-P3-KERNEL-EVIDENCEGATE` with:
1. Implement EvidenceLedger reader (JSONL line parser)
2. Implement EvidenceGate (namespace, diff, forbidden file checks)
3. Add reason codes to kernel diagnostics
4. Wire into runKernel pipeline
5. Create test fixtures for evidence scenarios
6. All ACs must pass before proceeding to P4

## Forbidden Mutation Check

**Result: CLEAN** — No existing source files in `packages/`, `schemas/`, `scripts/`, or `docs/` were modified during design. Only new files were created under `design/praxis-remaining-mvp-design-pack/` and `reports/accp/remaining-mvp-design-pack.accp.yaml`.
