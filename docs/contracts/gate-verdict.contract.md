# Gate Verdict Contract

**Status:** Locked — updated for PlanSpec v0.1 `gateVerdict` $def
**Version:** 0.1.0
**Schema reference:** `schemas/planspec.v0.1.schema.yaml` ($defs.gateVerdict)

## Purpose

A GateVerdict is the atomic output of a gate evaluation. Each gate in the 6-gate sequence (SchemaGate→LockGate→EvidenceGate→WiringGate→ExecGate→FinalGate) produces a GateVerdict. The FinalGate PASS is the **sole completion signal** in PRAXIS per Law 1.

## Gate Sequence (v0.1)

| Order | Gate | Question |
|-------|------|----------|
| 1 | SchemaGate | Is the PlanSpec schema-valid? |
| 2 | LockGate | Has the plan been locked, and are hashes unchanged? |
| 3 | EvidenceGate | Does evidence exist? (diff, files, command logs) |
| 4 | WiringGate | Are artifacts wired into the architecture? |
| 5 | ExecGate | Did commands/tests actually run and produce results? |
| 6 | FinalGate | Do results meet human-authored acceptance criteria? |

Only **FinalGate PASS** = attempt complete. Nothing else counts (Law 1).

## GateVerdict Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gateName` | enum | Yes | Which gate produced this verdict (SchemaGate/LockGate/EvidenceGate/WiringGate/ExecGate/FinalGate) |
| `verdict` | enum | Yes | PASS/HOLD/FAIL |
| `reasonCodes` | string[] | Yes | Machine-readable reason codes (minItems:1) |
| `failedCriteriaIds` | string[] | Yes | Failed acceptance criterion IDs (empty for PASS) |
| `evidenceRefs` | string[] | Yes | EvidenceRecord IDs supporting this verdict (minItems:1) |
| `repairHint` | string | No | Human-readable repair hint (HOLD only) |
| `attemptId` | string | Yes | The attempt this verdict evaluates |
| `timestamp` | string | Yes | ISO 8601 timestamp (format: date-time) |

## Verdict Enum

| Verdict | Meaning | Routing |
|---------|---------|---------|
| PASS | Criteria met; proceed to next gate | Next gate in sequence (COMPLETE if FinalGate) |
| HOLD | Incomplete but repairable | RIM builds RepairPacket for next attempt |
| FAIL | Criteria violated; terminal for this attempt | Human review required |

## Verdict Ladder

| EvidenceGate | WiringGate | ExecGate | FinalGate | Overall |
|-------------|-----------|----------|-----------|---------|
| PASS | PASS | PASS | PASS | **PASS** |
| HOLD | PASS | PASS | PASS | HOLD |
| PASS | HOLD | PASS | PASS | HOLD |
| * | FAIL | * | * | **FAIL** |
| * | * | FAIL | * | **FAIL** |
| * | * | * | FAIL | **FAIL** |

Rule: Any FAIL → overall FAIL. Any HOLD without FAIL → HOLD. All PASS → PASS.

## Reason Codes Taxonomy

### SchemaGate

| Code | Verdict |
|------|---------|
| `SCHEMA_INVALID` | FAIL |
| `SCHEMA_MISSING_REQUIRED` | FAIL |
| `SCHEMA_ADDITIONAL_PROPERTIES` | FAIL |

### LockGate

| Code | Verdict |
|------|---------|
| `LOCK_MISSING` | HOLD |
| `LOCK_HASH_MISMATCH` | FAIL |
| `LOCK_CRITERIA_CHANGED_AFTER_LOCK` | FAIL |

### EvidenceGate

| Code | Verdict |
|------|---------|
| `EVIDENCE_EMPTY` | HOLD |
| `DIFF_EMPTY` | HOLD |
| `NAMESPACE_VIOLATION` | FAIL |
| `FILES_CHANGED_MISMATCH` | HOLD |

### WiringGate

| Code | Verdict |
|------|---------|
| `WIRING_DECLARED_UNIT_MISSING` | FAIL |
| `WIRING_EXPORT_MISMATCH` | HOLD |
| `WIRING_ENTRYPOINT_UNREACHABLE` | HOLD |
| `WIRING_ORPHAN_MODULE` | FAIL |
| `WIRING_RUNTIME_PROBE_FAILED` | FAIL |
| `WIRING_REGISTRATION_MISSING` | HOLD |
| `WIRING_NOT_REQUIRED` | — (non-verdict) |

### ExecGate

| Code | Verdict |
|------|---------|
| `TESTS_RAN_ZERO` | HOLD |
| `TESTS_FAILURES` | HOLD |
| `EXIT_CODE_NONZERO` | HOLD |
| `FORBIDDEN_COMMAND` | FAIL |

### FinalGate

| Code | Verdict |
|------|---------|
| `ALL_CRITERIA_MET` | PASS |
| `CRITERIA_PARTIAL` | HOLD |
| `CRITERIA_NONE_MET` | FAIL |
| `CRITERIA_NOT_HUMAN_APPROVED` | FAIL |
| `FILE_NOT_FOUND` | HOLD |

## MUST Rules

1. Only the Truth Kernel produces GateVerdicts.
2. FinalGate PASS is the sole completion signal (Law 1).
3. Every verdict must include at least one reason code.
4. Every verdict must reference at least one evidence record.
5. HOLD verdicts should include a repair hint.
6. Verdicts are appended to the attempt's verdict history.

## MUST NOT Rules

1. Adapters, plugins, UI, hooks, or workers must NOT produce GateVerdicts.
2. No component may override a gate verdict without human action.
3. No confidence field — criteria are deterministic.
4. No auto-retry field — retry is decided by RIM strategy rotation.
