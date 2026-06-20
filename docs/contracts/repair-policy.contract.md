# Repair Policy Contract

**Status:** Locked — part of `schemas/planspec.v0.1.schema.yaml`
**Version:** 0.1.0

## Purpose

The repair policy defines what PRAXIS may and may NOT do when an attempt returns HOLD or FAIL. It constrains repair to failed criteria only, prevents scope expansion, protects human-authored acceptance criteria, and ensures every repair attempt is re-verified.

## Schema Fields (PlanSpec-level)

| Field | Type | Const/Constraint | Description |
|-------|------|-----------------|-------------|
| `enabled` | boolean | — | Whether repair is enabled. Must be `true` when `reports.repairPacketRequiredOnHoldOrFail=true`. |
| `failedCriteriaOnly` | boolean | `true` | Repair targets only failed criteria |
| `mayModifyAcceptanceCriteria` | boolean | `false` | Repair must NOT modify acceptance criteria (Law 3) |
| `mayModifyPlan` | boolean | `false` | Repair must NOT modify the plan |
| `allowedFilesFromFailedTasksOnly` | boolean | — | Repair scope restricted to files in failed tasks |
| `maxRepairLoops` | integer | 0-10 | Maximum repair attempts before ABORT |
| `reverifyCommand` | string | — | Command to re-run verification after repair |
| `repairPacketFormat` | object | — | Output formats: json + markdown |

## Repair Const Locks

1. **`failedCriteriaOnly: true`** — Repair cannot add, remove, or reorder criteria. Only addresses what already failed.
2. **`mayModifyAcceptanceCriteria: false`** — Law 3 enforcement at repair level.
3. **`mayModifyPlan: false`** — Plan scope is immutable once locked.

## Repair-Report Consistency

Root `allOf`: if `reports.repairPacketRequiredOnHoldOrFail=true`, then `repair.enabled` must be `true`.

## RepairPacket (Runtime Output)

| Field | Type | Description |
|-------|------|-------------|
| `repair_packet_id` | string | Unique identifier |
| `attempt_id` | string | Attempt that triggered repair |
| `task_run_id` | string | Task being repaired |
| `failed_gate` | string | Which gate failed |
| `failed_criteria_ids` | string[] | Failed criterion IDs |
| `evidence_refs` | string[] | Evidence records |
| `strategy` | string | initial/context_expand/tool_restrict/scope_narrow/knowledge_inject/hint_inject |
| `strategy_context` | object | Strategy-specific parameters |
| `scope_constraints` | string[] | Allowed file paths (subset of namespace) |
| `prompt_additions` | string | Text appended to worker prompt |
| `generated_at` | string | ISO 8601 timestamp |

## MUST NOT

- Modify human-authored acceptance criteria
- Modify the plan (tasks, artifactPolicy, integrationContract, files)
- Expand namespace beyond original
- Override gate verdicts
- Generate on PASS outcomes
- Set `human_approved: true` (human-only)
