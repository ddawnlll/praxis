# Truth Kernel Pipeline — Complete 6-Gate Design

> This document defines the complete 6-gate Truth Kernel pipeline for PRAXIS v0.1 MVP. It covers the sequence, data flow, gate responsibilities, verdict propagation, and integration points.

## Pipeline Overview

```
PlanSpec YAML
    │ (read + parse)
    ▼
┌──────────────────────────────────────────────────────────┐
│  1. SchemaGate                              [P2 locked]  │
│     • Validate YAML syntax                               │
│     • Validate JSON Schema (Draft 2020-12)               │
│     • Validate semantics (cross-field constraints)        │
│     • Compute 7-field PlanHashes                          │
│     ─────────────                                        │
│     PASS → continue to LockGate                          │
│     FAIL  → stop (plan is structurally invalid)           │
└──────────────────────────────────────────────────────────┘
    │ PASS (plan + hashes)
    ▼
┌──────────────────────────────────────────────────────────┐
│  2. LockGate                                [P2 locked]  │
│     • Verify lock file exists                             │
│     • Compare PlanHashes against lock file hashes         │
│     • 3 modes: verify_existing / create_if_missing /     │
│                refresh_explicit                           │
│     ─────────────                                        │
│     PASS → continue to EvidenceGate                      │
│     HOLD → lock missing (use create_if_missing)           │
│     FAIL → hash mismatch (plan changed after lock)        │
└──────────────────────────────────────────────────────────┘
    │ PASS (plan + hashes + lock verified)
    ▼
┌──────────────────────────────────────────────────────────┐
│  3. EvidenceGate                            [P3 design]  │
│     • Read evidence ledger (JSONL)                        │
│     • Verify EHC chain integrity                          │
│     • Check namespace compliance                          │
│     • Detect forbidden file mutations                     │
│     • Check diff existence (code tasks need non-empty)    │
│     ─────────────                                        │
│     PASS → continue to WiringGate                         │
│     HOLD → empty diff, missing evidence                   │
│     FAIL → namespace violation, forbidden file touched    │
└──────────────────────────────────────────────────────────┘
    │ PASS (evidence ledger trusted)
    ▼
┌──────────────────────────────────────────────────────────┐
│  4. WiringGate (v0.1-lite)                 [P4 design]  │
│     • Match declaredUnits against filesystem paths        │
│     • Verify exportSurface requiredExports exist          │
│     • Check entrypoint path reachability (file exists)    │
│     • Detect orphan modules (files not in declaredUnits)  │
│     ─────────────                                        │
│     PASS → continue to ExecGate                           │
│     HOLD → export mismatch, unreachable entrypoint        │
│     FAIL → declared unit missing, orphan module           │
│                                                          │
│     Note: AST/import-graph analysis deferred to v0.2+    │
└──────────────────────────────────────────────────────────┘
    │ PASS (wiring verified)
    ▼
┌──────────────────────────────────────────────────────────┐
│  5. ExecGate                               [P5 design]   │
│     • Validate command safety (exactAllowedCommands)      │
│     • Block hardDeniedCommands                            │
│     • Execute commands with timeout enforcement           │
│     • Capture stdout/stderr/exitcode as evidence          │
│     • Validate test results (noTestsFoundIsFailure)       │
│     ─────────────                                        │
│     PASS → continue to FinalGate                          │
│     HOLD → tests failed, nonzero exit, timeout            │
│     FAIL → forbidden command, command spoofing            │
└──────────────────────────────────────────────────────────┘
    │ PASS (commands executed + evidence captured)
    ▼
┌──────────────────────────────────────────────────────────┐
│  6. FinalGate                              [P6 design]   │
│     • Map evidence to acceptance criteria                 │
│     • Deterministic evidence only → PASS possible         │
│     • Advisory-only criteria → cannot PASS                │
│     • Aggregate all gate verdicts into final result       │
│     • Generate ACCP report                                │
│     ─────────────                                        │
│     PASS → task complete. Generate success report.        │
│     HOLD → generate RepairPacket, retry                   │
│     FAIL → human review required                          │
└──────────────────────────────────────────────────────────┘
```

## Data Flow Between Gates

### Gate Context Object

The KernelContext accumulates data as it passes through gates:

