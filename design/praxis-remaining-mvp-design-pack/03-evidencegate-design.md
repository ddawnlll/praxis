# EvidenceGate v0.1 Design

> This document defines the full design for EvidenceGate — the third gate in the PRAXIS Truth Kernel pipeline. EvidenceGate verifies that execution evidence exists, is trustworthy, and respects namespace boundaries.

## Purpose

EvidenceGate answers: **"Did execution produce verifiable evidence, does it respect boundaries, and can we trust the evidence chain?"**

It is NOT responsible for checking task correctness — that belongs to FinalGate. EvidenceGate is the integrity gate: it ensures that what follows (wiring checks, command execution, acceptance criteria matching) operates on trustworthy data.

## Position in Pipeline

```
SchemaGate → LockGate → [EvidenceGate] → WiringGate → ExecGate → FinalGate
                         ↑ we are here (P3)
```

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| `plan` | SchemaGate/LockGate (carried forward) | Parsed PlanSpec with tasks, artifactPolicy, commands, workspace |
| `evidenceLedgerPath` | CLI/runtime config | Path to `.praxis/runs/<id>/evidence.jsonl` |
| `attemptId` | CLI/runtime | Current attempt identifier |
| `repoRoot` | CLI/runtime | Repository root for resolving relative paths |
| `lockPath` | LockGate | Path to `.lock.yaml` (may contain reference to expected state) |

## EvidenceLedger Format

Evidence is stored in a JSONL file (see [EvidenceLedger Contract](04-evidenceledger-v0.1.contract.yaml) for full schema):

```
.praxis/runs/<run-id>/evidence.jsonl
```

Each line is a JSON object:

```json
{"evidence_id":"evt-001","kind":"diff","source":"git","content_hash":"abc...","timestamp":"2026-06-20T10:00:00Z","content_ref":".praxis/runs/run-001/diffs/001.diff","attempt_id":"attempt-001"}
{"evidence_id":"evt-002","kind":"file_change","source":"filesystem","content_hash":"def...","timestamp":"2026-06-20T10:00:05Z","content_ref":".praxis/runs/run-001/snapshots/002.json","attempt_id":"attempt-001"}
```

## Core Checks (In Order)

### Check 1: EvidenceLedger Exists and is Readable

```
IF evidence.jsonl does not exist:
  → HOLD (EVIDENCE_LEDGER_MISSING)
  → repairHint: "No evidence ledger found. Execute the plan first."
  
IF evidence.jsonl cannot be parsed:
  → HOLD (EVIDENCE_LEDGER_PARSE_ERROR)
  → repairHint: "Evidence ledger is corrupted. Check .praxis/runs/<id>/evidence.jsonl"
```

### Check 2: Evidence is Non-Empty

```
IF total evidence records === 0:
  → HOLD (EVIDENCE_EMPTY)
  → repairHint: "No evidence records found. The agent produced no diff, no command output."
  
IF no 'diff' kind records exist AND plan has code tasks:
  → HOLD (DIFF_EMPTY)
  → repairHint: "No diff evidence for code-generation tasks."
```

### Check 3: Namespace Compliance

For each file change evidence record, verify the file is within the plan's `workspace.allowedFiles` and not in `workspace.forbiddenFiles`:

```
FOR EACH evidenceRecord.kind IN ['file_change', 'diff']:
  extract changed file paths
  IF any changed file is NOT in workspace.allowedFiles:
    → FAIL (NAMESPACE_VIOLATION, file path)
    → repairHint: "File changed outside allowed namespace: <path>"
  IF any changed file IS in workspace.forbiddenFiles:
    → FAIL (FORBIDDEN_FILE_MUTATED, file path)
    → repairHint: "Forbidden file was modified: <path>"
```

**Allowed files matching:** A file is considered "in allowed namespace" if:
- The path matches any `workspace.allowedFiles` pattern (exact match or glob prefix)
- AND does NOT match any `workspace.forbiddenFiles` pattern

