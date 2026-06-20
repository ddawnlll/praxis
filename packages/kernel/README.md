# @praxis/kernel

PRAXIS Truth Kernel — gate runtime for PlanSpec v0.1 validation pipeline.

## P2 Scope

This package implements the **first two gates** of the Truth Kernel pipeline:

| Gate | Purpose | Status |
|------|---------|--------|
| SchemaGate | Validates PlanSpec YAML form + semantics via `@praxis/contracts` | ✅ P2 |
| LockGate | Creates and verifies `.lock.yaml` files using canonical PlanHashes | ✅ P2 |
| EvidenceGate | Changed file boundary checks, evidence ledger | ⏳ P3 |
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

Tests cover: SchemaGate pass/fail scenarios, LockGate create/verify/mismatch across all hash fields, planId/version mismatch detection, bad lock YAML, and P2 pipeline ordering/stop behavior.
