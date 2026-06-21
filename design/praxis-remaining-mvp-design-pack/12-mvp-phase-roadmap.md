# MVP Phase Roadmap — P3 to P6

> This document defines the exact implementation phases after P2, with per-phase scope, acceptance criteria, and prerequisites.

## Phase Overview

```
P3 ──► P4 ──► P5 ──► P6
│      │      │      │
│      │      │      └──── FinalGate + RepairPacket + Reports + CLI + Plugin
│      │      └─────────── ExecGate (command runner)
│      └────────────────── WiringGate v0.1-lite
└───────────────────────── EvidenceGate + EvidenceLedger
```

**Dependencies:** P3 → P4 → P5 → P6 (sequential — each phase builds on prior)

**Estimate:** ~8-12 implementation sessions total (2-3 per phase)

## Phase P3 — EvidenceGate + EvidenceLedger

### Scope

| Component | Deliverable |
|-----------|-------------|
| EvidenceLedger reader | JSONL line parser with validation |
| EvidenceLedger writer | Append-only evidence record writer |
| Evidence hash chain (v0.1-lite) | Optional chain_hash verification |
| Namespace checker | allowedFiles/forbiddenFiles verification |
| Diff analyzer | Detect empty diffs, classify by artifact class |
| EvidenceGate gate | Main gate logic with PASS/HOLD/FAIL |
| Kernel pipeline integration | Wire into runKernel (replaces runP2Kernel) |
| Test fixtures | Evidence test scenarios |
| Diagnostics | EvidenceGate reason codes |

### Acceptance Criteria

| ID | Description | Verification |
|----|-------------|-------------|
| P3-AC-01 | EvidenceLedger reader parses valid JSONL | Parse test file, verify all records returned |
| P3-AC-02 | EvidenceLedger reader handles malformed lines | Inject malformed line, verify graceful skip |
| P3-AC-03 | EvidenceLedger writer appends records atomically | Append 10 records, verify all present |
| P3-AC-04 | EvidenceGate detects empty evidence ledger | Empty ledger → HOLD (EVIDENCE_EMPTY) |
| P3-AC-05 | EvidenceGate detects namespace violations | File outside allowedFiles → FAIL (NAMESPACE_VIOLATION) |
| P3-AC-06 | EvidenceGate detects forbidden file mutations | Forbidden file modified → FAIL (FORBIDDEN_FILE_MUTATED) |
| P3-AC-07 | EvidenceGate detects empty diff for code tasks | Code task with no diff → HOLD (DIFF_EMPTY) |
| P3-AC-08 | EvidenceGate passes with clean evidence | Valid evidence, namespace clean → PASS (EVIDENCE_PASS) |
| P3-AC-09 | EvidenceGate handles optional EHC chain | Chain present → verify; chain absent → skip gracefully |
| P3-AC-10 | EvidenceGate checks required evidence per criterion | Missing required type → HOLD (MISSING_REQUIRED_EVIDENCE) |
| P3-AC-11 | EvidenceGate is wired into runKernel pipeline | `runKernel()` runs SchemaGate→LockGate→EvidenceGate→stop |
| P3-AC-12 | All EvidenceGate reason codes are in diagnostics.ts | 12 reason codes defined |
| P3-AC-13 | Test suite passes with ≥ 15 tests | `bun test` ALL PASS |

### Files to Create

```
packages/kernel/src/
  gates/evidenceGate.ts            ← NEW
  evidence/evidenceLedger.ts       ← NEW
  evidence/evidenceChainVerifier.ts ← NEW
  evidence/namespaceChecker.ts     ← NEW
  evidence/diffAnalyzer.ts         ← NEW
  runKernel.ts                     ← NEW (replaces runP2Kernel.ts)
  
packages/kernel/test/
  test/evidenceGate.spec.ts        ← NEW
  test/kernel.spec.ts              ← NEW (full pipeline)
  
packages/kernel/src/
  diagnostics.ts                   ← MODIFY (add reason codes)
  types.ts                         ← MODIFY (add evidence types)
  index.ts                         ← MODIFY (export new modules)
```

### Estimated Effort

- EvidenceLedger reader/writer: medium (file I/O, JSON parsing)
- Namespace checker: small (path comparison logic)
- Diff analyzer: small (string matching)
- EvidenceGate logic: medium (gate orchestration)
- Tests: medium (fixture-based testing, 15+ tests)
- Pipeline integration: small (wire into runKernel)

### Risks

- JSONL performance with large evidence files (mitigation: streaming reader)
- Cross-platform path resolution for namespace checks (mitigation: use `path.resolve`)

---

## Phase P4 — WiringGate v0.1-lite

### Scope

