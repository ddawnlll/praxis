# TaskSpec Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the TaskSpec contract — the shape and validation rules for a single task within a PRAXIS execution plan. This is the unit of work assigned to a single worker in a single attempt. It is the sole source of acceptance criteria for FinalGate verification.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The TaskSpec is the atomic unit of work in PRAXIS. Every task admitted by PSAG must conform to this contract. The TaskSpec carries the **human-authored acceptance criteria** that the Truth Engine uses to evaluate completion — without these criteria, FinalGate has nothing to verify and the task cannot be admitted.

This contract defines:
- The fields every TaskSpec must have
- The validation rules PSAG applies during admission
- What fields a TaskSpec must NOT contain
- The acceptance criteria sub-structure

---

## Scope

- Defines the shape of a single task within a `PlanSpec`
- Defines the `AcceptanceCriterion` sub-type
- Defines the `TaskBudget` sub-type
- Defines the `PredictedInterface` sub-type
- Defines PSAG-level validation rules for TaskSpec fields
- Defines mutual exclusivity rules for namespaces within a wave

---

## Non-Goals

- How tasks are scheduled (Governor territory)
- How tasks are executed (FSM/Worker territory)
- How acceptance criteria are evaluated (Truth Engine territory)
- Plan-level validation (see `plan-spec.contract.md`)
- Runtime event shapes (see `runtime-event.contract.md`)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-035, D-036 | acceptance_criteria is human-authored only (Law 3) | `criteria_source` MUST be `'human'`; `'generated'` is REJECTED at PSAG |
| D-035 | Agent-generated acceptance criteria are rejected | Echo chamber prevention via `criteria_source` validation |
| D-036 | Missing human-authored acceptance criteria blocks completion | PSAG rejects TaskSpec with empty `acceptance_criteria` |
| D-028 | Worker self-report is not completion | No `worker_reported_verdict` or `self_reported_verdict` field |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | TaskSpec carries criteria; Truth Engine evaluates against them |
| D-108 | Namespace violation must fail | `namespace` defines exclusive file ownership for the worker |

---

## Conceptual Model

```
PlanSpec
  └─ tasks: TaskSpec[]
       ├─ task_id          (unique within plan)
       ├─ wave             (execution ordering group)
       ├─ namespace        (exclusive file paths)
       ├─ acceptance_criteria[]  ← HUMAN-authored only
       │    ├─ id
       │    ├─ description
       │    ├─ verification_type
       │    ├─ verification_detail
       │    └─ required
       ├─ criteria_source  ← MUST be 'human'
       ├─ budget           ← time, token, attempt caps
       ├─ dependencies     ← must complete before this task runs
       └─ predicted_interfaces?  ← for shared_package coordination
```

### Ownership Rules

| Entity | What it owns in TaskSpec |
|--------|--------------------------|
| Human author | `description`, `acceptance_criteria`, `budget`, `dependencies`, `predicted_interfaces` |
| PSAG | Admission: validates all fields, rejects invalid TaskSpecs |
| Truth Engine | Consumption: reads `acceptance_criteria` for FinalGate evaluation |
| Worker | NOTHING — workers do not author or modify TaskSpecs |
| Agent | NOTHING — agents do not define their own criteria |

---

## Field Definitions

