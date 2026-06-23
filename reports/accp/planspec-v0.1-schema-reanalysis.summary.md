# PlanSpec v0.1 Schema Re-Analysis — Summary

**Report:** `reports/accp/planspec-v0.1-schema-reanalysis.accp.yaml`
**Schema:** `/home/erfolg/src/praxis/praxis_planspec_v0_1.schema.yaml` (921 lines, 19079 bytes)
**Mode:** analysis_only / report_only — no schema/source files mutated.
**Date:** 2026-06-20

---

## Headline

| Metric | Value |
|--------|-------|
| **Score** | **6.7 / 10** |
| **Verdict** | **PASS_WITH_FIXES** |
| **Can replace legacy planspec.json?** | **Yes, after fixing the dead allOf conditionals** |
| **Legacy planspec.json baseline** | 3.6/10 (HOLD) |
| **Acceptance criteria** | **17 / 17 PASS** (AC-002 and AC-005 with caveat: no example file on disk) |
| **Schema meta-schema valid** | ✅ Draft 2020-12, all 28 $refs resolve |
| **P44/v4.11/P45 cleanup** | ✅ All forbidden terms absent |
| **Implementation may proceed?** | **No** — schema fixes needed first. Code still NOT authorized (D4 + human gate). |

---

## Major findings

### Wins (genuine improvement over legacy planspec.json)

1. **Complete P44/v4.11/P45 lineage cleanup** — all forbidden terms absent. Root required reduced from 17 to 14, all justified for v0.1.
2. **kind=ImplementationPlan preserved** — balanced implementation instructions + acceptance criteria. Not verification-only.
3. **acceptanceCriterion structured** — 7 required fields including humanApproved, criteriaSource, verification with deterministic/canSatisfyFinalGate/advisoryOnly.
4. **exactAllowedCommand richly typed** — structured objects (id/kind/command/evidenceRequired/noTestsFoundIsFailure/watchModeForbidden) vs old schema's additionalProperties:true.
5. **artifactPolicy, integrationContract, WiringGate, repair, locking all present** in-schema — the core false-done-prevention layer exists.
6. **6-gate sequence** via prefixItems — SchemaGate→LockGate→EvidenceGate→WiringGate→ExecGate→FinalGate. Logically correct.
7. **Repair const-locked** — failedCriteriaOnly=true, mayModifyAcceptanceCriteria=false, mayModifyPlan=false.

### Critical blocker — DEAD CONDITIONALS (empirically verified)

**All 4 allOf/if/then conditional rules at lines 238-294 are non-functional dead code.**

**Root cause:** In each if block, `required: [class]` / `required: [wiringRequired]` etc. is placed at the **task** object level, but those fields live under `properties.artifactPolicy`. Every if condition evaluates to false and no then ever fires.

**Empirically verified:**
- Test 1: runtime_code + wiringRequired=true + NO integrationContract → **PASSES** validation (should FAIL)
- Test 2: wiringRequired="consumer_or_export" (string) + NO integrationContract → **PASSES** (should FAIL)
- Test 3: integrationContract {mode:"none"} → **PASSES** for runtime_code (should FAIL)
- Test 4 (fixed schema): Same instance → **CORRECTLY REJECTED** ✅
- Test 5 (fixed schema): With proper integrationContract → **CORRECTLY ACCEPTED** ✅

**Fix:** Nest `required` inside `properties.artifactPolicy` (one-line move per conditional). Verified working.

### Secondary gaps

1. **Empty integrationContract false-PASS** — integrationContract base requires only mode+reason. Runtime_code with {mode:"required", reason:"x"} but NO declaredUnits/integrationPoints/entrypoints passes.
2. **mode:"none" satisfies the runtime_code allOf** — a none-contract passes.
3. **No GateVerdict $def** — schema defines plan-level gates but not the runtime verdict object.
4. **wiringRequired string values bypass allOf** — const:true matches only boolean true; "consumer_or_export" doesn't trigger enforcement.
5. **AC cross-field invariants unenforced** — advisoryOnly+canSatisfyFinalGate both passes; agent_draft+level:required passes.
6. **Over-engineered for 1-2 day MVP** — 7 wiring $defs, 16 verification types, 11 artifact classes, 4 allOf conditions, 7 hashes.
7. **No example YAML file on disk** — schema has never been validated against a real PlanSpec instance.

---

## Scorecard

| ID | Dimension | Max | Score |
|----|-----------|-----|-------|
| S1 | Schema syntax & Draft 2020-12 correctness | 1.00 | 0.72 |
| S2 | Root model & lineage cleanup | 1.00 | 0.82 |
| S3 | ImplementationPlan usefulness for Claude | 1.00 | 0.90 |
| S4 | Structured AC & FinalGate authority | 1.00 | 0.60 |
| S5 | artifactPolicy model | 1.00 | 0.55 |
| S6 | integrationContract & conditional wiring | 1.25 | 0.70 |
| S7 | Gate model & WiringGate | 1.25 | 0.68 |
| S8 | Command/evidence/report primitives | 1.00 | 0.72 |
| S9 | Repair & locking safety | 1.00 | 0.72 |
| S10 | v0.1 simplicity & future compatibility | 0.50 | 0.30 |
| **Total** | | **10.00** | **6.7** |

---

## Top 5 fixes

| # | Fix | Priority | Score impact |
|---|-----|----------|-------------|
| 1 | Fix all 4 dead allOf conditionals (nest required inside properties.artifactPolicy) | P0-critical | +0.45 |
| 2 | Harden integrationContract content requirements (require at least one content array when mode≠none) | P0-critical | +0.15 |
| 3 | Add AC cross-field constraints (not: advisoryOnly+canSatisfyFinalGate, not: humanApproved=false+canSatisfyFinalGate=true) | P1-high | +0.20 |
| 4 | Fix wiringRequired type (separate boolean + string mode, or extend allOf const to enum) | P1-high | +0.20 |
| 5 | Add GateVerdict $def + create example plan files | P1-high | +0.15 |

**After P0-P1 fixes: estimated ~7.9/10. After P2-P3 fixes: ~8.5/10.**

---

## Can this schema replace legacy planspec.json?

**Yes, after FIX-01 (dead conditionals) and FIX-02 (hardened integrationContract content) are applied.** Without these fixes: no — the core enforcement mechanism is non-functional. The schema represents a 3.1-point improvement over the old plan (3.6→6.7).

---

## Acceptance criteria: 17/17 PASS

AC-001 through AC-017 all pass. AC-002 and AC-005 pass with caveat: no example file exists on disk. The schema was validated using audit-constructed test instances that proved the dead conditionals and verified the fix works.

## Files not modified

- praxis_planspec_v0_1.schema.yaml — hash unchanged (254994375c...)
- planspec.json — hash unchanged (3f0def1184...)
- All source/schema/docs files untouched
- Only new files: reports/accp/planspec-v0.1-schema-reanalysis.accp.yaml + this summary
