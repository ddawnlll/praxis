# Pipeline Test Strategy

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the testing strategy across all PRAXIS phases (P0 through P6), specifying test categories, gate mappings, infrastructure, and evidence requirements for each pipeline stage.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document defines the testing strategy for the PRAXIS execution platform across all implementation phases. It specifies what must be tested, how test evidence is classified, which gates each test category supports, and what tooling is used. The strategy is organized by phase so that each phase's test requirements are legible before implementation begins.

---

## Scope

- Phase-by-phase test category breakdown (P0 through P6)
- Gate mapping: which acceptance criteria each test category feeds
- Test infrastructure and runner requirements
- Negative-test mandates (false-done, empty diff, zero tests ran, etc.)
- Evidence classification rules for test results
- Required test categories that must exist before phase exit gates

---

## Non-Goals

- Detailed test case lists (those belong in per-phase implementation plans)
- ACCP compiler test case enumeration (the 135 ported tests are owned by P0.3)
- Contract test enumeration (the 247 ported tests are owned by P0.2)
- Production monitoring or SLO definitions (P6 scope, not yet designed)
- e2e scenario scripts (those are implementation artifacts)

---

## Authoritative Decisions Used

| Decision ID | Decision | How It Applies |
|-------------|----------|----------------|
| D-103 | Every implementation phase must have gate criteria | This document defines what test categories satisfy each phase gate |
| D-104 | Agent claims are not completion evidence | No test category allows agent self-report as pass evidence |
| D-105 | False-done tests are mandatory | Every gate must include negative test cases; this document specifies which |
| D-106 | Empty diff must not complete | ExecGate tests must include empty-diff scenarios |
| D-107 | Zero tests ran must not pass ExecGate | TestOutputParser must detect zero-test-run scenarios in test suites |
| D-108 | Namespace violation must fail | Every phase with file access must test boundary enforcement |
| D-109 | Circuit Breaker transitions must be tested | P3 must include complete Circuit Breaker state and trigger tests |
| D-110 | P0 gate must pass before P2/P3/P4 implementation | This document defines what P0 gate tests look like |
| D-028 | Worker self-report is not completion | False-done tests must cover agent claim with no evidence |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | Truth Engine gate tests are the core of P3 testing |
| D-084 | Circuit Breaker is kernel-owned | Circuit Breaker tests live in kernel test suites, not server tests |
| D-098 | Contract-first development is mandatory | Contract type tests are the entry-point tests for every phase |

---

## Conceptual Model

### Evidence Classification for Tests

Every test result in PRAXIS must be classifiable as one of:

| Classification | Meaning | Example |
|----------------|---------|---------|
| **PASS_WITH_EVIDENCE** | Test passed and produced concrete, auditable output (diff, exit code, test report, event log) | `bun test` exits 0 with test report showing 247/247 passed |
| **FAIL_WITH_EVIDENCE** | Test failed with concrete output showing what broke | Contract type mismatch; ACCP compiler YAML parse error with file:line |
| **AGENT_CLAIM_ONLY** | Agent asserts pass but no concrete output exists | "Tests passed" in stdout with no test runner output attached |
| **NO_EVIDENCE** | No test output, no exit code, no diff, no event | Empty stdout, empty stderr, exit code 0 but no test runner was invoked |

**Rule:** Only PASS_WITH_EVIDENCE and FAIL_WITH_EVIDENCE are valid gate inputs. AGENT_CLAIM_ONLY and NO_EVIDENCE are treated as test failures regardless of exit code.

### Gate vs. Test Relationship

```
Test Categories  ────►  Evidence  ────►  Gate  ────►  Phase Exit
     │                                        │
     │  Contract type tests  ─────────►  P0 Gate
     │  Desktop mockup tests  ───────►  P1 Gate
     │  Mock runtime tests  ─────────►  P2 Gate
     │  Kernel safety tests  ────────►  P3 Gate
     │  Adapter/hook tests  ─────────►  P4 Gate
     │  Parallel/assembler tests  ───►  P5 Gate
     │  e2e / stability tests  ──────►  P6 Gate
```

---

