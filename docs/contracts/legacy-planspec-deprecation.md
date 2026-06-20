# Legacy PlanSpec Deprecation

**Status:** DEPRECATED — preserved for historical reference only
**Canonical replacement:** `schemas/planspec.v0.1.schema.yaml`

## What is `planspec.json`?

The file `planspec.json` at the repository root is **PlanSpec v5-alpha2** (PlanSpec v5 Alpha2 JSON Schema), a P44/v4.11/P45 lineage schema from the pre-pivot Pi project. It is:

- A valid Draft 2020-12 JSON Schema
- A multi-worker orchestration schema with waves, workspaces, locking (workerMustEchoWorkspaceLockHash), compatibility (runtimeContractVersion, v411AdapterRequired), p45Bridge, and parallelism up to 20
- **Not PRAXIS's own PlanSpec** — it shares zero field names with PRAXIS contracts (`plan_id`, `tasks[]`, `plan_budget`, `human_id`, `criteria_source`, `predicted_interfaces`, `human_approved` are all absent)

## What is NOT `planspec.json`?

`planspec.json` is **NOT** the canonical PRAXIS PlanSpec v0.1 schema. It scored **3.6/10** for PRAXIS v0.1 fitness (ACCP audit: `PLANSPEC_V0_1_FITNESS_AUDIT`, verdict **HOLD**).

## What IS the canonical PlanSpec?

`schemas/planspec.v0.1.schema.yaml` — the PRAXIS-native PlanSpec v0.1 schema:

- `kind: ImplementationPlan` (complete P44/v4.11/P45 lineage cleanup)
- `profile: praxis-v0.1`
- `planSpecVersion: 0.1.0`
- 14 root required fields (all justified for single-session v0.1)
- Structured `acceptanceCriterion` with `humanApproved`, `criteriaSource`, `verification` authority model
- `artifactPolicy` with class-specific wiring/reachability/execution requirements
- `integrationContract` with conditional content requirements
- `WiringGate` between EvidenceGate and ExecGate
- `GateVerdict` runtime verdict object
- `repair` with const-locked `failedCriteriaOnly`, `mayModifyAcceptanceCriteria`, `mayModifyPlan`
- `locking` with 7 hashes
- `hardDeniedCommands` as structured objects

## Should `planspec.json` be deleted?

**No.** It is preserved as a historical reference. The schema represents thePi/P44/v4.11/P45 architecture that informed PRAXIS's original design. It is **not** used for PRAXIS v0.1 verification.

## Migration

PRAXIS v0.1 uses `.praxis/task.yaml` (flat human-approved task spec) for verification input and `schemas/planspec.v0.1.schema.yaml` (full ImplementationPlan) for Claude Code execution plans. Neither format is compatible with planspec.json v5-alpha2. No migration adapter is planned.

## Related

- `reports/accp/planspec-v0.1-fitness-audit.accp.yaml` — original audit (score 3.6/10)
- `reports/accp/planspec-v0.1-schema-reanalysis.accp.yaml` — re-analysis audit (score 6.7/10, hardened to ~8.0+)
- `schemas/README.md` — schema index
- `docs/contracts/planspec-v0.1.contract.md` — canonical PlanSpec contract