### Check 4: Diff Evidence Exists Per Code Task

For tasks with `artifactPolicy.class` in `[runtime_code, cli_command, library_code, script]`:

```
FOR EACH task WHERE class IN [runtime_code, cli_command, library_code, script]:
  IF no 'diff' evidence record covers this task's allowedFiles:
    → HOLD (DIFF_EMPTY_FOR_TASK, task.id)
    → repairHint: "Task <id> produced no diff. Code-generation tasks must produce changes."
```

**Exception:** Tasks with `artifactPolicy.class: documentation` or `test_only` may produce empty diffs without triggering HOLD.

### Check 5: EHC Chain Integrity (v0.1-lite)

In v0.1, EvidenceGate performs a simplified chain integrity check:

```
IF evidence records have chain_hash field:
  verify chain_hash integrity (sha256 chain)
  IF break detected:
    → classification = classifyBreak(mismatchCount)
    IF classification === 'CONFIRMED':
      → FAIL (EHC_CHAIN_BROKEN)
    IF classification === 'SUSPECTED':
      → HOLD (EHC_CHAIN_SUSPECTED)
    IF classification === 'NOISE':
      → PASS with warning (EHC_CHAIN_NOISE)
```

**Note:** Full EHC implementation (chain construction, classification thresholds) is part of the EvidenceLedger module. EvidenceGate consumes the classification result, not the raw chain.

### Check 6: Task-Level Evidence Coverage (v0.1-lite)

```
FOR EACH task.acceptanceCriteria:
  FOR EACH criterion.requiredEvidence:
    IF requiredEvidence type NOT present in evidence ledger:
      → HOLD (MISSING_REQUIRED_EVIDENCE, criterion.id)
```

## Outputs

### EvidenceGateResult

```
interface EvidenceGateResult {
  gateName: 'EvidenceGate'
  verdict: 'PASS' | 'HOLD' | 'FAIL'
  reasonCodes: string[]
  diagnostics: Diagnostic[]
  failedCriteriaIds: string[]
  evidenceRefs: string[]
  repairHint?: string
  
  // Context passed forward
  contextUpdates: {
    evidenceLedgerPath: string
    evidenceRecords: EvidenceRecord[]
    chainIntegrity: 'CLEAN' | 'NOISE' | 'SUSPECTED' | 'CONFIRMED'
    namespaceCompliant: boolean
    diffEmpty: boolean
    forbiddenFilesTouched: string[]
    taskEvidenceCoverage: Record<string, boolean>  // taskId → has evidence
  }
  
  timestamp: string
  attemptId: string
}
```

## Reason Codes

| Code | Verdict | Condition |
|------|---------|-----------|
| `EVIDENCE_PASS` | PASS | All checks pass |
| `EVIDENCE_LEDGER_MISSING` | HOLD | No evidence.jsonl found |
| `EVIDENCE_LEDGER_PARSE_ERROR` | HOLD | JSONL parse failure |
| `EVIDENCE_EMPTY` | HOLD | Zero evidence records |
| `DIFF_EMPTY` | HOLD | No diff records for code tasks |
| `DIFF_EMPTY_FOR_TASK` | HOLD | Specific task has no diff |
| `NAMESPACE_VIOLATION` | FAIL | File changed outside allowed namespace |
| `FORBIDDEN_FILE_MUTATED` | FAIL | Forbidden file was modified |
| `EHC_CHAIN_BROKEN` | FAIL | Evidence hash chain has CONFIRMED break |
| `EHC_CHAIN_SUSPECTED` | HOLD | Evidence hash chain has SUSPECTED break |
| `EHC_CHAIN_NOISE` | PASS | Evidence hash chain has NOISE (warning) |
| `MISSING_REQUIRED_EVIDENCE` | HOLD | Required evidence type missing for criterion |

## Verdict Ladder