### TaskSpec

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `task_id` | string | **Yes** | Unique within the parent plan. Must be a non-empty alphanumeric string with hyphens/underscores. Max 128 chars. |
| `wave` | number | **Yes** | Non-negative integer. Wave 0 runs first. Tasks in the same wave may execute in parallel (subject to Governor). |
| `namespace` | string[] | **Yes** | Non-empty array of file path globs or prefixes. Defines the exclusive file paths this worker owns. No other task in the same wave may have overlapping namespace entries. |
| `task_type` | enum string | **Yes** | One of: `'code'`, `'docs'`, `'test'`, `'shared_package'`. Determines worker selection and namespace isolation strategy. |
| `description` | string | **Yes** | Human-readable description of what the task should accomplish. Min 10 chars, max 4096 chars. |
| `acceptance_criteria` | AcceptanceCriterion[] | **Yes** | Array of at least 1 criterion. At least one must have `required: true`. See sub-type below. |
| `criteria_source` | enum string | **Yes** | MUST be `'human'`. Value `'generated'` causes PSAG rejection. No other values are valid. |
| `budget` | TaskBudget | **Yes** | Time, token, and attempt limits for this task. Total must not exceed plan budget allocation. See sub-type below. |
| `dependencies` | string[] | **Yes** | Array of `task_id` values that must reach COMPLETE state before this task can be queued. May be empty (no dependencies). |
| `predicted_interfaces` | PredictedInterface[] | No | Required only when `task_type` is `'shared_package'`. Describes the anticipated export shape for downstream consumers. See sub-type below. |

### AcceptanceCriterion

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `id` | string | **Yes** | Unique within the parent TaskSpec. Non-empty, max 64 chars. |
| `description` | string | **Yes** | Human-readable description of what this criterion checks. Min 5 chars, max 512 chars. |
| `verification_type` | enum string | **Yes** | One of: `'file_exists'`, `'test_passes'`, `'command_output'`, `'diff_contains'`, `'no_diff_contains'`. Each has specific `verification_detail` semantics. |
| `verification_detail` | string | **Yes** | The concrete check to perform. Interpretation depends on `verification_type`. See verification semantics table below. Min 1 char, max 1024 chars. |
| `required` | boolean | **Yes** | If `true`, this criterion MUST pass for FinalGate PASS. If `false`, failure is advisory (logged but not blocking). At least one criterion in the array must have `required: true`. |

#### Verification Semantics by Type

| `verification_type` | `verification_detail` Meaning | Example Detail |
|---------------------|------------------------------|----------------|
| `file_exists` | File path relative to workspace root, checked post-attempt | `"src/auth/login.ts"` |
| `test_passes` | Test command or pattern; Truth Engine checks exit code 0 | `"npx vitest run src/auth/"` |
| `command_output` | Shell command whose stdout is inspected | `"grep -r 'export function login' src/"` |
| `diff_contains` | String or regex that must appear in the git diff | `"function authenticate"` |
| `no_diff_contains` | String or regex that must NOT appear (e.g., forbidden imports) | `"console.log("` |

### TaskBudget

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `time_limit_ms` | number | **Yes** | Maximum wall-clock time for a single attempt. Must be > 0 and <= plan's per-task time cap. |
| `token_limit` | number | **Yes** | Maximum tokens the worker may consume in one attempt. Must be > 0 and <= plan's per-task token cap. |
| `max_attempts` | number | **Yes** | Maximum repair attempts before ABORT. Must be >= 1 and <= 7 (RIM ceiling). |

### PredictedInterface

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `symbol_name` | string | **Yes** | Name of the exported symbol (function, class, type, constant). Non-empty, max 128 chars. |
| `symbol_kind` | enum string | **Yes** | One of: `'function'`, `'class'`, `'type'`, `'constant'`, `'interface'`. |
| `expected_signature` | string | No | Human-readable description of the expected signature. Used by Assembler for downstream consumer coordination. Max 512 chars. |
| `consuming_tasks` | string[] | **Yes** | Array of `task_id` values that depend on this export. Must reference valid task_ids in the same plan. Min 1 entry. |

---

## Forbidden Authority Fields

The following fields MUST NOT appear in any TaskSpec or sub-type. Their presence is a PSAG rejection signal.

