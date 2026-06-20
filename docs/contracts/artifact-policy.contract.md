# Artifact Policy Contract

**Status:** Locked — part of `schemas/planspec.v0.1.schema.yaml`
**Version:** 0.1.0

## Purpose

The `artifactPolicy` defines, per task, what class of artifact is being produced and what verification obligations apply. It prevents false-PASS on unwired runtime code and false-HOLD on documentation/config that correctly has no import wiring.

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `class` | enum | Artifact class (see below) |
| `wiringRequired` | boolean \| string enum | Whether import/wiring is required |
| `reachabilityRequired` | boolean | Whether entrypoint reachability must be proven |
| `executionRequired` | boolean | Whether runtime execution must be proven |
| `deterministicEvidenceRequired` | boolean | Whether only deterministic evidence can satisfy criteria |
| `advisoryReviewAllowed` | boolean | Optional — whether advisory review is acceptable as fallback |

## Artifact Classes

| Class | wiringRequired default | Description |
|-------|----------------------|-------------|
| `runtime_code` | true | Code that runs as part of the application. Must be wired, reachable, executable. |
| `cli_command` | true | CLI command registered in the binary/router. Must be registered, reachable, executable. |
| `library_code` | consumer_or_export | Shared library. Must export public API or prove consumer usage. |
| `test_only` | false | Test file only. No import wiring, but execution is required. |
| `documentation` | false | Documentation file. No import wiring. File existence + content patterns suffice. |
| `config` | conditional | Configuration file. Wiring is conditional on whether it's referenced. |
| `schema` | conditional | Schema file. Wiring is conditional on whether a validator references it. |
| `migration` | runner_discovery | Migration file. Must be discoverable by the migration runner. |
| `script` | conditional | Build/utility script. Wiring is conditional on whether it's callable. |
| `fixture` | optional_or_test_usage | Test fixture. Wiring is optional unless referenced by a test. |
| `generated_report` | false | Generated report. No import wiring. Report is evidence only. |

## Wiring Required String Modes

| String value | Meaning |
|-------------|---------|
| `consumer_or_export` | At least one consumer import OR public export surface must exist |
| `runner_discovery` | The artifact must be discoverable by its runner (e.g., test runner, migration runner) |
| `conditional` | Wiring is required only under specific conditions; needs manual review |
| `optional_or_test_usage` | Wiring is optional; test usage is sufficient |

## False-PASS Prevention

- **`runtime_code` and `cli_command` require `integrationContract`** — the allOf conditional enforces this at schema level. A plan without integrationContract for runtime_code/cli_command is schema-invalid.
- **`runtime_code` and `cli_command` cannot use `integrationContract.mode: "none"`** — wiring cannot be declared absent for code artifacts.

## False-HOLD Prevention

- **`documentation`, `test_only`, `config`, `schema`, `generated_report`, `fixture` with `wiringRequired=false` do NOT require `integrationContract`** — the schema correctly skips the wiring gateway for non-code artifacts.
- **`test_only` with `executionRequired=true` only requires runtimeProbes/usageProofs** — import wiring is not required, but execution evidence is.

## Class-Default Policies (Applied by Kernel)

When the schema does not enforce a default but the kernel interprets policy:

| Class | wiringRequired | reachabilityRequired | executionRequired |
|-------|---------------|---------------------|-------------------|
| runtime_code | true | true | true |
| cli_command | true | true | true |
| library_code | consumer_or_export | false | true |
| test_only | false | false | true |
| documentation | false | false | false |
| config | conditional | false | false |
| schema | conditional | false | false |
| migration | runner_discovery | false | false |
| script | conditional | false | true |
| fixture | optional_or_test_usage | false | false |
| generated_report | false | false | false |

## Missing Artifact Class → HOLD

If `artifactPolicy` is present but `class` is omitted for a task that requires it, the schema rejects the plan at SchemaGate. If `class` is present but an unrecognized value is used, the schema rejects at SchemaGate (enum constraint). The kernel returns HOLD when the artifactPolicy is syntactically valid but semantically under-specified (e.g., class set but no wiring policy declared for a code artifact).
