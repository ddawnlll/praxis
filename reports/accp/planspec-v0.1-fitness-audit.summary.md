# PlanSpec v0.1 Fitness Score Audit — Summary

**Report:** `reports/accp/planspec-v0.1-fitness-audit.accp.yaml`
**Audited file:** `/home/erfolg/src/praxis/planspec.json` (PlanSpec v5-alpha2, 972 lines)
**Mode:** audit_only / report_only — no files mutated. planspec.json SHA-256 unchanged (`3f0def…`).
**Date:** 2026-06-20

---

## Headline

| Metric | Value |
|--------|-------|
| **v0.1 fitness score** | **3.6 / 10** |
| **Advanced / future-format score** | **7.0 / 10** |
| **Verdict** | **HOLD** |
| **Recommended strategy** | **TASK_YAML_PLUS_ADVANCED_PLANSPEC** (extend `task.yaml`; retire planspec.json v5-alpha2 as the v0.1 input) |
| **Implementation may proceed?** | **No** for planspec.json as v0.1 format. **Yes** for `task.yaml` extension *design* (D2, design only). Code still NOT authorized (D4 + human gate). |
| **Acceptance criteria** | **16 / 16 PASS** |

---

## Why 3.6/10 — three structural facts

1. **Wrong lineage / zero overlap.** planspec.json is the Pi P44/v4.11/P45 "PlanSpec v5-alpha2" schema. It shares **zero** field names with PRAXIS's own contracts (`plan_id`, `tasks[]`, `plan_budget`, `human_id`, `criteria_source`, `predicted_interfaces`, `task_id`, `namespace`, `acceptance_criteria`, `required_commands`, `human_approved`, `completion_policy`, `evidence_requirements` — all absent). It carries P44 baggage: `compatibility.v411AdapterRequired`, `p45Bridge`, `migration.legacyFieldsMapped`. It is **not** PRAXIS's `plan-spec.contract.md` PlanSpec.

2. **Forces v0.1-excluded weight.** 17 root fields required, 8 of them heavy multi-worker/runtime concepts ADR-013 excludes from v0.1: `waves[]`, `workspaces[]` (waveId/batchSize/gate), `intent.parallelism` (max 20), `locking`, `compatibility`, `authority`, `enforcementRegistry`, `commands`. A single-session manual verify/repair task cannot be expressed without populating all of them.

3. **Missing the false-done-prevention layer.** No `artifactPolicy`/class, no `integrationContract`, no `wiringRequired`/`reachabilityRequired`, no `declaredUnits`/`entrypoints`/`exportSurfaces`/`integrationPoints`/`runtimeProbes`, no orphan-module detection, no `RepairPacket` schema, no formal gate model (no PASS/HOLD/FAIL enum, no WiringGate), no deterministic-vs-advisory authority model. `acceptanceCriteria` items are `additionalProperties: true` — **unstructured** — so FinalGate's Law-3 core (`human_approved`/`criteria_source`) is not expressible at the schema level.

> The design has **already chosen** `.praxis/task.yaml` as the v0.1 verification input (ADR-013, `praxis-task-yaml.contract.md`, `mvp-v0.1-plugin-first-scope.md`). PlanSpec is only an optional `plan_ref`. So the real gap is **not** "adopt planspec.json" — it is "task.yaml itself lacks the artifact/integration/wiring/repair layer."

---

## Scorecard (v0.1 fitness)

| ID | Dimension | Max | Score |
|----|-----------|-----|-------|
| S1 | Schema correctness & strictness | 1.00 | 0.60 |
| S2 | Plugin-first v0.1 fit | 1.00 | 0.30 |
| S3 | Artifact classification | 1.00 | 0.15 |
| S4 | Wiring & integration contract | 1.25 | 0.15 |
| S5 | Executable evidence & command policy | 1.00 | 0.90 |
| S6 | Acceptance criteria traceability | 1.00 | 0.25 |
| S7 | Gate model support | 1.00 | 0.35 |
| S8 | Repair loop support | 0.75 | 0.10 |
| S9 | Operational simplicity (1-2 day v0.1) | 1.00 | 0.15 |
| S10 | Forward compatibility | 1.00 | 0.60 |
| **Total** | | **10.00** | **3.55 ≈ 3.6** |

Strongest: **S5 (0.90)** — command policy is excellent. Weakest: S8 (0.10), S3/S4/S9 (0.15).

---

## Top 5 gaps

1. **No artifactPolicy / artifact class** — can't distinguish runtime_code from docs/config; can't prevent false-HOLD on docs or false-PASS on unwired code.
2. **No integrationContract / wiring / reachability** — can't express import wiring, entrypoints, exports, runtime probes, orphan detection. The core false-done gap.
3. **acceptanceCriteria is unstructured** — no AC→evidence mapping, no `human_approved`/`criteria_source`; FinalGate's Law-3 core not schema-expressible.
4. **No RepairPacket schema + no formal gate/verdict model** — no PASS/HOLD/FAIL enum, no WiringGate, no failed-criteria-only repair contract in-schema.
5. **Forced multi-worker weight + wrong lineage** — 17 required fields incl. waves/workspaces/locking/compatibility; zero overlap with PRAXIS contracts; P44/v4.11/P45 baggage.

