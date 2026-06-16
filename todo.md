# PRAXIS Implementation Todo List

**Version:** 0.2  
**Updated:** 2026-06-17  
**Purpose:** Track PRAXIS design lock status, selective pi/ reuse port, implementation phases, gates, and completion percentage.

---

## Current Decision Summary

The project is **not** a full migration from the old `pi/` repository.

The selected strategy is:

```txt
PORT_AND_ADAPT:
  - pi/packages/execution-contracts -> lib/contracts
  - pi/packages/accp-compiler       -> kernel/accp

REFERENCE_ONLY:
  - pi/packages/execution-runtime FSM/completion/state-authority patterns

REWRITE_FROM_SCRATCH:
  - kernel/core
  - kernel/evidence
  - kernel/truth-engine
  - kernel/circuit-breaker
  - adapters/*
  - hooks/*
  - server/*
  - interface/*
  - storage
```

Recommended name for the new first implementation phase:

```txt
P0 — Selective pi/ Reuse Foundation Port
```

Do **not** call it “migration from old repo,” because that may cause agents to copy old architecture.

---

## Progress Summary

| Area | Progress | Status |
|---|---:|---|
| Architecture baseline | 80% | Good enough for selective lock, but needs Circuit Breaker section applied. |
| pi/ reuse audit | 100% | Completed. Verdict: PORT_AND_ADAPT. |
| Reuse policy lock | 0% | Needs ADR. |
| Design lock matrix | 0% | Needs hard/soft/open lock classification. |
| Contract baseline | 0% | Needs port from `execution-contracts`. |
| ACCP compiler baseline | 0% | Needs port from `accp-compiler`. |
| Monorepo scaffold/CI | 0% | Not implemented. |
| Desktop mockup | 0% | Not implemented. |
| Runtime vertical slice | 0% | Not implemented. |
| Kernel safety core | 0% | Not implemented. |
| Real worker integration | 0% | Not implemented. |
| Parallel execution + assembler | 0% | Not implemented. |
| Production hardening | 0% | Not implemented. |

**Overall implementation progress:** `0%`  
**Overall planning / architecture progress:** `~25%`

---

## Professional Process Model

Professional software teams usually do this in stages:

```txt
1. Discovery / audit
2. Architecture decision records
3. Lock matrix
4. Contract/API baseline
5. Implementation plan
6. Small parallel work batches
7. Integration gates
8. Stabilization
```

For PRAXIS, the correct order is:

```txt
P-1: Lock decisions and reuse policy
P0:  Port reusable foundations
P1:  Product/UI discovery and runtime contracts
P2:  Mock runtime vertical slice
P3:  Kernel safety core
P4:  Real Claude Code hook + adapter
P5:  Parallel execution + assembler
P6:  ACCP artifacts + production hardening
```


---

## Lock Levels

Use three lock levels instead of one global lock.

### HARD LOCK

Changing these requires an ADR.

- [x] PRAXIS is a local-first execution platform.
- [x] Agent says done does not mean done.
- [x] Truth Engine FinalGate PASS is completion.
- [x] Workers do not write shared integration files.
- [x] Deterministic Assembler is the only shared writer.
- [x] FinalGate criteria must come from human-authored TaskSpec.
- [x] Top-level boundaries: `kernel`, `adapters`, `hooks`, `server`, `interface`, `lib`.
- [x] No root `src/`.
- [x] `lib/contracts` is shared foundation and must not contain business logic.
- [x] Adapters integrate external workers and do not decide completion.
- [x] Hooks capture external tool events and do not decide truth.
- [x] Interface displays kernel/runtime state and does not decide completion.
- [x] ACCP artifacts are async and do not block execution critical path.
- [ ] Circuit Breaker is kernel-owned and implemented as first-class architecture.

### SOFT LOCK

Default decision, but can evolve during implementation.

- [ ] Exact package names.
- [ ] RuntimeSnapshot fields.
- [ ] RuntimeEvent payloads.
- [ ] Exact database schema.
- [ ] Exact desktop component hierarchy.
- [ ] Exact TaskRun FSM state names.
- [ ] Exact RIM prompt strategy formatting.
- [ ] Exact TestOutputParser runner coverage.
- [ ] Exact installer/packaging method.

### OPEN

Needs discovery, spike, mockup, or implementation proof.

- [ ] Claude Code hook reliability.
- [ ] Claude Code rate-limit ceiling.
- [ ] Desktop Mission Control UX.
- [ ] Runtime API details.
- [ ] Event replay implementation.
- [ ] Storage recovery behavior.
- [ ] Production installer.
- [ ] Long-run stability metrics.