```
All checks PASS                              → PASS
Evidence exists but has NOISE in chain       → PASS (with warning)
Evidence exists but DIFF_EMPTY for doc tasks → PASS (acceptable)
Evidence exists but EVIDENCE_EMPTY           → HOLD
Evidence exists but DIFF_EMPTY for code task → HOLD
Missing required evidence type               → HOLD
EHC chain SUSPECTED                          → HOLD
NAMESPACE_VIOLATION                          → FAIL
FORBIDDEN_FILE_MUTATED                       → FAIL
EHC chain CONFIRMED break                    → FAIL
```

## HOLD vs FAIL Semantics

| Verdict | Meaning | Recovery |
|---------|---------|----------|
| PASS | Evidence exists, namespace clean, chain intact | Proceed to WiringGate |
| HOLD | Evidence exists but incomplete or suspicious | Repair: improve evidence capture, widen scope, or retry execution |
| FAIL | Evidence cannot be trusted or boundaries violated | Human review required. Evidence integrity compromised. |

HOLD means "we have partial evidence but cannot proceed with confidence."  
FAIL means "evidence integrity is broken — do not trust any downstream gate results."

## Advisory Evidence Rules

Evidence with `source: 'llm_advisory'` or `kind: 'llm_advisory'` is treated specially:

- Advisory evidence IS counted for EvidenceGate's evidence-exists check
- Advisory evidence can produce PASS for EvidenceGate
- BUT advisory evidence alone cannot produce FinalGate PASS (see FinalGate design)
- EvidenceGate notes advisory-only criteria in context for downstream gates

## Example Scenarios

| Scenario | Result |
|----------|--------|
| Agent produced diff + test output, all files in namespace | PASS |
| Agent ran but produced empty diff (doc task) | PASS (with warning) |
| Agent produced diff but no test output | HOLD (missing required evidence) |
| Agent changed files outside workspace.allowedFiles | FAIL (namespace violation) |
| Agent modified a forbidden file | FAIL (forbidden file mutated) |
| Evidence ledger is missing | HOLD (nothing to verify) |
| Evidence chain has hash mismatch | Variable (NOISE→PASS, CONFIRMED→FAIL) |
| Agent claims done but no EvidenceLedger at all | HOLD (EVIDENCE_EMPTY) |

## Relationship to Other Gates

| Gate | How EvidenceGate Feeds It |
|------|--------------------------|
| WiringGate | EvidenceGate confirms files exist before Wiring checks them |
| ExecGate | EvidenceGate's command evidence records are consumed by ExecGate |
| FinalGate | EvidenceGate provides the full evidence record store for AC matching |
| Circuit Breaker | CONFIRMED EHC break (EvidenceGate check) feeds CB OPEN trigger |
| Repair | EvidenceGate's HOLD/FAIL identifies which evidence is missing |

## Implementation Guidance

### File Structure (for P3 implementation)

```
packages/kernel/src/
  gates/
    evidenceGate.ts          ← main gate logic
  evidence/
    evidenceLedger.ts        ← JSONL reader/parser
    evidenceChainVerifier.ts ← EHC integrity check
    namespaceChecker.ts      ← allowed/forbidden file check
    diffAnalyzer.ts          ← diff-empty detection
  types.ts                   ← extend with EvidenceGate types
  diagnostics.ts             ← add EvidenceGate reason codes
  runKernel.ts               ← wire into pipeline (replaces runP2Kernel)
```

### Key Constraints

1. EvidenceGate MUST NOT evaluate acceptance criteria — that is FinalGate's job
2. EvidenceGate MUST NOT run commands — that is ExecGate's job
3. EvidenceGate MUST be stateless — no caching across attempts
4. EvidenceGate MUST be deterministic — same evidence → same verdict always
5. EvidenceGate MUST produce at least one evidenceRef per verdict
6. EvidenceGate MUST verify namespace compliance against plan.workspace — not against filesystem
7. EvidenceGate MUST NOT crash on malformed evidence records — emit HOLD, not exception
