# PlanSpec v0.1 Contract

**Status:** Locked — `schemas/planspec.v0.1.schema.yaml`
**Version:** 0.1.0
**Profile:** `praxis-v0.1`
**Kind:** `ImplementationPlan`
**JSON Schema Draft:** 2020-12

## Purpose

The PlanSpec v0.1 is a PRAXIS-native ImplementationPlan. It serves dual purpose:

1. **Implementation instructions for Claude Code** — tasks with `implementation.instructions`, suggested steps, anti-patterns, dependencies, and expected outputs.
2. **Verification contract for PRAXIS Truth Kernel** — artifactPolicy, integrationContract, structured acceptanceCriteria with human-approved FinalGate authority, commands, evidence ledger, gates (SchemaGate→LockGate→EvidenceGate→WiringGate→ExecGate→FinalGate), repair constraints, locking hashes, and ACCP reports.

## Root Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `planSpecVersion` | const `"0.1.0"` | Yes | Schema version |
| `kind` | const `"ImplementationPlan"` | Yes | Plan kind |
| `profile` | const `"praxis-v0.1"` | Yes | Execution profile |
| `metadata` | Metadata | Yes | Plan identity (planId, title, description, createdAt, humanId, status) |
| `authority` | Authority | Yes | Completion authority declaration |
| `workspace` | Workspace | Yes | File scope: root, allowedFiles, forbiddenFiles |
| `execution` | Execution | Yes | Execution mode (single_session, claude-code) |
| `tasks` | Task[] | Yes | Implementation tasks (minItems:1) |
| `commands` | Commands | Yes | Command policy: allowed, denied, validation rules |
| `evidence` | Evidence | Yes | Evidence ledger requirements |
| `gates` | Gates | Yes | Gate sequence and verdict model |
| `repair` | Repair | Yes | Repair constraints |
| `locking` | Locking | Yes | Lock and hash requirements |
| `reports` | Reports | Yes | ACCP report protocol |

## Claude consumes (implementation)

- `tasks[].implementation.instructions` — required, minItems:1
- `tasks[].implementation.suggestedSteps`, `antiPatterns`, `dependencies`, `expectedOutputs`
- `execution.mode`, `execution.agent`, `execution.autonomy`
- `workspace.allowedFiles`, `workspace.forbiddenFiles`

## PRAXIS Truth Kernel consumes (verification)

- `tasks[].artifactPolicy` — class, wiringRequired, reachabilityRequired, executionRequired, deterministicEvidenceRequired
- `tasks[].integrationContract` — mode, reason, declaredUnits, integrationPoints, entrypoints, exportSurfaces, usageProofs, runtimeProbes, runnerDiscovery
- `tasks[].acceptanceCriteria` — structured AC with `humanApproved`, `criteriaSource`, `verification` (deterministic, canSatisfyFinalGate, advisoryOnly)
- `commands.exactAllowedCommands` — structured command objects with `noTestsFoundIsFailure`, `watchModeForbidden`
- `evidence.ledgerRequired`, `evidence.requiredEvidenceTypes`
- `gates.sequence` — SchemaGate→LockGate→EvidenceGate→WiringGate→ExecGate→FinalGate
- `repair.failedCriteriaOnly`, `repair.mayModifyAcceptanceCriteria`, `repair.mayModifyPlan`
- `locking.hashes` — 7 hash slots

## v0.1 Profile Boundary

- execution.mode: `single_session` only
- execution.agent: `claude-code` only
- No waves, no workspaces (multi-worker), no parallelism, no governor, no assembler, no server/runtime
- Import_grapgh and orphan-module detection are optional verification types; not required for v0.1 MVP

## Advanced Profile (deferred to future)

- `profile: praxis-future` — waves[], workspaces[], parallelism, governor, assembler, server/runtime, multi-worker orchestration, advanced verification types (import_graph, entrypoint_reachability, orphan_module)