---

## P-1 — Architecture / Reuse Decision Lock

Goal: freeze the decisions that prevent agents from copying old architecture into PRAXIS.

Tasks:

- [x] Complete pi/ reuse readiness audit.
- [ ] Add `docs/adr/ADR-000-pi-reuse-policy.md`.
- [ ] Add `docs/architecture-lock-matrix.md`.
- [ ] Add `docs/reference/pi-reuse-readiness-summary.md`.
- [ ] Apply Circuit Breaker Architecture section to Architecture README.
- [ ] Mark old `pi/` components with explicit reuse classes.
- [ ] Add forbidden-copy list for old packages.
- [ ] Add implementation rule: “P0 is selective port, not migration.”
- [ ] Update all future ACCP prompts to include reuse policy constraints.

Acceptance criteria:

- [ ] Reuse policy ADR exists.
- [ ] Lock matrix exists.
- [ ] Architecture README contains Circuit Breaker as kernel-owned module.
- [ ] Reports clearly say which old components are PORT, REFERENCE, DISCARD.
- [ ] No future plan says “migrate old repo” without qualifying “selective port.”

**P-1 progress:** `11%`


---

## P0 — Selective pi/ Reuse Foundation Port

Goal: port only proven reusable foundations from `pi/`.

### P0.1 — Monorepo Scaffold + CI

Tasks:

- [ ] Create Bun workspace.
- [ ] Create root `package.json`.
- [ ] Create `tsconfig.base.json`.
- [ ] Create package skeletons.
- [ ] Create `lib/contracts/package.json`.
- [ ] Create `kernel/accp/package.json`.
- [ ] Add `bun run typecheck`.
- [ ] Add `bun test`.
- [ ] Add lint/format check.
- [ ] Add dependency boundary checker.
- [ ] Add `make test`.
- [ ] Add `make test-full`.
- [ ] Add CI workflow.
- [ ] Verify clean checkout install.

Acceptance criteria:

- [ ] No root `src/`.
- [ ] `bun install` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.
- [ ] Boundary checker catches forbidden imports.
- [ ] Empty package exports are valid.

**P0.1 progress:** `0%`

### P0.2 — Port `execution-contracts` to `lib/contracts`

Source:

```txt
pi/packages/execution-contracts/
```

Target:

```txt
lib/contracts/
```

Tasks:

- [ ] Port ACCP type definitions.
- [ ] Port WorkerAdapter interface.
- [ ] Port runtime event types where useful.
- [ ] Port transcript/log/event-store types where useful.
- [ ] Adapt command types to PRAXIS naming.
- [ ] Remove old-project-specific types.
- [ ] Remove `@earendil-works/*` namespace.
- [ ] Add `@praxis/contracts` package exports.
- [ ] Port/adapt tests.
- [ ] Add PRAXIS law audit comments or docs.
- [ ] Ensure package has no business logic.
- [ ] Ensure package has no dependency on kernel/server/interface/adapters/hooks.

Acceptance criteria:

- [ ] `@praxis/contracts` exists.
- [ ] No `@earendil-works` namespace remains.
- [ ] Ported contract tests pass.
- [ ] WorkerAdapter does not decide completion.
- [ ] No DB/runtime/controller assumptions leak into contracts.
- [ ] Contracts can be imported by kernel/server/interface/adapters/hooks.

**P0.2 progress:** `0%`

### P0.3 — Port `accp-compiler` to `kernel/accp`

Source:

```txt
pi/packages/accp-compiler/
```

Target:

```txt
kernel/accp/
```

Tasks:

- [ ] Port compiler pipeline.
- [ ] Port YAML parser.
- [ ] Port extractor.
- [ ] Port schema validator.
- [ ] Port evidence validator.
- [ ] Port gate evaluator as ACCP primitive.
- [ ] Port route signal compiler if still needed.
- [ ] Port artifact writer if still needed.
- [ ] Replace old contract imports with `@praxis/contracts`.
- [ ] Remove old namespace.
- [ ] Port/adapt 135 tests.
- [ ] Ensure deterministic output remains stable.
- [ ] Ensure ACCP layer remains async/non-blocking relative to execution.

Acceptance criteria:

- [ ] `kernel/accp` package exists.
- [ ] No import from `pi/` remains.
- [ ] No `@earendil-works` namespace remains.
- [ ] Compiler tests pass.
- [ ] Evidence validator still detects false positives.
- [ ] ACCP gate evaluator is not treated as PRAXIS Truth Engine.

**P0.3 progress:** `0%`

### P0.4 — Extract old FSM reference doc

Source:

```txt
pi/packages/execution-runtime/src/attempt-fsm.ts
pi/packages/execution-runtime/src/completion-predicate.ts
pi/packages/execution-runtime/src/state-authority.ts
pi/packages/execution-runtime/src/deadline-watchdog.ts
```

Target:

```txt
docs/reference/old-pi-fsm-patterns.md
```

Tasks:

- [ ] Document old FSM states.
- [ ] Document legal transitions.
- [ ] Document deadline policies.
- [ ] Document completion predicate lessons.
- [ ] Document state-authority token pattern.
- [ ] Document why old runtime is reference-only.
- [ ] Document DB/Kysely coupling.
- [ ] Document PRAXIS-specific rewrite recommendations.

Acceptance criteria:

- [ ] Reference doc exists.
- [ ] It clearly says old runtime must not be ported directly.
- [ ] It identifies useful ideas for PRAXIS kernel/core.
- [ ] It identifies coupling risks.

**P0.4 progress:** `0%`

### P0 Gate — Reuse Foundation Gate

Do not start real runtime/kernel implementation until this passes.

- [ ] `bun install` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.
- [ ] `@praxis/contracts` exports stable.
- [ ] `kernel/accp` tests pass.
- [ ] No `@earendil-works` namespace remains in ported packages.
- [ ] No runtime import from `pi/`.
- [ ] No old runtime/server/agent/db/web-ui package copied.
- [ ] Reuse policy ADR exists.
- [ ] Old FSM reference doc exists.
- [ ] Boundary checker passes.

**P0 Gate progress:** `0%`


---

## P1 — Desktop Mission Control + Runtime Contracts

Goal: define operator experience and runtime view model.

Tasks:

- [ ] Define `RuntimeSnapshot` contract.
- [ ] Define `RuntimeEvent` contract.
- [ ] Define `TaskRunView`.
- [ ] Define `WorkerView`.
- [ ] Define `GateVerdictView`.
- [ ] Define `CircuitBreakerView`.
- [ ] Define `GovernorView`.
- [ ] Define `HumanActionView`.
- [ ] Create `docs/specs/desktop-mission-control.md`.
- [ ] Create interactive desktop mockup with fake runtime data.
- [ ] Add Mission Control dashboard.
- [ ] Add Plan List view.
- [ ] Add TaskRun Detail view.
- [ ] Add Worker Grid.
- [ ] Add Evidence / Logs panel.
- [ ] Add Human Action Queue.
- [ ] Add Circuit Breaker panel.
- [ ] Ensure UI does not decide completion.

Acceptance criteria:

- [ ] Mockup opens locally.
- [ ] Mockup uses typed mock data.
- [ ] UI displays state only.
- [ ] Snapshot/event contracts are documented.
- [ ] No backend dependency required.

**P1 progress:** `0%`

---

## P2 — Mock Runtime Vertical Slice

Goal: prove UI + runtime event model before real worker integration.

Tasks:

- [ ] Implement `server/event-bus`.
- [ ] Implement `server/control-plane` minimal HTTP app.
- [ ] Implement `GET /api/snapshot`.
- [ ] Implement `GET /api/events?after=<seq>`.
- [ ] Implement in-memory runtime event log.
- [ ] Implement `interface/client`.
- [ ] Connect desktop to snapshot endpoint.
- [ ] Connect desktop to SSE stream.
- [ ] Implement `adapters/mock-worker`.
- [ ] Simulate successful task.
- [ ] Simulate empty diff / false done.
- [ ] Simulate failing test.
- [ ] Simulate namespace violation.
- [ ] Simulate worker crash.
- [ ] Simulate rate limit.
- [ ] Show all simulated states in UI.

Acceptance criteria:

- [ ] Desktop receives initial snapshot.
- [ ] Desktop applies SSE events in sequence.
- [ ] Sequence gap triggers snapshot refresh.
- [ ] Mock worker events are visible.
- [ ] Gate verdict events are visible.
- [ ] Circuit Breaker state appears in dashboard.
- [ ] No real Claude Code dependency exists.

**P2 progress:** `0%`

---

## P3 — Kernel Safety Core

Goal: prove PRAXIS safety model with mock evidence.

Tasks:

