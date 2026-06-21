# Risk Register — PRAXIS Remaining MVP Architecture

> This document identifies, assesses, and mitigates risks for the remaining PRAXIS MVP implementation (P3-P6). Each risk is categorized by type, severity, and phase.

## Risk Categories

| Category | Label | Description |
|----------|-------|-------------|
| Architecture | ARCH | Design-level risk affecting correctness |
| Implementation | IMPL | Implementation complexity or difficulty |
| False Signal | FS | Risk of false PASS or false HOLD |
| Integration | INT | Cross-component integration risk |
| External | EXT | Dependency on external systems/APIs |
| Process | PROC | Development workflow risk |

## Risk Table

### Critical Risks

| ID | Phase | Category | Risk | Likelihood | Impact | Mitigation |
|----|-------|----------|------|------------|--------|------------|
| R-001 | P3 | FS | **EvidenceGate passes despite corrupted evidence.** If EHC chain verification is too lenient, tampered evidence could produce false PASS. | Medium | Critical | v0.1-lite chain check catches obvious breaks. Full mandatory chain enforcement in v0.2. |
| R-002 | P5 | FS | **ExecGate passes despite command spoofing.** If a malicious agent writes a script that looks like the allowed command but does something else, ExecGate could be fooled. | Low | Critical | Exact command matching + shell=disabled prevents most spoofing. Full hash verification deferred to v0.2. |
| R-003 | P6 | FS | **FinalGate passes with advisory-only evidence.** If the deterministic filter is buggy, all-advisory criteria could yield false PASS. | Low | Critical | Strict type checking on `advisoryOnly` field. Test coverage of edge cases (advisory criteria mix). |
| R-004 | P6 | FS | **RepairPacket enables scope expansion.** If repair packet modifies allowedFiles or acceptance criteria, LAW 3 could be violated. | Low | Critical | RepairPacket generator explicitly prohibits modifying plan fields. Chain-of-trust verification on repair application. |
| R-005 | P5 | IMPL | **Cross-platform process spawning differences.** macOS and Linux handle process groups, signals, and timeouts differently. Commands that work on one platform may behave differently on another. | High | High | Platform-specific test matrices. Use Node.js `child_process` abstraction. Document platform-specific behavior. |
| R-006 | P5 | FS | **Watch mode detection is unreliable.** Heuristic pattern matching may miss watch commands or flag false positives. | Medium | High | Combine pattern matching + short-timeout output detection. Watch mode is FAIL (safe side). False positives preferred over false negatives. |

### High Risks

| ID | Phase | Category | Risk | Likelihood | Impact | Mitigation |
|----|-------|----------|------|------------|--------|------------|
| R-007 | P3 | ARCH | **Namespace checking is too permissive.** If path resolution doesn't normalize correctly, files outside allowedFiles could be considered valid. | Medium | High | Use `path.resolve` for normalization. Test with symlinks, relative paths, `..` traversal attempts. |
| R-008 | P4 | ARCH | **WiringGate export pattern matching produces false negatives.** Simple string matching may miss exports that use re-exports or dynamic patterns. | High | Medium | Acceptable for v0.1 — documented as known gap. v0.2 full AST imports solve this. |
| R-009 | P5 | IMPL | **Test output parsing fails for non-standard test frameworks.** If the test output parser only handles vitest/tap but user runs mocha/jest, no tests found → HOLD. | Medium | High | Design extensible parser interface. Support common patterns. Document supported frameworks. |
| R-010 | P6 | PROC | **CLI and Plugin bridge depend on Claude Code plugin API which may change.** Claude Code plugin API is not yet stable. | Medium | High | Keep plugin bridge thin and isolated. API changes only affect display layer, not kernel. |
| R-011 | P3 | INT | **EvidenceLedger path resolution fails in non-standard repo layouts.** If .praxis/ is not at repo root, evidence paths break. | Medium | High | All paths resolved relative to repoRoot (configurable). Test with monorepo and subdirectory layouts. |
| R-012 | P6 | FS | **Report model omits critical failure details.** If reports don't include enough detail for debugging, users will bypass PRAXIS to debug manually. | Medium | Medium | Include all reason codes, diagnostics, evidence refs, and full gate context in reports. |