| Forbidden Field | Reason | Governing Decision |
|-----------------|--------|-------------------|
| `generated_acceptance_criteria` | Agents cannot define their own completion criteria. Violates Law 3. | D-035 |
| `agent_decided_completion` | Only Truth Engine decides completion. Violates Law 1. | D-028, D-032 |
| `self_reported_verdict` | Worker self-report is not completion. Violates Law 1. | D-028 |
| `worker_reported_verdict` | Workers do not evaluate their own output. | D-028, D-030 |
| `auto_generated_criteria` | Any form of non-human criteria generation is rejected. | D-035 |
| `ai_authored_acceptance` | Same as above — criteria MUST come from humans. | D-035 |
| `completion_claimed_by` | No field for claiming who completed the task. Completion is determined by gates. | D-032 |
| `override_criteria` | No mechanism to override human-authored criteria at the task level. | D-035 |

---

## Validation Rules (PSAG)

PSAG MUST apply all of the following rules at plan admission time. Any violation causes REJECT.

### Hard Rejections (any single violation → REJECT)

| # | Rule | Decision Reference |
|---|------|-------------------|
| V1 | `criteria_source` MUST equal `'human'` for every task | D-035, D-036 |
| V2 | `acceptance_criteria` MUST be non-empty for every task | D-036 |
| V3 | At least one criterion in `acceptance_criteria` MUST have `required: true` | D-036 |
| V4 | `namespace` MUST be non-empty for every task | D-108 |
| V5 | No two tasks in the same wave may have overlapping namespace entries | D-108 |
| V6 | All `task_id` values in `dependencies` MUST reference valid task_ids in the plan | PSAG validation rule |
| V7 | No `task_id` may depend on itself (no self-referential dependency) | PSAG validation rule |
| V8 | `budget.max_attempts` MUST be >= 1 and <= 7 | RIM ceiling |
| V9 | `budget.time_limit_ms` and `budget.token_limit` MUST be > 0 | PSAG validation rule |
| V10 | No task may contain any forbidden authority field (see section above) | D-028, D-030, D-035 |
| V11 | `verification_type` MUST be a valid enum member | D-032 |
| V12 | `task_type` MUST be a valid enum member | PSAG validation rule |
| V13 | `predicted_interfaces` MUST be present and non-empty when `task_type` is `'shared_package'` | PSAG validation rule |
| V14 | All `consuming_tasks` in `predicted_interfaces` MUST reference valid task_ids | PSAG validation rule |

### Plan-Level Integrations (delegated to PlanSpec PSAG)

| # | Rule | Handled By |
|---|------|-----------|
| V15 | Sum of all task budgets does not exceed plan budget | `plan-spec.contract.md` |
| V16 | No duplicate `task_id` across all tasks | `plan-spec.contract.md` |
| V17 | No circular dependencies across tasks | `plan-spec.contract.md` |

---

## Failure Modes

| Failure | Cause | PSAG Response |
|---------|-------|---------------|
| Empty `acceptance_criteria` | Human author omitted criteria | REJECT with message listing tasks missing criteria |
| `criteria_source: 'generated'` | Agent or tool tried to define its own criteria | REJECT with Law 3 citation |
| Overlapping namespaces | Two tasks in same wave claim same file paths | REJECT with conflict detail (task_a, task_b, overlapping paths) |
| Missing `predicted_interfaces` on `shared_package` | Shared package task has no predicted exports | REJECT with message: shared_package task {id} requires predicted_interfaces |
| Invalid `dependencies` reference | `task_id` in dependencies not found in plan | REJECT with invalid reference details |
| Budget exceeds plan allocation | Task budget sum > plan budget | REJECT (delegated to plan-level validation) |
| Forbidden field present | TaskSpec contains a forbidden authority field | REJECT with field name and governing decision citation |

---

## Test / Gate Implications