- [ ] Implement `kernel/core` TaskRun FSM from scratch.
- [ ] Implement `kernel/psag` minimal admission gate.
- [ ] Implement `kernel/evidence` minimal evidence model.
- [ ] Implement `kernel/truth-engine`.
- [ ] Implement EvidenceGate.
- [ ] Implement ExecGate.
- [ ] Implement FinalGate.
- [ ] Implement TestOutputParser minimal parser.
- [ ] Implement EHC record shape.
- [ ] Implement EHC hash chain.
- [ ] Implement EHCBreakClassifier.
- [ ] Implement `kernel/circuit-breaker`.
- [ ] Implement failure-rate open trigger.
- [ ] Implement governor-red open trigger.
- [ ] Implement EHC CONFIRMED open trigger.
- [ ] Add false-done tests.
- [ ] Add namespace violation tests.
- [ ] Add empty diff tests.
- [ ] Add zero-test-ran tests.

Acceptance criteria:

- [ ] Agent claim without diff does not complete.
- [ ] Agent-generated checklist is rejected.
- [ ] Missing human acceptance criteria is rejected.
- [ ] Empty test suite does not pass ExecGate.
- [ ] Namespace violation fails.
- [ ] Confirmed evidence integrity failure opens Circuit Breaker.
- [ ] Circuit Breaker OPEN rejects new admissions.
- [ ] HALF_OPEN permits exactly one probe.

**P3 progress:** `0%`


---

## P4 — Real Worker Integration

Goal: integrate Claude Code only after mock runtime and kernel safety core work.

Tasks:

- [ ] Complete Day 0 Claude Code spike.
- [ ] Verify headless mode.
- [ ] Verify PreToolUse hook.
- [ ] Verify PostToolUse hook.
- [ ] Verify Stop hook.
- [ ] Measure rate-limit ceiling.
- [ ] Decide GO/NO-GO.
- [ ] Implement `hooks/praxis-hook`.
- [ ] Implement hook event parser.
- [ ] Implement hook event normalizer.
- [ ] Implement local spool fallback.
- [ ] Implement `adapters/claude-code`.
- [ ] Implement Claude command builder.
- [ ] Implement Claude settings writer.
- [ ] Implement Claude hook installer.
- [ ] Implement Claude env builder.
- [ ] Implement Claude session runner.
- [ ] Implement Claude output normalizer.
- [ ] Implement rate limit detector.
- [ ] Produce KernelOwnedTranscript.
- [ ] Emit divergence event when mismatch exists.

Acceptance criteria:

- [ ] One real Claude Code attempt runs in isolated workspace.
- [ ] Hook events reach runtime.
- [ ] KernelOwnedTranscript is captured.
- [ ] Real command output is evaluated by ExecGate.
- [ ] Empty diff false-done is caught.
- [ ] Rate limit symptom is detected.
- [ ] Worker crash is normalized.
- [ ] Adapter does not perform Truth Engine decisions.

**P4 progress:** `0%`

---

## P5 — Parallel Execution + Assembler

Goal: safely run multiple workers and integrate only verified outputs.

Tasks:

- [ ] Implement workspace manager.
- [ ] Implement namespace locks.
- [ ] Implement plan queue.
- [ ] Implement wave scheduler.
- [ ] Implement dependency graph.
- [ ] Implement `kernel/governor`.
- [ ] Implement stable_3 concurrency tier.
- [ ] Implement demotion rules.
- [ ] Implement clean operation window metrics.
- [ ] Implement `kernel/assembler`.
- [ ] Implement namespace recheck.
- [ ] Implement basic semantic signature extraction.
- [ ] Implement callsite scanner.
- [ ] Implement mismatch detector.
- [ ] Implement atomic patch apply.
- [ ] Implement rollback.
- [ ] Implement ConflictReport.
- [ ] Inject ConflictReport into RepairPacket.
- [ ] Run 3 mock workers concurrently.
- [ ] Run 3 real workers only after mock proof passes.

Acceptance criteria:

- [ ] 3 workers run in isolated workspaces.
- [ ] Namespace collision is rejected before execution.
- [ ] Shared integration writes are assembler-only.
- [ ] Assembler rollback restores previous state.
- [ ] ConflictReport is produced on assembly failure.
- [ ] Governor demotes on instability.
- [ ] Circuit Breaker opens on cascade failure.
- [ ] Average parallelism can be measured.

**P5 progress:** `0%`

---

## P6 — ACCP Artifacts + Production Hardening

Goal: produce audit artifacts and stabilize product.

Tasks:

- [ ] Implement ACCP async job queue.
- [ ] Implement FVR builder.
- [ ] Implement FVR schema.
- [ ] Implement PRR builder.
- [ ] Implement PRR schema.
- [ ] Emit FVR per TaskRun.
- [ ] Emit PRR per wave.
- [ ] Store artifact metadata.
- [ ] Show artifacts in desktop UI.
- [ ] Add PostgreSQL migrations.
- [ ] Add durable runtime event replay.
- [ ] Add runtime restart recovery.
- [ ] Add worker cleanup on crash.
- [ ] Add hook spool replay.
- [ ] Add desktop production shell.
- [ ] Add CLI commands.
- [ ] Add installer / packaging.
- [ ] Add security token lifecycle.
- [ ] Enforce localhost-only binding.
- [ ] Add Playwright e2e.
- [ ] Add long-run stability test.
- [ ] Add performance baseline.
- [ ] Clean documentation.