### Medium Risks

| ID | Phase | Category | Risk | Likelihood | Impact | Mitigation |
|----|-------|----------|------|------------|--------|------------|
| R-013 | P3 | IMPL | **JSONL evidence ledger grows unbounded.** Large evidence files (100MB+) slow down reading and verification. | Medium | Medium | Soft limit at 100MB with warning. Streaming reader prevents OOM. |
| R-014 | P4 | ARCH | **Orphan module detection creates noise.** Non-declared support files (READMEs, configs) trigger unnecessary HOLD. | High | Low | Orphan HOLD is advisory — not FAIL. User can ignore or declare files. |
| R-015 | P5 | EXT | **Command execution requires external tools (bun, node, git).** If required tools are not installed, commands fail with confusing errors. | Medium | Medium | Clear error messages linking to exactAllowedCommands. Pre-flight check in CLI `init` command. |
| R-016 | P6 | IMPL | **Dual report format (YAML+MD) drifts.** If one format is updated but the other is not, reports become inconsistent. | Medium | Medium | Both generated from same data model. Single generation function. |
| R-017 | P3 | FS | **EvidenceGate accepts empty evidence with warning.** Documentation tasks legitimately produce no diffs, but the warning may be ignored for code tasks too. | Medium | Medium | Diff-empty per artifact class. Code tasks get HOLD, doc tasks get PASS. |
| R-018 | P6 | EXT | **Plugin bridge requires user to install praxis CLI separately.** Plugin without CLI is non-functional. | Medium | Low | Clear installation instructions in plugin README. `praxis init` checks for CLI. |
| R-019 | P3-P6 | PROC | **Phase boundaries cause integration delays.** Each phase (P3-P6) is sequential — if one phase is delayed, all subsequent phases are blocked. | Medium | Medium | This design pack provides the full picture, enabling parallel planning. Overlap implementation where possible. |
| R-020 | P6 | FS | **FinalGate passes with zero criteria in plan.** No criteria = no failure possible = automatic PASS. | Low | Medium | Explicit check: zero criteria → HOLD (NO_CRITERIA_DEFINED). |
| R-021 | P3-P6 | IMPL | **TypeScript type safety gaps in kernel.** `any` or loose types could allow invalid state to propagate between gates. | Medium | Medium | Strict TypeScript configuration. Gate input/output interfaces are fully typed. No `any` in gate boundaries. |

### Low Risks

| ID | Phase | Category | Risk | Likelihood | Impact | Mitigation |
|----|-------|----------|------|------------|--------|------------|
| R-022 | P5 | IMPL | **Timeout enforcement kills long-running legitimate commands.** A build that genuinely takes >5 minutes would be killed by default timeout. | Low | Low | PlanSpec sets `timeoutSeconds` per command. Default 300s is documented. Users increase for known-long commands. |
| R-023 | P6 | PROC | **CLI command tree is too large for v0.1.** 20+ subcommands overwhelm new users. | Medium | Low | Group commands under `plan`, `repair`, `ledger` subcommands. `praxis help` shows groups. |
| R-024 | P3 | IMPL | **EHC chain verification in v0.1-lite is skipped by default.** Optional chain check means most evidence is unverified in v0.1. | High | Low | Accepted design trade-off for v0.1. Mandatory in v0.2. |
| R-025 | P5 | FS | **Hard-denied commands may not match user-intended patterns.** Pattern matching on denied commands could be too broad or too narrow. | Medium | Low | deniedCommand supports both exact match and regex pattern. Test with common dangerous commands. |
| R-026 | P6 | PROC | **Plugin bridge adds complexity for marginal v0.1 value.** Without auto-verify-on-stop, plugin is just a display layer. | Medium | Low | Plugin is optional — CLI is primary interface. Plugin adds convenience for in-session verification. |
| R-027 | All | FS | **Over-engineering gates for v0.1 instead of keeping them simple.** Each gate could grow to handle edge cases that don't exist yet. | Medium | Low | This design pack explicitly constrains each gate's v0.1 scope. Scope creep is documented as a risk and actively mitigated. |
| R-028 | P6 | FS | **False HOLD from wiring checks on generated code.** Codegen tasks may produce files after wiring check runs. | Low | Low | WiringGate runs AFTER EvidenceGate confirms file changes. Generated files exist before wiring check. |