| Component | Deliverable |
|-----------|-------------|
| DeclaredUnit matcher | Filesystem path existence checks |
| Export surface checker | Pattern-based export verification |
| Entrypoint checker | Path existence verification |
| Orphan module detector | Set-difference analysis |
| Wiring mode consistency | Mode vs declarations validation |
| WiringGate gate | Main gate logic with PASS/HOLD/FAIL |
| Pipeline integration | Wire into runKernel between EvidenceGate and ExecGate |
| Test fixtures | Wiring test scenarios |

### Acceptance Criteria

| ID | Description | Verification |
|----|-------------|-------------|
| P4-AC-01 | DeclaredUnit missing file → FAIL | Non-existent unit path → DECLARED_UNIT_MISSING |
| P4-AC-02 | Export surface missing → FAIL | Non-existent surface path → EXPORT_SURFACE_MISSING |
| P4-AC-03 | Required export not found → HOLD | Export string absent from file → REQUIRED_EXPORT_MISSING |
| P4-AC-04 | Entrypoint not found → HOLD | Entrypoint path absent → ENTRYPOINT_NOT_FOUND |
| P4-AC-05 | Orphan modules detected → HOLD | Files undeclared → ORPHAN_MODULES_DETECTED |
| P4-AC-06 | Wiring mode inconsistency → HOLD | mode=none but units declared → WIRING_MODE_INCONSISTENT |
| P4-AC-07 | All checks pass → PASS | All units exist, exports found → WIRING_PASS |
| P4-AC-08 | WiringGate skipped when integrationContract absent | No contract → skip gracefully |
| P4-AC-09 | WiringGate is wired into runKernel | 4-gate pipeline: Schema→Lock→Evidence→Wiring→stop |
| P4-AC-10 | Test suite passes with ≥ 10 tests | `bun test` ALL PASS |

### Files to Create

```
packages/kernel/src/
  gates/wiringGate.ts               ← NEW
  wiring/declaredUnitMatcher.ts      ← NEW
  wiring/exportChecker.ts           ← NEW
  wiring/orphanDetector.ts          ← NEW
  wiring/modeValidator.ts           ← NEW

packages/kernel/test/
  test/wiringGate.spec.ts           ← NEW

packages/kernel/src/
  diagnostics.ts                    ← MODIFY (add WiringGate reason codes)
  types.ts                          ← MODIFY (add WiringGate types)
  runKernel.ts                      ← MODIFY (add WiringGate to pipeline)
```

### Estimated Effort

- Static file matching: small (`fs.existsSync` + set operations)
- Export surface checker: small (regex patterns on file content)
- Orphan detection: small (array set-difference)
- WiringGate logic: small-medium (orchestration of sub-checks)
- Tests: small (fixture-based)

### Advanced Wiring (Deferred to v0.2+)

The following are EXPLICITLY NOT in P4 scope:

- TypeScript compiler API integration
- Full import graph resolution
- AST-level export verification
- Transitive dependency checks
- Usage proof execution
- Runtime probe execution
- Reachability tracing from entrypoints

---

## Phase P5 — ExecGate

### Scope

| Component | Deliverable |
|-----------|-------------|
| Command validator | Allowed/denied command checking |
| Command runner | Process spawn, stdout/stderr capture |
| Timeout enforcement | SIGTERM → SIGKILL escalation |
| Watch mode prevention | Pattern detection + short timeout check |
| NoTestsFound detector | Test output parsing |
| Expected output matcher | Pattern matching on command output |
| Evidence capture | Command start/exit/output evidence records |
| ExecGate gate | Main gate logic with PASS/HOLD/FAIL |
| Test fixtures | Command execution test scenarios |

### Acceptance Criteria

| ID | Description | Verification |
|----|-------------|-------------|
| P5-AC-01 | Allowed command executes successfully | Declared command runs → PASS |
| P5-AC-02 | Not-allowed command rejected → FAIL | Unknown command → COMMAND_NOT_ALLOWED |
| P5-AC-03 | Hard-denied command blocked → FAIL | Match denied command → COMMAND_DENIED |
| P5-AC-04 | Command timeout enforced → FAIL | Long command + short timeout → COMMAND_TIMEOUT |
| P5-AC-05 | Watch mode detected → FAIL | --watch flag + watchModeForbidden → WATCH_MODE_DETECTED |
| P5-AC-06 | No tests found detected → HOLD | Empty test run + noTestsFoundIsFailure → NO_TESTS_FOUND |
| P5-AC-07 | Expected pattern matching → PASS | Command output matches pattern → command PASS |
| P5-AC-08 | Unexpected exit code → HOLD | Exit code mismatch → UNEXPECTED_EXIT_CODE |
| P5-AC-09 | Evidence captured per command | Command start + output records created |
| P5-AC-10 | Shell disabled by default | spawn called with shell=false for disallowed commands |
| P5-AC-11 | ExecGate wired into runKernel | 5-gate pipeline: Schema→Lock→Evidence→Wiring→Exec→stop |
| P5-AC-12 | Test suite passes with ≥ 15 tests | `bun test` ALL PASS |

