# @praxis/contracts

PRAXIS PlanSpec v0.1 canonical parser, validator, hasher, and fixture runner.

## Overview

`@praxis/contracts` is the canonical TypeScript package for working with PRAXIS PlanSpec v0.1 YAML files. It provides:

- **YAML parsing** — load and parse `.plan.yaml` files
- **Schema validation** — validate against the locked `planspec.v0.1.schema.yaml` (Draft 2020-12)
- **Semantic validation** — cross-reference checks not expressible in JSON Schema
- **Canonicalization and hashing** — deterministic SHA-256 hashes for plan integrity
- **Fixture runner** — validate examples and fixtures against expectations

## Installation

```bash
# From the packages/contracts directory
bun install
```

## Usage

### Quick validation pipeline

```typescript
import { validatePlanSpec } from '@praxis/contracts';
import { readFileSync } from 'node:fs';

const yaml = readFileSync('my-plan.plan.yaml', 'utf-8');
const result = validatePlanSpec(yaml, '/path/to/repo');

if (result.ok) {
  console.log('Plan is valid!');
  console.log('Plan hash:', result.hashes?.planHash);
} else {
  console.error('Validation errors:', result.errors);
}
```

### Load from file (with schema validation)

```typescript
import { loadPlanSpecYaml } from '@praxis/contracts';

const result = loadPlanSpecYaml('./examples/planspec/runtime-code.plan.yaml');
if (result.ok) {
  // result.plan is a typed PlanSpecV01
  console.log(result.plan.metadata.title);
}
```

### Run the fixture suite

```typescript
import { runPlanSpecFixtureSuite } from '@praxis/contracts';

const suite = runPlanSpecFixtureSuite('/path/to/repo');
console.log(`${suite.passed}/${suite.total} fixtures passed`);
```

## Public API

| Export | Description |
|--------|-------------|
| `parsePlanSpecYaml` | Parse a YAML string to unknown object |
| `readPlanSpecSchema` | Load the canonical schema from disk |
| `validatePlanSpecSchema` | Validate object against the schema |
| `validatePlanSpecSemantics` | Cross-reference semantic checks |
| `validatePlanSpec` | Full pipeline: parse → schema → semantic → hash |
| `canonicalizePlanSpec` | Deterministic JSON canonicalization |
| `hashPlanSpec` | SHA-256 hashes for plan integrity |
| `loadPlanSpecYaml` | File read + parse + schema validate |
| `runPlanSpecFixtureSuite` | Validate all examples and fixtures |

## Package boundary

This package handles **parsing, validation, and hashing only**. It does NOT implement:
- Truth Kernel gate execution
- CLI commands
- Claude plugin integration
- Real command execution
- Filesystem diff/evidence logic

Those belong to `@praxis/kernel` and `@praxis/cli` (not yet implemented).

## Testing

```bash
bun test
```

Tests cover: YAML parsing, schema loading, schema validation of all examples/fixtures, semantic validation (duplicate IDs, missing refs, authority checks), hashing determinism, and the fixture suite runner.