## False PASS Risk Analysis

### Most Likely False PASS Vectors (Ranked)

| Rank | Vector | Gate | Mitigation |
|------|--------|------|------------|
| 1 | Evidence chain integrity not verified (v0.1-lite) | EvidenceGate | Full mandatory chain in v0.2 |
| 2 | Advisory criteria treated as deterministic | FinalGate | Strict `advisoryOnly` filter + `NO_DETERMINISTIC_CRITERIA` HOLD |
| 3 | Command spoofing via allowed script name | ExecGate | Exact command match + shell=disabled |
| 4 | Namespace path traversal | EvidenceGate | `path.resolve` normalization + traversal tests |
| 5 | No criteria in plan → automatic PASS | FinalGate | Zero-criteria → HOLD check |
| 6 | Agent-draft criteria auto-approved | FinalGate | humanApproved check |
| 7 | Wiring export false positive (string match) | WiringGate | Acceptable v0.1 gap |
| 8 | Watch mode not detected | ExecGate | Multi-method detection (pattern + timeout) |

### Least Likely False PASS Vectors

| Vector | Why Unlikely |
|--------|-------------|
| SchemaGate passes invalid YAML | Delegates to battle-tested JSON Schema validator |
| LockGate passes mismatched hashes | Deterministic hash comparison cannot be bypassed |
| Forbidden file mutation not detected | Explicit path check in EvidenceGate |
| Shell injection via command | shell=false by default prevents shell injection |

## Over-Engineering Risk

### Where We Might Be Doing Too Much for v0.1

| Area | Current Design | v0.1 Minimum | Verdict |
|------|---------------|-------------|---------|
| EHC chain verification | Optional (v0.1-lite) | Not needed at all | **Right level.** Optional is fine. |
| Wiring export pattern matching | File content scanning | Just check file exists | **Slightly over.** But pattern matching catches common issues. |
| Report model (dual format) | YAML + MD | Just YAML | **Acceptable over.** MD summaries are cheap to generate from YAML. |
| Plugin bridge | 9 slash commands | 3-4 commands | **Potential over.** But plugin is optional — skip if not needed. |
| RepairPacket strategy rotation | 6 strategies + ABORT | Just "retry" | **Intentional over.** Strategy rotation prevents infinite repair loops. |

### Where We Might Be Doing Too Little for v0.1

| Area | Current Design | v0.1 Ideal | Verdict |
|------|---------------|-----------|---------|
| Evidence chain verification | Optional | Mandatory | **Acceptable gap.** Full chain in v0.2. |
| Wiring import graph | Deferred to v0.2 | Partial support | **Correct deferral.** Full analysis is heavy. |
| Network sandboxing | Advisory only | Blocked by default | **Acceptable gap.** True sandboxing is platform-specific. |
| Coverage gates | Deferred to v0.2 | Useful in v0.1 | **Acceptable gap.** Coverage is a nice-to-have. |

## Risk Response Plan

### If False PASS Detected

1. **Immediate:** Document the false PASS vector
2. **Short-term:** Add a gate-level check to prevent it (within same phase)
3. **Medium-term:** Add test coverage for the vector
4. **Long-term:** Retroactively add the check to prior phases if it crosses phase boundaries

### If Implementation Blocked

1. **Document** the blocker with full context
2. **Escalate** to the design pack (this document) — is the design flawed or the implementation?
3. **Workaround** if available (e.g., manual verification step)
4. **Defer** if the feature is not critical for v0.1

### If External API Changes (Plugin Bridge)

1. **Isolate** the plugin bridge from kernel logic (already designed this way)
2. **Version-pin** the Claude Code plugin API version
3. **Feature-detect** API availability rather than assuming
4. **Graceful degradation** — plugin displays error, CLI still works

## Risk Review Cadence

- Each phase implementation: review R-001 through R-028 for affected risks
- Phase completion: update risk register with findings from implementation
- Between phases: reassess likelihood/impact based on actual implementation experience
- Final v0.1 release: full risk register review