Acceptance criteria:

- [ ] ACCP does not block execution critical path.
- [ ] FVR and PRR are generated asynchronously.
- [ ] Runtime recovers after restart.
- [ ] Desktop works in production build.
- [ ] Full e2e suite passes.
- [ ] Long-run stability baseline exists.

**P6 progress:** `0%`


---

## Parallelization Rules

### Safe to run in parallel after P-1

```txt
A: P0.1 Monorepo Scaffold + CI
B: P0.2 Contracts Port
C: P0.4 FSM Reference Doc
D: Day 0 Claude Spike
```

### Partially parallel

```txt
P0.3 ACCP Compiler Port
  Can start after contracts target shape is known.
  Must merge after P0.2.
```

### Do not run yet

```txt
server/runtime
kernel/core full implementation
kernel/truth-engine full implementation
kernel/assembler
real Claude adapter
desktop real runtime connection
```

---

## Merge Order

Even if work is parallel, merge in this order:

1. [ ] P-1 lock docs
2. [ ] P0.1 Scaffold + CI
3. [ ] P0.2 Contracts port
4. [ ] P0.3 ACCP compiler port
5. [ ] P0.4 FSM reference doc
6. [ ] P0 Gate
7. [ ] P1 Desktop mockup + runtime contracts
8. [ ] P2 Mock runtime vertical slice
9. [ ] P3 Kernel safety core
10. [ ] P4 Real worker integration
11. [ ] P5 Parallel execution + assembler
12. [ ] P6 Production hardening

---

## Forbidden Copy List

These must not be copied into PRAXIS implementation:

- [ ] `pi/packages/coding-agent`
- [ ] `pi/packages/agent`
- [ ] `pi/packages/brain`
- [ ] `pi/packages/ai`
- [ ] `pi/packages/db`
- [ ] `pi/packages/web-server`
- [ ] `pi/packages/web-ui`
- [ ] `pi/packages/tui`
- [ ] `pi/packages/worker-adapters`
- [ ] `pi/packages/execution-service`
- [ ] Old runtime controller code coupled to DB/Kysely

These can be referenced but not ported directly:

- [ ] `pi/packages/execution-runtime/src/attempt-fsm.ts`
- [ ] `pi/packages/execution-runtime/src/completion-predicate.ts`
- [ ] `pi/packages/execution-runtime/src/state-authority.ts`
- [ ] `pi/packages/execution-runtime/src/deadline-watchdog.ts`

These can be ported with adaptation:

- [ ] `pi/packages/execution-contracts`
- [ ] `pi/packages/accp-compiler`

---

## Current Next Actions

Recommended next documents/prompts:

1. [ ] `ACCP-PRAXIS-P-1-REUSE-POLICY-LOCK`
2. [ ] `ACCP-PRAXIS-MONOREPO-SCAFFOLD-CI`
3. [ ] `ACCP-PRAXIS-PORT-EXECUTION-CONTRACTS`
4. [ ] `ACCP-PRAXIS-PORT-ACCP-COMPILER`
5. [ ] `ACCP-PRAXIS-OLD-FSM-REFERENCE-DOC`

Recommended immediate decision:

```txt
Do P-1 before implementation plans.
Then write P0 implementation prompts.
Do not write P2/P3/P4 prompts yet except as high-level roadmap.
```

---

## Progress Formula

```txt
Phase progress = completed tasks / total tasks * 100

Overall implementation progress =
  average of:
    P0 foundation port
    P1 desktop/contracts
    P2 mock runtime
    P3 kernel safety
    P4 real worker
    P5 parallel execution
    P6 production hardening
```

Planning progress is tracked separately and should not be counted as implementation progress.

---

## Notes

- PRAXIS is not a migration of `pi/`.
- The old repo is a source of selected reusable foundations and design references.
- Contract-first development remains mandatory.
- UI must display kernel/runtime state, not invent completion.
- Workers must stay inside assigned namespaces.
- Shared integration writes must be assembler-only.
- Truth Engine is attempt-level authority.
- Circuit Breaker is system-level safety authority.
- Governor is concurrency/resource authority.
- ACCP artifacts must be async and non-blocking.
