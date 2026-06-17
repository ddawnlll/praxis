# RepairPacket Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the RepairPacket contract — the structured instruction set that RIM generates after a gate HOLD/FAIL to guide the next attempt.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

When the Truth Engine returns HOLD or FAIL for an attempt, RIM generates a RepairPacket that becomes part of the next RunAttemptInput. The RepairPacket tells the worker what went wrong, what strategy to apply, and what constraints to follow.

## Scope

- RepairPacket field definitions
- Strategy types and contexts
- RIM generation rules
- Forbidden modifications
- New attempt integration

## Non-Goals

- RIM repair loop flow (see `docs/pipelines/rim-repair-loop.md`)
- Gate verdict format (see `docs/contracts/gate-verdict.contract.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| D-081 | RIM starts only after HOLD/FAIL |
| Law 1 | Agent says done is not done |
| Law 3 | FinalGate criteria from human-authored TaskSpec only |

---

## Conceptual Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repair_packet_id` | string | Yes | Unique identifier for this repair packet |
| `attempt_id` | string | Yes | The attempt that triggered this repair |
| `task_run_id` | string | Yes | The task being repaired |
| `failure_signature` | FailureSignature | Yes | Structured failure analysis |
| `failed_gate` | string | Yes | Which gate: `EvidenceGate` / `ExecGate` / `FinalGate` |
| `failed_criteria_ids` | string[] | Yes | Acceptance criterion IDs that failed (empty for non-FinalGate failures) |
| `evidence_refs` | string[] | Yes | Evidence record IDs relevant to the failure |
| `strategy` | string | Yes | One of: `initial`, `context_expand`, `tool_restrict`, `scope_narrow`, `knowledge_inject`, `hint_inject` |
| `strategy_context` | object | Yes | Strategy-specific parameters |
| `prior_failures` | number | Yes | Count of previous failed attempts (0-based) |
| `active_criterion` | string | No | Single criterion ID for `scope_narrow` strategy |
| `scope_constraints` | string[] | No | Allowed file paths for next attempt (subset of namespace) |
| `prompt_additions` | string | No | Text appended to worker prompt |
| `generated_at` | string | Yes | ISO 8601 timestamp |

### FailureSignature

| Field | Type | Description |
|-------|------|-------------|
| `failure_signature_type` | string | `empty_diff` / `zero_tests` / `criterion_failed` / `namespace_violation` / `missing_evidence` / `ehc_break` / `crash` / `rate_limit` |
| `detail` | string | Human-readable description of what failed |
| `context` | object | Structured data relevant to this failure type |

### Strategy Context by Strategy

| Strategy | Context Fields |
|----------|---------------|
| `initial` | `{ failure_summary: string }` |
| `context_expand` | `{ additional_read_paths: string[], import_graph_depth: number }` |
| `tool_restrict` | `{ read_only_pass: boolean, allowed_tools: string[] }` |
| `scope_narrow` | `{ single_criterion_id: string, narrowed_paths: string[] }` |
| `knowledge_inject` | `{ knowledge_source: string, injected_content: string }` |
| `hint_inject` | `{ hint_source: 'human' / 'docs' / 'pattern', hint_text: string }` |

---

## MUST / MUST NOT Rules

### MUST
- RepairPacket MUST be generated ONLY on HOLD or FAIL gate outcomes
- RepairPacket MUST include all evidence that led to the failure
- Strategy MUST advance according to attempt number progression
- RepairPacket MUST be included in the next RunAttemptInput

### MUST NOT
- RepairPacket MUST NOT modify human-authored acceptance criteria
- RepairPacket MUST NOT expand the task namespace beyond original
- RepairPacket MUST NOT override gate verdicts
- RepairPacket MUST NOT be generated on PASS outcomes

---

## Integration with RunAttempt

The RepairPacket is attached to the next RunAttemptInput:
```
RunAttemptInput {
  ...
  repair_packet: RepairPacket | null  // null on first attempt, present on retries
}
```

---

## Forbidden Authority Fields

This contract must NOT include: `overridden_verdict`, `modified_criteria`, `expanded_namespace`, `auto_pass`

---

## Decision Compliance Checklist

| Decision | Compliant? |
|----------|------------|
| D-081: RIM only after HOLD/FAIL | Yes |
| Law 3: No criteria modification | Yes |
| Law 1: Does not pre-declare completion | Yes |

---

## Open Questions

- Should RepairPacket carry cross-task learning (patterns from other tasks)?
- Should strategy_context be validated against a schema per strategy?
- Should human-authored repair hints be a separate contract?

## Audit Notes

- RepairPacket is the bridge between gate failure and worker retry
- The structured strategy context prevents RIM from generating vague "try again" instructions