| Test Category | What to Test |
|---------------|-------------|
| PSAG happy path | Valid TaskSpec with all required fields passes admission |
| PSAG reject: generated criteria | TaskSpec with `criteria_source: 'generated'` is rejected |
| PSAG reject: empty criteria | TaskSpec with `acceptance_criteria: []` is rejected |
| PSAG reject: no required criterion | TaskSpec where all criteria have `required: false` is rejected |
| PSAG reject: namespace overlap | Two TaskSpecs in same wave with overlapping namespaces are rejected |
| PSAG reject: forbidden field | TaskSpec containing `self_reported_verdict` is rejected |
| PSAG reject: missing predicted_interfaces | `shared_package` task without `predicted_interfaces` is rejected |
| PSAG reject: invalid deps | TaskSpec referencing nonexistent dependency is rejected |
| PSAG reject: self-dependency | TaskSpec depending on its own task_id is rejected |
| FinalGate integration | Truth Engine can read `acceptance_criteria` and evaluate each criterion against evidence |
| False-done detection | Empty diff + `diff_contains` criterion → FinalGate detects mismatch |

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Contract-first development (D-098) | This document is the contract, written before implementation |
| lib/contracts boundary (D-019) | This contract resides in `lib/contracts`; imports no kernel/server/adapters/interface |
| Law 1 — Completion Authority | No field for worker/agent completion claims |
| Law 2 — Write Authority | Namespace isolation defined; no shared write fields |
| Law 3 — Verification Authority | `criteria_source` enforced as `'human'` only |
| Human-authored criteria only (D-035, D-036) | PSAG hard-rejects `'generated'` |
| No agent-defined criteria (D-035) | Forbidden fields list covers this |
| Missing criteria blocks admission (D-036) | Non-empty `acceptance_criteria` enforced |

---

## Conceptual Example

```json
{
  "task_id": "auth-module-impl",
  "wave": 1,
  "namespace": ["src/auth/", "tests/auth/"],
  "task_type": "code",
  "description": "Implement the authentication module with login, logout, and session management. Must handle token refresh and expired sessions.",
  "acceptance_criteria": [
    {
      "id": "ac-1",
      "description": "File src/auth/login.ts must exist after attempt",
      "verification_type": "file_exists",
      "verification_detail": "src/auth/login.ts",
      "required": true
    },
    {
      "id": "ac-2",
      "description": "Auth unit tests must pass",
      "verification_type": "test_passes",
      "verification_detail": "npx vitest run tests/auth/",
      "required": true
    },
    {
      "id": "ac-3",
      "description": "No debug console.log statements in auth code",
      "verification_type": "no_diff_contains",
      "verification_detail": "console.log(",
      "required": false
    }
  ],
  "criteria_source": "human",
  "budget": {
    "time_limit_ms": 300000,
    "token_limit": 200000,
    "max_attempts": 5
  },
  "dependencies": ["types-module-impl"],
  "predicted_interfaces": [
    {
      "symbol_name": "login",
      "symbol_kind": "function",
      "expected_signature": "(credentials: Credentials) => Promise<Session>",
      "consuming_tasks": ["dashboard-impl"]
    },
    {
      "symbol_name": "Session",
      "symbol_kind": "type",
      "expected_signature": null,
      "consuming_tasks": ["dashboard-impl", "api-middleware-impl"]
    }
  ]
}
```

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Should `namespace` use glob syntax, prefix matching, or explicit file list? | OPEN — spike during P0.2 |
| Q2 | Is `max_attempts: 7` the right ceiling, or should it be configurable per plan? | OPEN — RIM ceiling is 7 |
| Q3 | Should `verification_type` support custom/plugin verification types? | OPEN — defer to post-MVP |
| Q4 | How are namespace overlaps detected for glob patterns vs explicit paths? | OPEN — implementation detail for PSAG |

---

## Audit Notes

- This contract directly implements Laws 1 and 3 at the data shape level.
- The forbidden fields section is defensively designed: even if a future tool or agent attempts to inject completion claims into a TaskSpec, PSAG rejection ensures they never reach the kernel.
- `predicted_interfaces` is the mechanism for shared_package coordination — without it, downstream consumers cannot declare dependencies on shared symbols.
- The `required: boolean` on AcceptanceCriterion allows for advisory (non-blocking) quality checks alongside mandatory pass/fail criteria.
- Every validation rule (V1–V14) must have a corresponding PSAG test case before this contract is considered implemented.
