# WiringGate Contract

**Status:** Locked — part of `schemas/planspec.v0.1.schema.yaml`
**Version:** 0.1.0

## Purpose

WiringGate is the 4th gate in the PRAXIS Truth Kernel gate sequence. It verifies that produced artifacts are correctly wired into the architecture, preventing false-PASS where code exists but is disconnected.

## Gate Placement

```
SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate
                     (1)        (2)        (3)       (4)        (5)        (6)
```

WiringGate runs **after** EvidenceGate confirms evidence exists and **before** ExecGate confirms commands/tests ran. This ordering is intentional: wiring must be verified before execution, because unreachable code cannot produce meaningful execution evidence.

## What WiringGate Checks (v0.1)

When a task has `artifactPolicy` with `wiringRequired=true` or `wiringRequired=consumer_or_export` or `wiringRequired=runner_discovery`, WiringGate verifies:

1. **Declared units exist** — each `declaredUnit.path` exists on disk
2. **Expected exports match** — each `declaredUnit.expectedExports` symbol appears in the file
3. **Integration points are wired** — each `integrationPoint` has the expected imports or registration patterns
4. **Entrypoints are reachable** — when `reachabilityRequired=true`, each `entrypoint` can be reached from the declared paths
5. **Runtime probes pass** — when `executionRequired=true`, each `runtimeProbe` produces expected output
6. **No orphan modules** — when `forbiddenOrphanModules=true`, no module exists without a consumer or export

## What WiringGate Cannot Check (v0.1, deferred to kernel implementation)

The schema defines the data WiringGate consumes, but the v0.1 kernel initially implements a subset:

| Check | v0.1 (Schema-level) | v0.1 (Kernel) | Future |
|-------|-------------------|---------------|--------|
| Declared unit exists | Schema enforces structure | `file_exists` verification | Same |
| Expected exports | Schema stores `expectedExports` | `static_pattern` (grep for export) | Language-aware AST |
| Integration points wired | Schema stores `integrationPoints` | `static_pattern` (grep for imports) | Language-aware import graph |
| Entrypoint reachability | Schema stores `entrypoints` | `static_pattern` + `command_output` | True import_graph |
| Runtime probes | Schema stores `runtimeProbes` | ExecGate executes probes | Same |
| Orphan modules | Schema stores `forbiddenOrphanModules` | Not implemented | import_graph |

## WiringGate Verdict Rules

### PASS
- All declared units exist
- All expected exports verified (where applicable)
- All integration points have expected wiring patterns
- All entrypoints are reachable (where required)
- All runtime probes produce expected output
- No orphan modules detected

### HOLD
- Declared units exist but wiring patterns ambiguous
- Static pattern checks inconclusive (needs human review)
- Integration points exist but wiring patterns not definitively matched
- Entrypoint reachability inconclusive from static patterns alone

### FAIL
- Declared unit file does not exist
- Expected export is missing from file
- Integration point is missing at the declared path
- Entrypoint is unreachable
- Runtime probe fails
- Orphan module detected
- `forbiddenOrphanModules=true` and orphan detected with no consumer/export

## WiringGate Reason Codes

| Code | Meaning | Typical Verdict |
|------|---------|----------------|
| `WIRING_DECLARED_UNIT_MISSING` | A declaredUnit path does not exist on disk | FAIL |
| `WIRING_EXPORT_MISMATCH` | An expected export is missing from a declared unit | HOLD |
| `WIRING_ENTRYPOINT_UNREACHABLE` | An entrypoint cannot be reached | HOLD |
| `WIRING_ORPHAN_MODULE` | An orphan module detected when forbidden | FAIL |
| `WIRING_RUNTIME_PROBE_FAILED` | A runtime probe did not produce expected output | FAIL |
| `WIRING_REGISTRATION_MISSING` | A CLI command is not registered in the router | HOLD |
| `WIRING_NOT_REQUIRED` | WiringGate skipped (documentation/test_only) — non-verdict | — |

## WiringGate and Artifact Classes

| Class | WiringGate applies? | Notes |
|-------|-------------------|-------|
| `runtime_code` | Yes | Full wiring checks |
| `cli_command` | Yes | Registration + reachability checks |
| `library_code` | Yes (if wiringRequired) | Export surface or consumer proof |
| `test_only` | No | Execution evidence only; no import wiring |
| `documentation` | No | File existence only; no wiring |
| `config` | Conditional | Only if referenced by a runtime component |
| `schema` | Conditional | Only if a validator references it |
| `migration` | Runner discovery | Migration runner must discover the file |
| `script` | Conditional | Only if callable from bin/scripts |
| `fixture` | No (unless test-referenced) | Optional |
| `generated_report` | No | Evidence only |
