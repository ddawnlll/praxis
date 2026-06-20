# Integration Contract

**Status:** Locked — part of `schemas/planspec.v0.1.schema.yaml`
**Version:** 0.1.0

## Purpose

The `integrationContract` defines, per task, how the produced artifacts must be connected to the architecture. It prevents false-PASS where code exists but is not wired.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | enum | Yes | Integration mode (see below) |
| `reason` | string | Yes | Why this integration mode applies |
| `declaredUnits` | DeclaredUnit[] | Conditional | Units declared as produced by this task |
| `integrationPoints` | IntegrationPoint[] | Conditional | Points where produced units integrate |
| `entrypoints` | Entrypoint[] | Required when reachabilityRequired=true | Entrypoints that must be reachable |
| `exportSurfaces` | ExportSurface[] | Conditional | Public API export surfaces |
| `usageProofs` | UsageProof[] | Conditional | Proof that consumers use the artifact |
| `runtimeProbes` | RuntimeProbe[] | Required when executionRequired=true | Runtime probes that prove execution |
| `runnerDiscovery` | RunnerDiscovery[] | Conditional | Runner discovery for migration/script artifacts |
| `forbiddenOrphanModules` | boolean | No | Whether orphan modules are forbidden |

## Mode Enum

| Mode | Meaning |
|------|---------|
| `none` | No integration contract required. **Forbidden for `runtime_code` and `cli_command`.** |
| `required` | Full integration contract required: declaredUnits + integrationPoints minimum |
| `consumer_or_export` | At least consumer import OR export surface must be provided |
| `runner_discovery` | Artifact must be discoverable by its runner |
| `runtime_probe` | Runtime execution probe is sufficient |
| `manual_only` | Manual review only; no automated integration verification |

## Content Requirement

When `mode != "none"`, the integrationContract **must** contain at least one of:

- `declaredUnits` (minItems: 1)
- `integrationPoints` (minItems: 1)
- `exportSurfaces` (minItems: 1)
- `usageProofs` (minItems: 1)
- `runtimeProbes` (minItems: 1)

An integrationContract with `mode: "required"` but **zero** content arrays is schema-invalid.

## When is integrationContract Required?

The schema enforces these conditions via `allOf`:

1. `artifactPolicy.class` is `runtime_code` or `cli_command` → integrationContract required
2. `artifactPolicy.wiringRequired` is `true` (boolean) → integrationContract required
3. `artifactPolicy.wiringRequired` is `"consumer_or_export"` or `"runner_discovery"` (string) → integrationContract required
4. `artifactPolicy.reachabilityRequired` is `true` → integrationContract.`entrypoints` required
5. `artifactPolicy.executionRequired` is `true` → integrationContract.`runtimeProbes` or `usageProofs` required

## When is integrationContract NOT Required?

- `documentation`, `test_only`, `config`, `schema`, `generated_report`, `fixture` with `wiringRequired=false` — no integrationContract needed
- Tasks where integrationContract is not listed in `required` (allOf conditions don't fire)

## Sub-Types

### DeclaredUnit

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unit identifier |
| `path` | string | File path |
| `kind` | enum | Unit kind (runtime_module, library_module, cli_module, test_module, config_file, schema_file, migration_file, script_file, documentation_file, fixture_file) |
| `expectedExports` | string[] | Symbols this unit must export |
| `requiredPatterns` | string[] | Patterns that must appear in the file |
| `language` | string | Programming language |

### IntegrationPoint

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Point identifier |
| `path` | string | File path of the integration point |
| `expectedImports` | string[] | Import statements expected |
| `expectedRegistrationPatterns` | string[] | Registration patterns expected |

### Entrypoint

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Entrypoint identifier |
| `path` | string | Entrypoint path (file or URL) |
| `kind` | string | Entrypoint kind |
| `requiredReachabilityFrom` | string[] | Paths that must reach this entrypoint |

### ExportSurface

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Surface identifier |
| `path` | string | File path |
| `requiredExports` | string[] | Symbols that must be exported (minItems:1) |

### UsageProof

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Proof identifier |
| `commandRef` | string | References `exactAllowedCommand.id` (pattern `^CMD-...`) |
| `expectedOutputPatterns` | string[] | Expected output patterns |
| `proves` | string[] | What this usage proof demonstrates |

### RuntimeProbe

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Probe identifier |
| `commandRef` | string | References `exactAllowedCommand.id` (pattern `^CMD-...`) |
| `expectedOutputPatterns` | string[] | Expected output patterns |
| `expectedExitCode` | integer | Expected exit code |
| `proves` | string[] | What this probe demonstrates |

### RunnerDiscovery

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Discovery identifier |
| `commandRef` | string | References `exactAllowedCommand.id` (pattern `^CMD-...`) |
| `expectedOutputPatterns` | string[] | Expected output patterns |