### Files to Create

```
packages/kernel/src/
  gates/execGate.ts                ← NEW
  executor/commandRunner.ts        ← NEW
  executor/commandValidator.ts     ← NEW
  executor/testOutputParser.ts     ← NEW
  executor/evidenceCapture.ts      ← NEW
  executor/commandSafety.ts        ← NEW

packages/kernel/test/
  test/execGate.spec.ts            ← NEW
  test/testOutputParser.spec.ts    ← NEW
  test/commandRunner.spec.ts       ← NEW

packages/kernel/src/
  diagnostics.ts                   ← MODIFY (add ExecGate reason codes)
  types.ts                         ← MODIFY (add ExecGate types)
  runKernel.ts                     ← MODIFY (add ExecGate to pipeline)
```

### Estimated Effort

- Process spawning: medium (cross-platform, timeout, signal handling)
- Command validation: small (string matching)
- Test output parsing: medium (multiple test framework patterns)
- ExecGate logic: medium (orchestration, evidence capture)
- Tests: medium-high (flaky test concerns, process isolation)

### Risks

- **HIGH:** Cross-platform process spawning differences (macOS vs Linux)
- **MEDIUM:** Test output format varies by framework (tap, junit, mocha, vitest)
- **MEDIUM:** Watch mode detection is heuristic — not foolproof
- **LOW:** Network blocking is advisory only in v0.1

---

## Phase P6 — FinalGate + RepairPacket + Reports + CLI + Plugin

### Scope

| Component | Deliverable |
|-----------|-------------|
| Criterion evaluator | Per-criterion evaluation against evidence |
| Deterministic filter | Advisory evidence filter |
| Verdict aggregator | Verdict ladder logic |
| FinalGate gate | Main gate logic |
| RepairPacket generator | JSON repair packet creation |
| ACCP report generator | YAML + summary.md dual output |
| CLI (praxis) | Command tree implementation |
| Plugin bridge | Slash commands + hooks |

### Acceptance Criteria

| ID | Description | Verification |
|----|-------------|-------------|
| P6-AC-01 | All criteria pass deterministic → PASS | 5/5 criteria met → ALL_CRITERIA_MET |
| P6-AC-02 | Some criteria fail → HOLD | 4/5 criteria met → CRITERIA_PARTIAL |
| P6-AC-03 | All criteria advisory → HOLD | No deterministic evidence → NO_DETERMINISTIC_CRITERIA |
| P6-AC-04 | Forbidden diff pattern → FAIL | Forbidden content → FORBIDDEN_DIFF_CONTENT |
| P6-AC-05 | Prior gate FAIL → FAIL (escalated) | ExecGate FAIL → FinalGate FAIL |
| P6-AC-06 | No criteria in plan → HOLD | 0 criteria → NO_CRITERIA_DEFINED |
| P6-AC-07 | RepairPacket generated on HOLD | HOLD → .praxis/repairs/<id>.json created |
| P6-AC-08 | RepairPacket NOT generated on PASS | PASS → no repair packet |
| P6-AC-09 | Runtime report generated | .praxis/runs/<id>/run.report.yaml created |
| P6-AC-10 | ACCP report format correct | Valid YAML with required sections |
| P6-AC-11 | CLI verify command runs full pipeline | `praxis verify` → kernel run → formatted output |
| P6-AC-12 | CLI status command shows run history | `praxis status` → formatted status |
| P6-AC-13 | CLI ledger show displays evidence | `praxis ledger show` → evidence table |
| P6-AC-14 | Test suite passes with ≥ 20 tests | `bun test` ALL PASS |

### Files to Create

```
packages/
  cli/                              ← NEW package
    package.json
    tsconfig.json
    src/
      index.ts                      ← CLI entry
      commands/
        verify.ts
        plan.ts
        repair.ts
        status.ts
        ledger.ts
        report.ts
        config.ts
        init.ts
      formatters/
        tableFormatter.ts
        jsonFormatter.ts
        summaryFormatter.ts
      config.ts
  
  claude-plugin/                    ← NEW package (optional — may be in-repo script)
    src/
      index.ts
      slashCommands.ts
      hooks/preToolUse.ts
      hooks/postToolUse.ts
      hooks/stopHandler.ts
      display/formatVerdict.ts
      display/formatLedger.ts
      display/formatReport.ts

packages/kernel/src/
  gates/finalGate.ts                ← NEW
  final/criterionEvaluator.ts       ← NEW
  final/verdictAggregator.ts        ← NEW
  final/deterministicFilter.ts      ← NEW
  repair/repairPacketGenerator.ts   ← NEW
  report/reportGenerator.ts         ← NEW

packages/kernel/test/
  test/finalGate.spec.ts            ← NEW
  test/repairPacket.spec.ts         ← NEW
  test/reportGenerator.spec.ts      ← NEW
  test/cliIntegration.spec.ts       ← NEW (e2e)

packages/kernel/src/
  runKernel.ts                      ← MODIFY (add FinalGate)
  diagnostics.ts                    ← MODIFY (add FinalGate reason codes)
  types.ts                          ← MODIFY (add FinalGate/Repair/Report types)
  index.ts                          ← MODIFY (export new modules)
```