```
interface KernelContext {
  // Set by SchemaGate
  plan: PlanSpecV01            // Parsed plan
  hashes: PlanHashes           // 7 deterministic hashes
  
  // Set by LockGate
  lockPath: string             // Path to .lock.yaml
  lock: PlanLockV01            // Parsed lock
  
  // Set by EvidenceGate
  evidenceLedgerPath: string   // Path to evidence JSONL
  evidenceRecords: EvidenceRecord[]  // Parsed evidence chain
  chainIntegrity: 'CLEAN' | 'NOISE' | 'SUSPECTED' | 'CONFIRMED'
  namespaceCompliant: boolean
  diffEmpty: boolean
  forbiddenFilesTouched: string[]
  
  // Set by WiringGate
  declaredUnitsMatched: MatchedUnit[]
  exportSurfaceResults: ExportCheck[]
  orphanModules: string[]
  
  // Set by ExecGate
  commandResults: CommandResult[]
  testResults: TestResult[]
  
  // Set by FinalGate
  criterionResults: CriterionResult[]
  overallVerdict: 'PASS' | 'HOLD' | 'FAIL'
  reportPath: string
}
```

### Gate Return Type

Every gate returns a `GateResult`:

```
interface GateResult {
  gateName: string
  verdict: 'PASS' | 'HOLD' | 'FAIL'
  reasonCodes: string[]
  diagnostics: Diagnostic[]
  evidenceRefs: string[]
  failedCriteriaIds: string[]
  contextUpdates: Partial<KernelContext>  // Fields this gate populates
  repairHint?: string
  timestamp: string
  attemptId: string
}
```

## Verdict Propagation Rules

### Short-Circuit Rules

| Condition | Action |
|-----------|--------|
| Any gate FAIL | Pipeline stops immediately. Overall verdict = FAIL. |
| SchemaGate FAIL | Pipeline stops before LockGate. Plan is structurally unsound. |
| EvidenceGate FAIL | Pipeline stops before WiringGate. Evidence cannot be trusted. |
| WiringGate FAIL | Pipeline stops before ExecGate. Wiring is broken — running tests is futile. |
| ExecGate FAIL | Pipeline stops before FinalGate. Commands were unsafe. |
| FinalGate FAIL | Pipeline stops. Human review required. |
| Any gate HOLD | Pipeline continues to next gate (gathers all HOLD reasons) EXCEPT FinalGate HOLD which generates RepairPacket. |

### Exception: HOLD Propagation

Unlike FAIL, HOLD does not short-circuit. This allows the kernel to collect ALL HOLD reasons from all gates in a single run:
- EvidenceGate HOLD → continue to WiringGate → continue to ExecGate → continue to FinalGate
- All HOLD reasons are aggregated into the final report
- If any gate is FAIL, HOLD gates are still aggregated but overall verdict = FAIL

**Why:** Collecting all HOLD reasons in one pass is more efficient than HOLD→repair→rerun→next gate HOLD→repair→rerun cycles.

### Exception: SchemaGate FAIL Stops Immediately

SchemaGate FAIL is special because subsequent gates depend on a valid parsed plan. If the plan cannot be parsed, no gate can operate. This is the only gate with immediate-stop semantics.

## Integration Points

### With @praxis/contracts

- SchemaGate delegates YAML parsing and JSON Schema validation to contracts
- Contracts provides: `validatePlanSpec()`, `hashPlanSpec()`, `readPlanSpecSchema()`
- Contracts types: `PlanSpecV01`, `PlanHashes`, `Diagnostic`, `DiagnosticSeverity`

### With Kernel Types

- Each gate extends `GateVerdict` from existing types.ts
- New types for EvidenceGate, WiringGate, ExecGate, FinalGate are added in their respective modules
- `runKernel()` orchestrates the full 6-gate pipeline (replacing current `runP2Kernel`)

## MVP Scope Boundaries

### In v0.1 (This Design Pack)

- SchemaGate, LockGate (already done)
- EvidenceGate with JSONL evidence ledger
- WiringGate v0.1-lite: static file matching only
- ExecGate with exactAllowedCommands only
- FinalGate with deterministic evidence policy
- RepairPacket as JSON
- ACCP report YAML + summary.md
- CLI (thin orchestrator)
- Plugin bridge (read-only + slash commands)
- Single-session executions only
- YAML evidence for start-of-session snapshots
- JSONL for streaming evidence capture
- Process-level isolation via child_process

### Future v0.2+ (NOT in v0.1)

- Import graph / AST-level wiring analysis
- Multiple execution profiles beyond single_session
- Server/SSE runtime
- PostgreSQL evidence store
- Dashboard UI (beyond CLI)
- Multi-worker orchestration
- Circuit Breaker automation (CB exists as arch but implementation deferred)
- Deterministic Assembler (wave-level apply)

### Future v0.3+ (Not in v0.2 either)

- Messages API fallback (agent loop)
- MiMo / OpenCode worker adapters
- Autonomous repair loop without human review
- Concurrency Governor with dynamic tier scaling