## Top 5 fixes

1. **Confirm `task.yaml` as v0.1 format; extend it** with artifactPolicy + integrationContract + structured-AC-authority + repair. Retire planspec.json v5-alpha2 as the v0.1 input.
2. **Structure acceptanceCriteria** (id/description/verification_method/required_evidence/required/human_approved/criteria_source) + per-AC verification authority (deterministic/canSatisfyFinalGate/advisoryOnly).
3. **Add artifactPolicy** (class enum + class-default wiringRequired) + **integrationContract** (declaredUnits/entrypoints/exportSurfaces/integrationPoints/runtimeProbes) required when wiringRequired.
4. **Add a repair section** (failedCriteriaOnly/mayModifyAcceptanceCriteria:false/allowedFiles/forbiddenFiles/requiredCommands/repairInstructions/reverifyCommand) + a formal gate+verdict model (Evidence→Wiring→Exec→Final → PASS/HOLD/FAIL + reason_codes).
5. **Drop forced multi-worker required fields** from the v0.1 profile (waves/workspaces/locking/compatibility/p45Bridge/parallelism); reserve for the future advanced PlanSpec, **realigned to `plan-spec.contract.md`**.

---

## Score improvement paths

- **→ 8/10:** P-06 (drop multi-worker weight) + P-01 (structured AC + authority) + P-02/P-03 (artifactPolicy + integrationContract) + P-04 (repair) + P-07 (port strong v5 primitives). Expected total ≈ 8.3.
- **→ 9/10:** additionally P-05 (formal WiringGate + verdict/reason_codes) + import_graph/entrypoint_reachability/runtime_probe/orphan_module verification types + P-08 (class-default wiring_required) + HOLD-on-under-specified-runtime_code rule + profile selection (specVersion + profile: lite|full). Expected total ≈ 9.05.

---

## Critical question

> *Can the current PlanSpec express enough machine-checkable intent for PRAXIS to decide whether an LLM-produced change is actually complete?*

**No** — not for the dimensions that matter most. It can express command/evidence intent well (S5=0.9: "did the command run / did tests pass") but **cannot** express artifact class, wiring, reachability, structured AC, human approval, repair, or a formal gate model. It therefore **cannot prevent false PASS on unwired code**, and — without artifactPolicy — **cannot prevent false HOLD on docs/config**. It fails both ends: too heavy for v0.1 *and* missing the advanced false-done layer.

---

## Default wiring_required behavior

| Class | wiringRequired |
|-------|----------------|
| runtime_code | true |
| cli_command | true |
| library_code | consumer_or_export |
| migration | runner_discovery |
| config / schema / script | conditional |
| fixture | optional_or_test_usage |
| test_only / documentation / generated_report | false |

**Missing class → HOLD** (under-specified; do not default true (false-HOLDs docs) or false (false-PASSes code)).

**HOLD on under-specified runtime_code** when: class missing; or class=runtime_code + wiringRequired=true but integrationContract missing; or reachabilityRequired=true but no entrypoints; or executionRequired=true but no runtimeProbes/usageProofs. (HOLD, not FAIL — under-specified, not wrong.)

**Skip wiring checks** when class is non-code (documentation/test_only/config/schema/fixture/generated_report) and wiringRequired is false/conditional-not-triggered.

---

## What `/praxis:init` generates; what `/praxis:verify` requires before PASS

- **`/praxis:init`** → `.praxis/task.yaml` skeleton (minimal extended shape: one example AC + artifactPolicy stub) + `runs/` + `reports/` + optional `config.yaml`. (Not a planspec.json.)
- **`/praxis:verify` PASS requires:** `human_approved: true`; all required AC met with deterministic evidence; runtime_code/cli_command ACs have integrationContract satisfied (wiring+reachability) or explicit `wiringRequired: false` with reason; no empty diff; no zero-tests (when tests required); required commands in command log with exit 0; no namespace violation; no forbidden patterns.

---

## Acceptance criteria: 16/16 PASS

AC-001..AC-016 all PASS. Key evidence: planspec.json read in full; `python -m json.tool` → valid JSON; `jsonschema 4.26.0` Draft202012Validator → meta-schema valid, all 11 `$ref` resolve; scorecard with S1-S10; artifact/integration/wiring gap sections; strategy comparison (OPTION_A/B/C + D); 8/10 and 9/10 paths; minimum viable v0.1 schema defined; report file written; planspec.json and source files not modified (hash unchanged, git clean except new report).

---

## Next prompt (recommended)

> Design the `task.yaml` v0.1 extension: add `artifactPolicy` (class enum + class-default wiringRequired), `integrationContract` (required when wiringRequired/reachabilityRequired/executionRequired), a deterministic-vs-advisory verification authority model per AC, and a `repair` section. Define the WiringGate insertion between EvidenceGate and ExecGate, its HOLD conditions for under-specified runtime_code, and the class-default wiring_required table. Produce a JSON Schema for the extended task.yaml and a PSAG-lite validation rule set. **Design only; no implementation.**