## MUST / MUST NOT Rules

### MUST

- Every gate (EvidenceGate, ExecGate, FinalGate, PSAG, P0-P6 phase gates) MUST have negative test cases that exercise the failure path
- False-done test cases MUST include: empty diff, zero tests ran, agent claim with no evidence, namespace violation, missing acceptance criteria, generated (non-human) criteria rejection
- Circuit Breaker tests MUST cover all three states (CLOSED, OPEN, HALF_OPEN) and all triggers (failure_rate > 30%, governor_RED > 15min, EHC CONFIRMED)
- EHC break classification tests MUST distinguish NOISE, SUSPECTED, and CONFIRMED and verify that only CONFIRMED opens the Circuit Breaker
- Test output from `bun test` MUST be captured as evidence (not just exit code)
- Contract type tests MUST verify that contracts import cleanly from all allowed consumers (kernel, server, interface, adapters, hooks)
- Boundary checker tests MUST catch forbidden imports (kernel importing server, adapters importing interface, etc.)
- Desktop mockup tests MUST verify that UI renders mock data correctly and does NOT invent state independently
- Assembler tests MUST include atomic apply, rollback on conflict, and namespace recheck scenarios
- Parallel execution tests MUST include namespace isolation verification (worker A cannot write worker B's namespace)
- All ported tests (247 from execution-contracts, 135 from accp-compiler) MUST pass with Bun test runner before P0 exit

### MUST NOT

- MUST NOT treat agent self-report ("tests passed", "done", exit code 0 alone) as test pass evidence
- MUST NOT claim untested code is working
- MUST NOT allow a test suite with zero tests ran to pass any gate
- MUST NOT skip false-done tests for any phase
- MUST NOT allow agent-generated acceptance criteria in test fixtures (violates Law 3)
- MUST NOT write tests that assert on worker claims instead of concrete evidence
- MUST NOT allow Circuit Breaker tests to be deferred to P6 (must be in P3 per D-090)
- MUST NOT allow any test to import from forbidden packages (tests enforce the dependency direction rules)

---

## Test Categories Per Phase

### P0: Foundation Port Tests

**Test count target:** 382+ ported tests + new boundary/CI tests

#### P0.1 — Monorepo Scaffold + CI Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| `bun install` success | Workspaces resolve, all packages install without error | Exit code 0, no stderr errors |
| `bun run typecheck` success | TypeScript strict mode passes across all packages | tsc exit code 0 |
| `bun test` success (scaffold) | Placeholder tests pass; empty test suites are valid | Test runner output with test counts |
| No root `src/` exists | Top-level directory enforcement | File system check (boundary checker) |
| Boundary import checker | Forbidden imports caught at build time | Checker output listing violations (must be empty) |
| Empty package exports valid | Each package has valid entry point even if empty | Import test per package |

#### P0.2 — Contracts Port Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Ported contract type tests (247) | All 247 tests from `pi/packages/execution-contracts` pass under Bun | Test runner output: 247/247 passed |
| No `@earendil-works` namespace | grep for old namespace returns zero results | grep output empty |
| WorkerAdapter does not decide completion | Contract interface has no completion/verdict fields | Type-level assertion |
| No DB/runtime/controller assumptions | Contracts import only `lib/`; no Kysely, no Express, no Fastify | Import graph check |
| Contract importability | Contracts importable by kernel, server, interface, adapters, hooks | Import test from each consumer package |
| TaskSpec type tests | TaskSpec fields, `criteria_source` enforcement, `acceptance_criteria` required | TypeScript type checks + Zod schema tests |

#### P0.3 — ACCP Compiler Port Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Ported compiler tests (135) | All 135 tests from `pi/packages/accp-compiler` pass under Bun | Test runner output: 135/135 passed |
| No `@earendil-works` namespace | grep for old namespace returns zero results | grep output empty |
| No import from `pi/` remains | All imports point to `@praxis/contracts` or `lib/` | Import graph check |
| Evidence validator false-positive detection | Validator still catches false positives in test fixtures | Specific false-positive fixture tests pass |
| ACCP gate evaluator NOT Truth Engine | Compiler's gate evaluator is used for validation only, not as PRAXIS completion authority | Architecture assertion + import boundary check |
| Compiler is async and non-blocking | Compiler.plan() returns Promise; does not synchronously block | Test verifies Promise return type |

#### P0.4 — FSM Reference Doc Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Document existence | `docs/reference/old-pi-fsm-patterns.md` exists | File exists check |
| Rejection statement present | Doc explicitly says old runtime must NOT be ported directly | Content check (grep for rejection language) |
| Pattern identification | Doc identifies useful patterns for PRAXIS kernel/core | Content check (grep for pattern list) |
| Coupling risks identified | Doc identifies DB/Kysely coupling risks | Content check (grep for coupling section) |

#### P0 Exit Gate Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Forbidden copy list verification | No code from forbidden packages present in PRAXIS tree | File tree diff against forbidden list |
| No old runtime code imported | grep for old runtime imports returns zero results | grep output empty |
| Reuse policy ADR exists | ADR for reuse policy is present in `docs/adr/` | File exists check |
| All sub-gate tests pass | P0.1 + P0.2 + P0.3 + P0.4 test suites all green | Aggregate test report |

---

### P1: Desktop Mockup + Runtime Contract Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Desktop mockup renders mock data | Mission Control screens render with fake runtime data; no crashes | React component test output |
| UI does not invent state | Zustand stores contain only data received from mock client; no computed "completion" fields | Store snapshot assertions |
| RuntimeSnapshot contract validation | Mock snapshots validate against Zod schema | Schema validation test |
| RuntimeEvent contract validation | Mock events of all types validate against Zod schemas | Schema validation test per event type |
| All contract docs exist | Every contract listed in D-101 has a `docs/contracts/*.md` file | File exists checks |
| Desktop component isolation | Each screen component renders independently without full app | Component test per screen |

---

### P2: Mock Runtime Vertical Slice Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Event bus publish/subscribe | Events published to bus reach all subscribers in order | In-memory event log assertions |
| Control-plane API routes | HTTP endpoints return expected shapes and status codes | HTTP response assertions |
| SSE streaming | Event stream delivers events in sequence; reconnect with `after=<seq>` works | SSE client test with event counting |
| Snapshot + replay | Initial snapshot loads, subsequent events apply, gap detection triggers refresh | State sequence assertions |
| Mock worker event generation | Mock worker produces deterministic event sequences (empty diff, passing, failing, namespace violation, crash, rate limit) | Event log assertions per mock scenario |
| Desktop connected to mock server | Desktop renders data from mock server snapshot + SSE, not from static fixtures | Integration test (desktop reads mock server) |
| `interface/client` typed client | Client methods return correctly typed responses for all endpoints | TypeScript type checks + runtime response tests |

---

### P3: Kernel Safety Core Tests

#### Truth Engine Gate Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| EvidenceGate: non-empty diff passes | Diff with real changes inside namespace → PASS | Gate verdict output |
| EvidenceGate: empty diff holds | Empty diff → HOLD | Gate verdict output |
| EvidenceGate: namespace violation fails | Changes outside declared namespace → FAIL | Gate verdict output |
| ExecGate: tests ran and passed | Test runner output with tests_ran > 0 and failures = 0 → PASS | Gate verdict output |
| ExecGate: zero tests ran holds | Test runner output with tests_ran = 0 → HOLD | Gate verdict output |
| ExecGate: test failures hold | Test runner output with failures > 0 → HOLD | Gate verdict output |
| ExecGate: forbidden command fails | Transcript contains forbidden command → FAIL | Gate verdict output |
| FinalGate: all criteria met passes | All required AcceptanceCriteria verified → PASS | Gate verdict output |
| FinalGate: missing criterion holds | One required criterion not met → HOLD | Gate verdict output |
| FinalGate: criteria_source 'generated' fails | TaskSpec with criteria_source 'generated' → FAIL (Law 3) | Gate verdict output |
| FinalGate: no criteria fails | TaskSpec with empty acceptance_criteria → FAIL | Gate verdict output |

#### False-Done Tests (Mandatory)

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Empty diff → FAIL/HOLD | Worker produces zero file changes but claims completion | ExecGate verdict != PASS |
| Zero tests ran → FAIL/HOLD | Worker exits 0 but no test runner was invoked | ExecGate verdict != PASS |
| Agent claim no evidence → FAIL | Worker stdout says "done" but no diff, no test output, no file changes | EvidenceGate verdict != PASS |
| Namespace violation → FAIL | Worker writes files outside declared namespace | EvidenceGate verdict = FAIL |
| Missing criteria → FAIL | TaskSpec has no acceptance_criteria; agent claims done | FinalGate verdict = FAIL |
| Generated criteria rejection → FAIL | TaskSpec with criteria_source 'generated' | PSAG rejection or FinalGate FAIL |

#### EHC Break Classification Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| NOISE: single missing record | Isolated missing record with intact chain → NOISE | Classifier output = NOISE |
| SUSPECTED: multiple missing or hash mismatch pattern | Pattern of missing records or hash mismatches → SUSPECTED | Classifier output = SUSPECTED |
| CONFIRMED: chain integrity broken with divergence | Chain hash mismatch + divergence detected → CONFIRMED | Classifier output = CONFIRMED |
| NOISE does NOT open Circuit Breaker | NOISE classification → Circuit Breaker remains CLOSED (or current state) | CB state unchanged |
| SUSPECTED does NOT open Circuit Breaker | SUSPECTED classification → Circuit Breaker remains CLOSED | CB state unchanged |
| CONFIRMED DOES open Circuit Breaker | CONFIRMED classification → Circuit Breaker transitions to OPEN | CB state = OPEN |

#### Circuit Breaker Transition Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| CLOSED allows admissions | CB state CLOSED → PSAG admits plans normally | Plan admission succeeds |
| OPEN rejects admissions | CB state OPEN → PSAG rejects all new plan admissions | Plan admission rejected |
| HALF_OPEN permits exactly one probe | CB state HALF_OPEN → only one probe attempt allowed; second rejected | Probe count assertion |
| failure_rate > 30% over 10min → OPEN | Sustained failure rate above threshold → CB transitions CLOSED → OPEN | CB state transition + event emitted |
| governor_RED > 15min continuous → OPEN | Governor in RED for > 15 minutes → CB transitions to OPEN | CB state transition + event emitted |
| EHC CONFIRMED → OPEN | CONFIRMED EHC break → CB transitions to OPEN | CB state transition + event emitted |
| OPEN → HALF_OPEN on cooldown expiry | Cooldown period elapses → CB transitions to HALF_OPEN | CB state transition + event emitted |
| OPEN → HALF_OPEN on human reset | Human reset command → CB transitions to HALF_OPEN | CB state transition + event emitted |
| HALF_OPEN → CLOSED on probe pass | Probe attempt passes safety gates → CB transitions to CLOSED | CB state transition + event emitted |
| HALF_OPEN → OPEN on probe fail | Probe attempt fails → CB transitions to OPEN | CB state transition + event emitted |
| NO direct OPEN → CLOSED | CB must pass through HALF_OPEN; direct transition not allowed | Assertion that OPEN → CLOSED is invalid |
| State survives restart | CB state persisted and recovered after runtime restart | CB state after restart = before restart |
| SSE events emitted on transitions | Every state transition emits correct SSE event type | SSE event log assertions |
| Diagnostic snapshot on OPEN | OPEN transition includes diagnostic snapshot with failure_rate, top_failing_gates, governor_state, EHC classification | Snapshot field assertions |

#### PSAG Admission Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Valid PlanSpec admitted | Well-formed PlanSpec with human criteria → ADMIT | PSAG verdict = ADMIT |
| Missing acceptance criteria → REJECT | PlanSpec with empty or missing acceptance_criteria → REJECT | PSAG verdict = REJECT |
| Generated criteria → REJECT | PlanSpec with criteria_source 'generated' → REJECT | PSAG verdict = REJECT |
| Namespace collision → REJECT | Two tasks claim same namespace → REJECT | PSAG verdict = REJECT |
| Dependency cycle → REJECT | Circular task dependencies → REJECT | PSAG verdict = REJECT |
| Budget exceeded → WARN or REJECT | Task budget over threshold → WARN or REJECT | PSAG verdict = WARN or REJECT |

---

### P4: Real Worker Integration Tests

#### Adapter Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| Crash normalization | Worker process crash → normalized RunAttemptResult with crash metadata | RunAttemptResult fields |
| Rate limit detection | Claude Code rate limit response → adapter detects and reports | Rate limit flag in result |
| Hook event capture | PreToolUse, PostToolUse, Stop hooks fire and produce events | Event log contains hook events |
| Divergence detection | Hook-captured output differs from worker-reported output → divergence flagged | Divergence flag in evidence |
| Adapter does NOT emit gate verdict | RunAttemptResult contains no PASS/HOLD/FAIL field | Type-level assertion |
| Adapter does NOT import Truth Engine | Import boundary check | Boundary checker passes |

#### Hook Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| PreToolUse capture | Hook captures tool name, input before execution | Hook event payload |
| PostToolUse capture | Hook captures tool output after execution | Hook event payload |
| Stop capture | Hook captures stop reason and final state | Hook event payload |
| Spool fallback | When runtime server is unreachable, hook spools events locally | Spool file exists with events |
| Event format validation | All hook events validate against HookEvent schema | Schema validation |
| Rapid exit | Hook process exits quickly (< 100ms) after sending/spooling | Timing assertion |

---

### P5: Parallel Execution + Assembler Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| 3 concurrent workers | Three workers run simultaneously in isolated workspaces | Worker lifecycle events |
| Namespace isolation | Worker A cannot write files in Worker B's namespace | Namespace violation detection |
| Assembler atomic apply | All worker patches applied atomically or none applied | Git tree state (all or nothing) |
| Assembler rollback on conflict | Conflict detected → rollback to pre-assembly state | Git tree state = pre-assembly snapshot |
| Conflict detection | Two workers modifying same file → ConflictReport generated | ConflictReport fields |
| Wave scheduler ordering | Tasks in wave N complete before wave N+1 starts | TaskRun completion order |
| Governor tier transitions | stable_3 → stable_6 promotion after clean operation window | Governor state transitions |
| Governor demotion on instability | Failure rate spike → governor demotes tier | Governor state transitions |
| Repair packet injection | ConflictReport → RepairPacket → worker retry with conflict context | Repair attempt lifecycle |

---

### P6: ACCP Artifacts + Production Hardening Tests

| Test Category | What It Verifies | Evidence Type |
|---------------|-----------------|---------------|
| ACCP async job queue | FVR/PRR jobs are enqueued and processed asynchronously | Job lifecycle events |
| Execution does not block on ACCP | TaskRun COMPLETE event emitted before FVR job finishes | Event ordering assertion |
| FVR per TaskRun | Each completed TaskRun produces exactly one FVR | FVR count = completed TaskRun count |
| PRR per wave | Each completed wave produces exactly one PRR | PRR count = completed wave count |
| Playwright e2e (desktop) | Full user flows: admit plan, observe execution, view evidence, inspect verdict | Playwright test report |
| Playwright e2e (CLI) | CLI commands produce correct output for status, runs, logs, admit | CLI output assertions |
| Long-run stability | PRAXIS runs continuously for extended period without memory leak, crash, or state corruption | Stability metrics within baseline |
| Runtime restart recovery | After crash restart, runtime replays event log and recovers state | Post-restart state = pre-crash state |
| PostgreSQL durability | Events survive PostgreSQL restart; no data loss | Event count before/after DB restart |
| Packaging/installer | PRAXIS installs and launches on target OS | Install + launch test per platform |

---

## Gate Mapping Summary

| Phase | Gate | Key Test Categories | Exit Criterion |
|-------|------|---------------------|----------------|
| P0.1 | Scaffold Gate | `bun install`/`typecheck`/`test`, boundary checker, no root `src/` | All checks pass |
| P0.2 | Contracts Gate | 247 ported tests, namespace cleanup, importability | 247/247 pass |
| P0.3 | ACCP Compiler Gate | 135 ported tests, namespace cleanup, not-Truth-Engine assertion | 135/135 pass |
| P0.4 | FSM Ref Doc Gate | Document exists, rejection language, pattern/coupling identification | Content checks pass |
| **P0** | **P0 Exit Gate** | All sub-gates + forbidden copy verification + reuse ADR | **All sub-gates pass** |
| P1 | Desktop Mockup Gate | Mock renders, UI doesn't invent state, contract schema validation | All component tests pass |
| P2 | Mock Runtime Gate | Event bus, SSE, snapshot/replay, mock worker scenarios, desktop connection | All integration tests pass |
| P3 | Kernel Safety Gate | Truth Engine gates, false-done, EHC, Circuit Breaker, PSAG | All safety tests pass |
| P4 | Real Worker Gate | Day 0 Spike GO/NO-GO, adapter normalization, hook capture, divergence | All adapter/hook tests pass |
| P5 | Parallel + Assembly Gate | Concurrent workers, namespace isolation, assembler atomic/rollback, conflict detection | All parallel tests pass |
| P6 | Production Gate | ACCP async, Playwright e2e, long-run stability, restart recovery, packaging | All e2e + stability tests pass |

---

## Test Infrastructure

### Primary Test Runner: Bun

```bash
bun test              # Run all workspace tests
bun test --coverage   # With coverage (when implemented)
```

All packages use Bun's built-in test runner, which is Vitest-compatible. Test files are co-located in each package's `tests/` directory.

### Supplementary Runners

| Tool | When Used | Phase |
|------|-----------|-------|
| Vitest | When Bun test runner compatibility issues arise with specific libraries | P2+ |
| Playwright | Desktop e2e tests, cross-browser verification | P6 |
| React Testing Library | Desktop component tests | P1, P2, P6 |
| MSW (Mock Service Worker) | Mock HTTP/SSE API in desktop tests | P1, P2 |

### Cross-Package Tests

Tests that span multiple packages live in the root `tests/` directory:

```
tests/
├─ integration/       # Multi-package integration scenarios
├─ e2e/               # End-to-end Playwright tests
├─ false-done/        # False-done detection scenarios
├─ evidence-chain/    # EHC integrity and break classification
├─ assembler/         # Assembly rollback and conflict tests
└─ fixtures/          # Shared test fixtures (plans, TaskSpecs, mock data)
```

### CI Requirements

- `bun install` must succeed with clean lockfile
- `bun run typecheck` must pass (TypeScript strict mode, zero errors)
- `bun test` must pass (all workspace tests, zero failures)
- `bun run check` (Biome lint + format) must pass
- Boundary import checker must report zero violations
- Forbidden copy list checker must report zero violations (P0+)
- Test output must be captured and archived as CI artifacts

---

## Failure Modes

### Failure Mode 1: Agent Claims Pass Without Evidence

**Scenario:** A test suite produces exit code 0 with stdout "All tests passed" but no test runner output (no test counts, no file:line references).

**Detection:** Test runner wrapper detects absence of structured test output (JUnit XML, TAP, or Bun JSON reporter output). Classified as AGENT_CLAIM_ONLY. Gate treats as FAIL.

**Prevention:** All CI test runs MUST use structured output format (`bun test --reporter json`). Absence of structured output = test failure regardless of exit code.

### Failure Mode 2: Zero Tests Ran

**Scenario:** Test runner starts but discovers zero test files (wrong glob, misconfigured workspace). Exit code is 0 because "nothing failed."

**Detection:** Test runner output parsed for `tests_ran = 0`. Classified as NO_EVIDENCE. Gate treats as HOLD or FAIL depending on context.

**Prevention:** Each package MUST have at least one test file. Scaffold tests (P0.1) MUST verify test file presence per package.

### Failure Mode 3: Tests Passed After Code Removal

**Scenario:** Tests pass because the code under test was deleted or the test file was removed.

**Detection:** Git diff analysis shows test file deletion without corresponding test migration. Classified as SUSPECTED EHC break if chain hash changes unexpectedly.

### Failure Mode 4: Tests Import Forbidden Packages

**Scenario:** A test file imports from a forbidden package (e.g., kernel test importing `server/storage`), masking the boundary violation because "it's just a test."

**Detection:** Boundary import checker runs on test files as well as source files. Test imports are subject to the same dependency rules.

### Failure Mode 5: False-Done Test Passes When It Should Fail

**Scenario:** A false-done test that should produce FAIL instead produces PASS because the gate logic is inverted or the test fixture is wrong.

**Detection:** Each false-done test MUST be a "negative test" where the expected verdict is explicitly FAIL or HOLD. If the gate returns PASS on a false-done fixture, the TEST fails (not the gate).

---

## Test/Gate Implications

### For P0 Implementation

- 382+ ported tests must be verified as passing under Bun before P0 Exit Gate
- Boundary checker must be implemented and run in CI
- Test infrastructure (Bun workspaces, test runner config) is part of P0.1 scaffold
- Contract type tests serve double duty: they verify the port AND they become the baseline for contract-first development

### For P2 Implementation

- Mock worker must produce all failure scenarios (empty diff, zero tests, namespace violation, crash, rate limit) so that P3 kernel safety tests have deterministic inputs
- SSE replay tests require the event log to be populated with known sequences

### For P3 Implementation

- False-done tests are the most critical category: if they pass on false-done inputs, the Truth Engine is broken
- Circuit Breaker tests must verify NOT just state transitions but also SSE event emission and persistence
- EHC break classification tests must verify the NOISE/SUSPECTED threshold before CONFIRMED

### For All Phases

- No phase may exit its gate without negative test cases
- Test evidence must be machine-parseable (JSON reporter output, not human-readable summaries)
- Agent-authored test descriptions are not trusted; test code itself is the evidence

---

## Decision Compliance Checklist

- [ ] D-103: Every phase has documented test categories that constitute gate criteria
- [ ] D-104: No test category relies on agent self-report as evidence
- [ ] D-105: False-done test categories are specified for every gate
- [ ] D-106: Empty-diff tests are specified for ExecGate
- [ ] D-107: Zero-tests-ran detection is specified for ExecGate
- [ ] D-108: Namespace violation tests are specified for relevant phases
- [ ] D-109: Circuit Breaker transition tests are fully specified (all states, all triggers)
- [ ] D-110: P0 gate tests are defined and gate sequencing is documented
- [ ] D-028: Worker self-report false-done test is specified
- [ ] D-084: Circuit Breaker tests are kernel-scoped, not server-scoped

---

## Open Questions

1. **Coverage thresholds:** What minimum coverage percentage is required per phase? Not yet defined. Soft-lock during P0.1 when tooling is in place.
2. **Long-run stability baseline:** What specific metrics constitute "stable" for P6? Duration, failure rate ceiling, memory ceiling? To be defined during P3 when real metrics are available.
3. **Playwright vs. Electron-specific e2e:** Should desktop e2e tests use Playwright against Electron or against the web renderer directly? Decision needed in P1 mockup phase.
4. **Testcontainers for PostgreSQL tests:** Should integration tests use Testcontainers for disposable PostgreSQL instances? Cost/benefit analysis needed in P2.
5. **Flaky test policy:** What is the policy for flaky tests (auto-quarantine, manual review, immediate fail)? Not yet defined.
6. **Test parallelization:** How many parallel test workers can CI support safely? Depends on CI infrastructure (not yet provisioned).

---

## Audit Notes

- This document defines WHAT must be tested, not HOW each test is written. Per-phase implementation plans will contain detailed test case lists.
- Test counts for P0.2 (247) and P0.3 (135) are from the current `pi/` monorepo as of the last audit. These counts must be verified against the actual source before P0.2/P0.3 begin.
- The false-done test categories in P3 are the minimum set. Additional false-done scenarios will emerge during implementation.
- All test categories assume Bun as the test runner. If Bun compatibility issues arise for specific packages, Vitest fallback is specified but should be treated as exceptional.
- This document's test categories are consistent with `docs/decisions.md` Section 16 (Testing and Gate Decisions). Any addition of new test categories that cross HARD_LOCK boundaries requires an ADR.