### Estimated Effort

- FinalGate logic: medium (criterion mapping, aggregation rules)
- RepairPacket generator: small (JSON template + kernel context)
- Report generator: medium (YAML + MD dual output)
- CLI: medium (command tree, flag parsing, formatting)
- Plugin bridge: medium (slash commands, hooks, display)
- Tests: medium-high (end-to-end scenarios)

### Risks

- **MEDIUM:** CLI flag parsing library choice (yargs vs commander vs bare)
- **MEDIUM:** Plugin bridge depends on Claude Code plugin API (may change)
- **LOW:** Report format may need tuning based on user feedback

---

## Complete File Inventory (All Phases)

### New Files Created

```
Phase P3:
  packages/kernel/src/gates/evidenceGate.ts
  packages/kernel/src/evidence/evidenceLedger.ts
  packages/kernel/src/evidence/evidenceChainVerifier.ts
  packages/kernel/src/evidence/namespaceChecker.ts
  packages/kernel/src/evidence/diffAnalyzer.ts
  packages/kernel/src/runKernel.ts (replaces runP2Kernel)
  packages/kernel/test/evidenceGate.spec.ts
  packages/kernel/test/kernel.spec.ts

Phase P4:
  packages/kernel/src/gates/wiringGate.ts
  packages/kernel/src/wiring/declaredUnitMatcher.ts
  packages/kernel/src/wiring/exportChecker.ts
  packages/kernel/src/wiring/orphanDetector.ts
  packages/kernel/src/wiring/modeValidator.ts
  packages/kernel/test/wiringGate.spec.ts

Phase P5:
  packages/kernel/src/gates/execGate.ts
  packages/kernel/src/executor/commandRunner.ts
  packages/kernel/src/executor/commandValidator.ts
  packages/kernel/src/executor/testOutputParser.ts
  packages/kernel/src/executor/evidenceCapture.ts
  packages/kernel/src/executor/commandSafety.ts
  packages/kernel/test/execGate.spec.ts
  packages/kernel/test/testOutputParser.spec.ts
  packages/kernel/test/commandRunner.spec.ts

Phase P6:
  packages/kernel/src/gates/finalGate.ts
  packages/kernel/src/final/criterionEvaluator.ts
  packages/kernel/src/final/verdictAggregator.ts
  packages/kernel/src/final/deterministicFilter.ts
  packages/kernel/src/repair/repairPacketGenerator.ts
  packages/kernel/src/report/reportGenerator.ts
  packages/kernel/test/finalGate.spec.ts
  packages/kernel/test/repairPacket.spec.ts
  packages/kernel/test/reportGenerator.spec.ts
  packages/kernel/test/cliIntegration.spec.ts
  packages/cli/ (package scaffold + commands)
  packages/claude-plugin/ (package scaffold + handlers)
```

### Modified Files

```
packages/kernel/src/diagnostics.ts   ← P3, P4, P5, P6 (add reason codes)
packages/kernel/src/types.ts         ← P3, P4, P5, P6 (add types)
packages/kernel/src/index.ts         ← P3, P4, P5, P6 (add exports)
packages/kernel/src/runKernel.ts     ← P4, P5, P6 (add gates to pipeline)
```

## Post-MVP (v0.2+) Items

Features explicitly deferred past v0.1:

1. **AST import graph analysis** — Full TypeScript compiler integration
2. **Advanced wiring analysis** — Transitive deps, reachability, cycle detection
3. **Server runtime** — Persistence layer, SSE streaming, REST API
4. **Dashboard UI** — Web interface beyond CLI
5. **Multi-worker orchestration** — Concurrent agent execution
6. **Circuit Breaker full automation** — CB implementation + governor
7. **Messages API fallback** — PRAXIS-owned agent loop
8. **Network sandboxing** — Full network isolation per command
9. **Coverage tool integration** — Istanbul/c8 coverage gates
10. **PostgreSQL evidence store** — Beyond JSONL files
