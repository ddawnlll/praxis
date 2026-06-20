# PRAXIS Schemas

This directory contains canonical JSON Schema definitions for PRAXIS.

## PlanSpec v0.1

**File:** `planspec.v0.1.schema.yaml`
**Version:** 0.1.0
**Profile:** `praxis-v0.1`
**Kind:** `ImplementationPlan`
**JSON Schema Draft:** 2020-12

The PlanSpec v0.1 schema is the PRAXIS-native implementation plan format. It serves
dual purpose:

1. **Implementation instructions for Claude Code** — tasks with `implementation.instructions`, suggested steps, anti-patterns, dependencies, and expected outputs.
2. **Verification contract for PRAXIS Truth Kernel** — artifactPolicy, integrationContract, acceptanceCriteria, commands, evidence, gates (SchemaGate→LockGate→EvidenceGate→WiringGate→ExecGate→FinalGate), repair constraints, locking hashes, and ACCP reports.

### Identity

| Field | Value |
|-------|-------|
| `planSpecVersion` | `"0.1.0"` |
| `kind` | `"ImplementationPlan"` |
| `profile` | `"praxis-v0.1"` |

### Key rules

- Every task requires `artifactPolicy` with class, wiringRequired, reachabilityRequired, executionRequired.
- `runtime_code` and `cli_command` require `integrationContract`.
- `integrationContract.mode != "none"` requires at least one content array (declaredUnits, integrationPoints, exportSurfaces, usageProofs, runtimeProbes).
- `runtime_code` and `cli_command` cannot use `integrationContract.mode: "none"`.
- `acceptanceCriterion` cannot have both `verification.advisoryOnly: true` and `verification.canSatisfyFinalGate: true`.
- `humanApproved: false` cannot satisfy FinalGate (`canSatisfyFinalGate: true` blocked).
- `commandRef` fields must match `^CMD-[A-Za-z0-9_.-]+$` (reference `exactAllowedCommand.id`).
- `reports.repairPacketRequiredOnHoldOrFail: true` requires `repair.enabled: true`.

### Legacy

The old `planspec.json` (PlanSpec v5-alpha2, Pi P44/v4.11/P45 lineage) is preserved
at the repository root as a historical reference. It is **not** the canonical PRAXIS
v0.1 schema. See `docs/contracts/legacy-planspec-deprecation.md`.

### Related

- Examples: `../examples/planspec/`
- Fixtures: `../fixtures/planspec/`
- Contracts: `../docs/contracts/`
- Validation: `../scripts/validate-planspec-v0.1.py`
