> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** ConflictReport and multi-worker assembly conflict detection are FUTURE scope for v0.1. v0.1 is single-session manual verification. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# ConflictReport Contract

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the ConflictReport contract — produced by the Deterministic Assembler when integration fails, describing what conflicted and suggesting resolution.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

When the Deterministic Assembler cannot safely integrate verified worker outputs (e.g., two workers modified overlapping files, or declared interfaces don't match actual changes), it produces a ConflictReport. This report describes the conflict and feeds into RIM for repair packet generation.

## Scope

- ConflictReport field definitions
- Conflict types
- Resolution strategies
- Integration with RIM and Assembler

## Non-Goals

- Assembler merge logic (see `docs/pipelines/deterministic-assembler.md`)
- Repair packet generation (see `docs/contracts/repair-packet.contract.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| Law 2 | No worker writes shared integration files; Assembler is only shared writer |
| Law 2 | Assembler runs after verified worker outputs |

---

## Conceptual Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conflict_report_id` | string | Yes | Unique identifier |
| `wave_id` | string | Yes | The wave being assembled |
| `conflict_type` | string | Yes | `namespace_overlap` / `signature_mismatch` / `callsite_mismatch` / `semantic_conflict` |
| `affected_task_run_ids` | string[] | Yes | Which tasks' outputs caused the conflict |
| `affected_files` | string[] | Yes | Files where conflicts were detected |
| `signature_mismatches` | SignatureMismatch[] | No | Export/import signature discrepancies |
| `callsite_mismatches` | CallSiteMismatch[] | No | Call site vs definition mismatches |
| `rollback_ref` | string | Yes | Reference to pre-assembly state for rollback |
| `resolution_strategy` | string | Yes | Suggested approach: `reassign_namespace`, `update_interface`, `serialize_tasks`, `human_required` |
| `repair_packet` | object | No | Integrated repair packet for RIM (if resolution is automated) |
| `generated_at` | string | Yes | ISO 8601 timestamp |

### SignatureMismatch

| Field | Type | Description |
|-------|------|-------------|
| `predicted_interface_ref` | string | Which PredictedInterface was declared |
| `actual_export` | string | What was actually exported |
| `expected_export` | string | What was expected |
| `affected_importers` | string[] | Task IDs that depend on this interface |

### CallSiteMismatch

| Field | Type | Description |
|-------|------|-------------|
| `caller_task_id` | string | Task that imports |
| `callee_task_id` | string | Task that exports |
| `called_symbol` | string | The symbol being called/imported |
| `expected_signature` | string | What the caller expects |
| `actual_signature` | string | What the callee provides |

---

## Conflict Types

| Type | Description | Resolution Strategy |
|------|-------------|---------------------|
| `namespace_overlap` | Two workers wrote to the same file | `reassign_namespace` or `serialize_tasks` |
| `signature_mismatch` | Exported interface doesn't match PredictedInterface | `update_interface` (fix exports) or `human_required` |
| `callsite_mismatch` | Caller uses symbol differently than callee provides | `update_interface` or `human_required` |
| `semantic_conflict` | Changes are syntactically clean but logically incompatible | `human_required` |

---

## MUST / MUST NOT Rules

### MUST
- ConflictReport MUST be produced before any partial assembly is applied
- ConflictReport MUST reference rollback state
- ConflictReport MUST identify exactly which files and tasks are in conflict
- Assembler MUST NOT apply partial patches when conflict is detected

### MUST NOT
- Assembler MUST NOT resolve semantic conflicts automatically
- ConflictReport MUST NOT override gate verdicts
- Workers MUST NOT receive ConflictReport directly (goes through RIM)

---

## Forbidden Authority Fields

This contract must NOT include: `auto_resolved`, `forced_merge`, `worker_override`, `skip_verification`

---

## Decision Compliance Checklist

| Decision | Compliant? |
|----------|------------|
| Law 2: Assembler is only shared writer | Yes — report is assembler-produced |
| Law 2: Assembler runs after verification | Yes — conflicts detected during assembly |

---

## Open Questions

- Can signature_mismatch be auto-resolved in simple cases (add missing export)?
- Should ConflictReport include a diff of conflicting changes?
- How to handle triple-overlap (3+ tasks touching same file)?

## Audit Notes

- ConflictReport is the safety mechanism that prevents silent integration failures
- It ensures Law 2 is auditable: if assembly fails, there's a documented reason
