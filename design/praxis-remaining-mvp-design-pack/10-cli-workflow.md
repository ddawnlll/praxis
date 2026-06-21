# CLI Workflow Design

> This document defines the `praxis` CLI command tree, flags, configuration, and user workflow. The CLI is a THIN ORCHESTRATOR — it delegates all gate logic to `@praxis/kernel`, parses flags, reads files, and formats output. It contains NO gate logic itself.

## Design Principle

**The CLI is a view layer.** It does not:
- Validate PlanSpec schema (delegated to `@praxis/contracts` via SchemaGate)
- Verify locks (delegated to LockGate)
- Check evidence (delegated to EvidenceGate)
- Execute commands (delegated to ExecGate)
- Evaluate acceptance criteria (delegated to FinalGate)
- Generate repair packets (delegated to kernel)

The CLI: parses user intent → calls kernel → formats results.

## Command Tree

```
praxis
├── init                    # Initialize PRAXIS in this repository
│   └── --plan <path>       # Path to initial plan YAML
│
├── plan
│   ├── validate            # Validate plan schema + semantics (SchemaGate)
│   │   └── --plan <path>   # Path to plan YAML
│   ├── lock                # Create or update plan lock (LockGate create_if_missing)
│   │   └── --plan <path>
│   └── verify              # Verify lock is current (LockGate verify_existing)
│       └── --plan <path>
│
├── verify                  # Full pipeline: all 6 gates
│   ├── --plan <path>       # Path to plan YAML (default: .praxis/plan.yaml)
│   ├── --run-id <id>       # Resume/check existing run
│   ├── --attempt <n>        # Attempt number (default: 1)
│   ├── --repair <path>     # Apply repair packet from prior attempt
│   └── --out <dir>          # Output directory (default: .praxis/runs/<auto>)
│
├── run                     # Execute plan (agent integration — CLI launches but agent does the work)
│   ├── --plan <path>
│   └── --out <dir>
│
├── repair                  # Repair a failed attempt
│   ├── generate            # Generate repair packet from last failed run
│   │   └── --run-id <id>
│   ├── show                # Show repair packet details
│   │   └── --repair <path>
│   └── apply               # Apply repair packet (outputs instructions for next attempt)
│       └── --repair <path>
│
├── status                  # Show current pipeline status
│   ├── --run-id <id>       # Check specific run
│   └── --plan <path>       # Check plan status
│
├── ledger                  # Evidence ledger inspection
│   ├── show                # Display evidence records
│   │   ├── --run-id <id>
│   │   ├── --kind <kind>   # Filter by kind
│   │   ├── --source <src>  # Filter by source
│   │   ├── --limit <n>     # Max records to show (default: 20)
│   │   └── --json          # Raw JSON output
│   └── verify              # Verify EHC chain integrity
│       └── --run-id <id>
│
├── report                  # Report generation
│   ├── show                # Show latest/completion report
│   │   └── --run-id <id>
│   └── export              # Export report in ACCP YAML format
│       ├── --run-id <id>
│       └── --format <fmt>  # yaml | json | summary (default: yaml)
│
├── config                  # Configuration management
│   ├── show                # Show current configuration
│   ├── set <key> <value>   # Set configuration value
│   └── init                # Create default configuration
│
├── help                    # Show help
└── version                 # Show version
```

## Key Workflows

### Workflow 1: Initial Setup

```bash
# User writes a PlanSpec YAML, then:
praxis init
  → Creates .praxis/ directory structure
  → Creates .praxis/config.yaml with defaults
  → Adds .praxis/ to .gitignore

praxis plan validate --plan my-plan.yaml
  → SchemaGate only
  → Output: PASS/FAIL with diagnostics

praxis plan lock --plan my-plan.yaml
  → SchemaGate → LockGate (create_if_missing)
  → Creates .praxis/locks/current.lock.yaml
```

### Workflow 2: Normal Verify Cycle

```bash
# After agent completes work:
praxis verify --plan my-plan.yaml
  → Full pipeline: SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate
  → Output: per-gate verdicts + overall verdict
  → On PASS: completion report
  → On HOLD: repair packet generated + HOLD report
  → On FAIL: failure report + repair packet

# View report
praxis report show --run-id run-001

# Inspect evidence
praxis ledger show --run-id run-001 --kind diff --limit 5
```

