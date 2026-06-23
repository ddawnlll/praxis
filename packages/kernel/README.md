# @praxis/kernel

PRAXIS Truth Kernel — gate runtime for PlanSpec v0.1 validation pipeline.

## P2 Scope

This package implements the **first two gates** of the Truth Kernel pipeline:

| Gate | Purpose | Status |
|------|---------|--------|
| SchemaGate | Validates PlanSpec YAML form + semantics via `@praxis/contracts` | ✅ P2 |
| LockGate | Creates and verifies `.lock.yaml` files using canonical PlanHashes | ✅ P2 |
| EvidenceGate | Evidence ledger integrity, namespace checks, required evidence mapping | ✅ P3 |
| WiringGate | Import graph analysis, wiring verification | ⏳ P4 |
| ExecGate | Command execution verification | ⏳ P5 |
| FinalGate | Final acceptance criteria satisfaction | ⏳ P6 |

## Installation

```bash
bun install
```

Requires `@praxis/contracts` (linked as local dependency).

## Usage

### Run single gates

```typescript
import { runSchemaGate, runLockGate } from '@praxis/kernel';

// SchemaGate — validates a PlanSpec YAML string
const schemaVerdict = runSchemaGate({
  planYaml: planYamlString,
  repoRoot: '/path/to/repo',
});

if (schemaVerdict.verdict === 'PASS') {
  // schemaVerdict.plan and schemaVerdict.hashes are available
}

// LockGate — verify against existing lock or create one
const lockVerdict = runLockGate({
  plan: schemaVerdict.plan!,
  hashes: schemaVerdict.hashes!,
  lockPath: '.praxis/locks/current.lock.yaml',
  mode: 'create_if_missing',
});
```

### Run P2 pipeline

```typescript
import { runP2Kernel } from '@praxis/kernel';

const result = runP2Kernel({
  planYaml: planYamlString,
  repoRoot: '/path/to/repo',
  lockMode: 'create_if_missing',
});

// result.gateVerdicts = [SchemaGate verdict, LockGate verdict]
// result.ok = true when both gates pass
```

### Lock file helpers

```typescript
import { createPlanLock, readPlanLockYaml, writePlanLockYaml, verifyPlanLock } from '@praxis/kernel';

const lock = createPlanLock(plan, hashes);
writePlanLockYaml(lock, '.praxis/locks/my-plan.lock.yaml');

const readResult = readPlanLockYaml('.praxis/locks/my-plan.lock.yaml');
const verifyResult = verifyPlanLock(currentHashes, readResult.lock!);
```

## Lock file format

Canonical `.lock.yaml` format — never JSON:

```yaml
lockVersion: praxis-plan-lock/v0.1
planSpecVersion: "0.1.0"
kind: ImplementationPlan
profile: praxis-v0.1
planId: PRAXIS-2026-RUNTIME-001
createdAt: "2026-06-20T12:00:00Z"
updatedAt: "2026-06-20T12:00:00Z"
hashes:
  planHash: abc123...
  acceptanceCriteriaHash: def456...
  ...
source:
  schemaPath: schemas/planspec.v0.1.schema.yaml
```

## LockGate modes

| Mode | Behavior |
|------|----------|
| `verify_existing` | Reads existing lock, compares hashes. HOLD if lock missing. |
| `create_if_missing` | Creates lock only if missing. Verifies if exists. |
| `refresh_explicit` | Overwrites lock unconditionally. |

## P3 — EvidenceLedger and EvidenceGate

### EvidenceLedger JSONL

Evidence records are stored in JSONL format (`.jsonl`), one JSON object per line:

```typescript
import {
  readEvidenceLedgerJsonl,
  writeEvidenceLedgerJsonl,
  appendEvidenceRecordJsonl,
  parseEvidenceRecord,
  validateEvidenceLedger,
} from '@praxis/kernel';

// Read a JSONL ledger
const readResult = readEvidenceLedgerJsonl('.praxis/runs/attempt-001/evidence.jsonl');
// readResult.records → EvidenceRecordV01[]
// readResult.diagnostics → parse warnings/errors

// Write a new ledger
writeEvidenceLedgerJsonl('evidence.jsonl', records);

// Append a single record
appendEvidenceRecordJsonl('evidence.jsonl', newRecord);

// Validate records against plan
const validation = validateEvidenceLedger(records, plan, attemptId);
// validation.ok → true if no error diagnostics
// validation.missingRequiredEvidence → missing per-criterion evidence types
// validation.divergenceRecords → divergence records found
```

### Run EvidenceGate

```typescript
import { runEvidenceGate } from '@praxis/kernel';

const evidenceVerdict = runEvidenceGate({
  plan,               // PlanSpecV01 from SchemaGate
  hashes,             // PlanHashes from SchemaGate
  attemptId,          // Current kernel run ID
  evidenceRecords,    // EvidenceRecordV01[]
  changedFiles,       // Optional explicit changed files
});

// evidenceVerdict.verdict → 'PASS' | 'HOLD' | 'FAIL'
// evidenceVerdict.reasonCodes → list of reason codes
// evidenceVerdict.forbiddenFilesTouched → violating files
// evidenceVerdict.namespaceViolations → out-of-bounds files
// evidenceVerdict.diffEmpty → whether diff evidence was found
```

### Run P3 pipeline

```typescript
import { runP3Kernel } from '@praxis/kernel';

const result = runP3Kernel({
  planYaml: planYamlString,
  repoRoot: '/path/to/repo',
  lockMode: 'create_if_missing',
  evidenceRecords: evidenceRecords,
  changedFiles: changedFiles,
});

// result.gateVerdicts = [SchemaGate, LockGate, EvidenceGate]
// result.evidence → EvidenceGateResult with full evidence diagnostics
```

### Evidence record shape

```typescript
interface EvidenceRecordV01 {
  evidenceVersion: 'praxis-evidence/v0.1';
  recordId: string;               // EV-[A-Za-z0-9_.-]+
  attemptId: string;
  planId: string;
  timestamp: string;              // ISO 8601
  type: 'diff' | 'source' | 'test_output' | 'changed_file' | 'divergence_file' | ...;
  source: 'kernel' | 'contracts' | 'hook' | 'cli' | 'agent_claim' | 'manual' | 'test';
  taskId?: string;
  criterionId?: string;
  path?: string;
  changedFile?: { path: string; status: 'added' | 'modified' | 'deleted' | ... };
  summary?: string;
  hash?: string;
  metadata?: Record<string, unknown>;
}
```

### EvidenceGate reason codes

| Code | Verdict | Condition |
|------|---------|-----------|
| `EVIDENCE_PASS` | PASS | All checks pass |
| `EVIDENCE_LEDGER_MISSING` | HOLD | No evidence records provided |
| `DIFF_EMPTY` | HOLD | No changed files for implementation plan |
| `REQUIRED_EVIDENCE_TYPE_MISSING` | HOLD | AC requires evidence not present |
| `DETERMINISTIC_EVIDENCE_MISSING` | HOLD | Only agent_claim records for deterministic AC |
| `EVIDENCE_LEDGER_PARSE_ERROR` | FAIL | Malformed JSONL |
| `ATTEMPT_ID_MISMATCH` | FAIL | Record attemptId ≠ kernel attemptId |
| `PLAN_ID_MISMATCH` | FAIL | Record planId ≠ plan planId |
| `FORBIDDEN_FILE_CHANGED` | FAIL | File matches workspace.forbiddenFiles |
| `CHANGED_FILE_OUTSIDE_ALLOWED_FILES` | FAIL | File outside workspace.allowedFiles |
| `UNKNOWN_TASK_ID` | FAIL | Evidence references non-existent task |
| `UNKNOWN_CRITERION_ID` | FAIL | Evidence references non-existent criterion |
| `UNSUPPORTED_EVIDENCE_TYPE` | FAIL | Type not in requiredEvidenceTypes or bookkeeping |
| `DIVERGENCE_DETECTED` | FAIL | divergence_file/tool/output record present |

## Package boundary

This package is a **library only**. No daemon, no CLI, no plugin. It does NOT:
- Run CLI commands or probes
- Execute diffs or collect filesystem evidence
- Analyze import graphs
- Make HTTP requests

## Testing

```bash
bun test
```

Tests cover: SchemaGate pass/fail, LockGate create/verify/mismatch, EvidenceLedger JSONL read/write/append/validation, EvidenceGate PASS/HOLD/FAIL verdicts, and P2/P3 pipeline ordering and stop behavior.