### Workflow 3: Repair Cycle

```bash
# After HOLD:
praxis repair show --run-id run-001
  → Shows RepairPacket: failed gates, criteria, strategy

# Apply repair to next attempt:
praxis verify --plan my-plan.yaml --repair .praxis/repairs/rp-001.json
  → Full pipeline with repair context
  → RepairPacket adds context to ExecGate (narrowed scope)
  → RepairPacket modifies strategy for next attempt
```

### Workflow 4: Status Check

```bash
praxis status --plan my-plan.yaml
  → Shows: lock status, last run, last verdict, run history

praxis status --run-id run-001
  → Shows: gate statuses, evidence count, current phase
```

## Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | PASS — all gates pass |
| 1 | HOLD — some criteria not met |
| 2 | FAIL — pipeline failed |
| 3 | Error — CLI error, file not found, parse error |
| 4 | Invalid usage — bad flags, missing arguments |

## Output Format

### Default (Human-Readable)

```
$ praxis verify --plan my-plan.yaml

╔══════════════════════════════════════════════════════╗
║  PRAXIS Verify — plan-20260620-001                   ║
║  Run: run-001 | Attempt: 1/10                        ║
╚══════════════════════════════════════════════════════╝

 SchemaGate  ✅ PASS          (45ms)
 LockGate    ✅ PASS          (12ms)
 EvidenceGate ✅ PASS          (88ms)  42 records, chain CLEAN
 WiringGate  ✅ PASS          (65ms)  7 units checked
 ExecGate    ⚠️ HOLD          (15.4s) 2/3 commands passed
 FinalGate   ⚠️ HOLD          (23ms)  4/5 criteria passed

 Criteria:
   ✅ AC-001  Auth module exists              (file_exists)
   ⚠️ AC-002  All tests pass                  (test_output) 2/5 failed
   ✅ AC-003  Types exported                   (static_pattern)
   ✅ AC-004  No forbidden dependencies        (no_diff_contains)
   ✅ AC-005  Config schema validates          (schema_validation)

 Repair: .praxis/repairs/rp-001.json
 Strategy: initial

 Overall: HOLD
```

### JSON Format

```bash
praxis verify --plan my-plan.yaml --format json
```

Outputs a JSON object matching the RuntimeReport model.

## Configuration

```yaml
# .praxis/config.yaml
praxis:
  version: "0.1.0"
  
  defaults:
    planPath: ".praxis/plan.yaml"
    outputDir: ".praxis/runs"
    lockPath: ".praxis/locks/current.lock.yaml"
    maxRepairLoops: 10
    
  evidence:
    maxLedgerSize: 100000000  # 100MB soft limit
    captureCommandOutput: true
    maxOutputSize: 10485760    # 10MB per command
    
  display:
    showDiagnostics: false
    verbose: false
    color: auto
    
  paths:
    configDir: ".praxis"
    runsDir: ".praxis/runs"
    locksDir: ".praxis/locks"
    repairsDir: ".praxis/repairs"
    reportsDir: ".praxis/reports"
```

## Directory Structure Created by CLI

```
.praxis/
├── config.yaml              ← CLI configuration
├── plan.yaml                ← Default plan path
├── .gitignore               ← Ignores run artifacts
├── locks/
│   └── current.lock.yaml    ← Plan lock file
├── runs/
│   └── <run-id>/
│       ├── evidence.jsonl
│       ├── diffs/
│       ├── command-output/
│       ├── test-output/
│       ├── snapshots/
│       ├── run.report.yaml
│       └── run.summary.md
├── repairs/
│   └── <repair-id>.json
└── reports/
    ├── <report-id>.report.yaml
    └── <report-id>.summary.md
```

## Implementation Constraints

1. CLI MUST NOT contain any gate logic — all gate logic is in `@praxis/kernel`
2. CLI MUST use `@praxis/kernel`'s `runKernel()` function for pipeline execution
3. CLI MUST format kernel output, not re-process it
4. CLI MUST NOT modify PlanSpec, acceptance criteria, or evidence
5. CLI SHOULD support `--format json` for machine consumption
6. CLI SHOULD support `--silent` for CI usage
7. CLI MUST validate its own flags and arguments before calling kernel
8. CLI MUST return appropriate exit codes
9. CLI MUST be installable via `npm install -g @praxis/cli` in v0.1+ (not yet implemented)
