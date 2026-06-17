# PlanSpec Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the PlanSpec contract — the shape, validation rules, and PSAG admission criteria for a complete PRAXIS execution plan. A PlanSpec bundles multiple TaskSpecs into a coordinated execution plan with budgeting, phasing, and dependency ordering.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The PlanSpec is the top-level execution unit in PRAXIS. It defines:
- **What** tasks need to be done (via embedded `TaskSpec[]`)
- **In what order** (via waves and dependencies)
- **With what budget** (aggregate time, tokens, concurrency)
- **Who authored it** (human attribution, criteria source verification)

PSAG validates every PlanSpec before any work begins. A PlanSpec that fails PSAG admission is never queued, never executed, and never reaches a worker.

---

## Scope

- Defines the shape of a complete execution plan
- Defines `PlanBudget` sub-type
- Defines PSAG-level admission checks for plans
- Defines namespace partition rules across all tasks in the plan
- Defines dependency graph validation (no cycles)
- References `TaskSpec` contract for per-task validation (see `task-spec.contract.md`)

---

## Non-Goals

- How plans are authored (human via editor/CLI, not agent-generated)
- How waves are scheduled at runtime (FSM + Governor territory)
- How tasks are dispatched to workers (adapter territory)
- ACCP compilation of plans (accp-compiler territory)
- Runtime event emission (see `runtime-event.contract.md`)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-035, D-036 | acceptance_criteria is human-authored only (Law 3) | PSAG checks every task's `criteria_source === 'human'`; empty criteria rejected |
| D-035 | Agent-generated acceptance criteria are rejected | Plan-level check: if any task has `generated` criteria, entire plan is REJECTED |
| D-036 | Missing human-authored acceptance criteria blocks completion | PSAG rejects plan if any task has empty criteria |
| D-028 | Worker self-report is not completion | PlanSpec has no completion claim fields |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | PlanSpec defines criteria; Truth Engine evaluates |
| D-108 | Namespace violation must fail | PSAG checks namespace non-overlap within each wave |
| D-111 | Parallel work requires namespace ownership | Wave-level namespace partitioning enforces this |
| D-052 | P-1 through P6 canonical phase model | PlanSpec `phases` field maps to execution phases, not PRAXIS project phases |

---

## Conceptual Model

```
┌─────────────────────────────────────────────────────┐
│                     PlanSpec                         │
│                                                     │
│  plan_id        (unique plan identifier)            │
│  title          (human-readable name)               │
│  description    (what this plan achieves)           │
│  phases?        (optional grouping for large plans) │
│  waves          (how many execution waves)          │
│  tasks[]        (all TaskSpecs in this plan)         │
│  plan_budget    (aggregate resource limits)          │
│  human_id       (who authored the plan)             │
│  criteria_source ('human' enforced)                 │
│                                                     │
│               ▼ PSAG Admission Gate                 │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  PSAG Checks:                               │    │
│  │  • All tasks have human-authored criteria   │    │
│  │  • No duplicate task_ids                    │    │
│  │  • No circular dependencies                 │    │
│  │  • Namespace partitions non-overlapping     │    │
│  │  • Plan budget covers sum of task budgets   │    │
│  │  • Shared packages declare interfaces       │    │
│  │  • No forbidden authority fields            │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Result: ADMIT | REJECT (with violation details)    │
└─────────────────────────────────────────────────────┘
```

---

## Field Definitions

### PlanSpec

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `plan_id` | string | **Yes** | Globally unique plan identifier. Non-empty alphanumeric with hyphens/underscores. Max 128 chars. |
| `title` | string | **Yes** | Human-readable plan title. Min 5 chars, max 256 chars. |
| `description` | string | **Yes** | Human-readable description of what the plan achieves. Min 20 chars, max 8192 chars. |
| `phases` | number | No | Optional grouping for very large plans. If present, must be >= 1. A phase groups consecutive waves for organizational purposes. PSAG does not enforce phase-level gate logic — it is a human readability feature. |
| `waves` | number | **Yes** | Total number of execution waves in the plan. Must be >= 1. Must equal the maximum `wave` value across all tasks plus 1 (or be larger, allowing empty terminal waves). |
| `tasks` | TaskSpec[] | **Yes** | Array of all tasks in the plan. Must be non-empty. Each task must conform to the `TaskSpec` contract (see `task-spec.contract.md`). |
| `plan_budget` | PlanBudget | **Yes** | Aggregate resource limits covering all tasks. See sub-type below. |
| `human_id` | string | **Yes** | Identifies the human who authored the plan. Non-empty string. Used for audit trail and human action routing. |
| `criteria_source` | enum string | **Yes** | MUST be `'human'`. Value `'generated'` causes PSAG rejection. Value `'agent'` causes PSAG rejection. No other values are valid. |

### PlanBudget

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `total_time_limit_ms` | number | **Yes** | Maximum total wall-clock time across all tasks and attempts. Must be >= sum of all task `time_limit_ms * max_attempts`. Must be > 0. |
| `total_token_limit` | number | **Yes** | Maximum total tokens across all workers and attempts. Must be >= sum of all task `token_limit * max_attempts`. Must be > 0. |
| `max_concurrent_workers` | number | **Yes** | Ceiling on how many workers may run simultaneously. Must be >= 1 and <= 16 (stable_16 aspirational ceiling). |
| `per_task_time_limit_ms` | number | **Yes** | Cap on any single task's `time_limit_ms`. Every task in this plan must have `time_limit_ms <= per_task_time_limit_ms`. |
| `per_task_token_limit` | number | **Yes** | Cap on any single task's `token_limit`. Every task in this plan must have `token_limit <= per_task_token_limit`. |

---

## Forbidden Authority Fields

The following fields MUST NOT appear in any PlanSpec. Their presence causes PSAG rejection.

| Forbidden Field | Reason | Governing Decision |
|-----------------|--------|-------------------|
| `agent_defined_plan` | Plans must be human-authored. No field suggesting agent origination. | D-035 |
| `self_admitted_plan` | Plans are admitted by PSAG, not self-admitted by their author. | D-035 |
| `generated_criteria_in_any_task` | If any task has non-human criteria, the plan is rejected. Redundant with per-task check but enforced at plan level as well. | D-035 |
| `auto_generated_tasks` | Tasks must be individually authored by humans. No bulk task generation field. | D-035 |
| `completion_status` | Plans do not carry their own completion status. Completion is per-TaskRun, determined by Truth Engine. | D-028, D-032 |
| `approved_by_agent` | No agent approval field. Agents do not approve plans. | D-028 (implied) |
| `override_admission` | No mechanism to bypass PSAG. Plan admission is deterministic and non-overridable. | PSAG non-overridable by design |

---

## Validation Rules (PSAG — Plan Level)

PSAG MUST apply all of the following rules at plan admission time. Any single violation causes REJECT with details.

### Hard Rejections

| # | Rule | Decision Reference |
|---|------|-------------------|
| P1 | `criteria_source` MUST equal `'human'` | D-035, D-036 |
| P2 | Every task in `tasks` MUST pass all TaskSpec-level PSAG validation (V1–V14 from `task-spec.contract.md`) | D-035, D-036, D-108 |
| P3 | No two tasks in the plan may have the same `task_id` (case-sensitive) | PSAG validation rule |
| P4 | The dependency graph across all tasks MUST be acyclic (no circular dependencies). Transitive closure check required. | PSAG validation rule |
| P5 | No two tasks in the **same wave** may have overlapping namespace entries. Tasks in different waves may overlap (sequential execution resolves). | D-108 |
| P6 | `plan_budget.total_time_limit_ms` MUST be >= sum of all (task `time_limit_ms * max_attempts`) | Budget integrity |
| P7 | `plan_budget.total_token_limit` MUST be >= sum of all (task `token_limit * max_attempts`) | Budget integrity |
| P8 | `plan_budget.max_concurrent_workers` MUST be >= 1 and <= 16 | Concurrency constraint (stable_16 aspirational ceiling) |
| P9 | Every task's `time_limit_ms` MUST be <= `plan_budget.per_task_time_limit_ms` | Per-task cap |
| P10 | Every task's `token_limit` MUST be <= `plan_budget.per_task_token_limit` | Per-task cap |
| P11 | `tasks` MUST be non-empty | A plan with no tasks does nothing |
| P12 | `waves` MUST be >= max task `wave` value in plan. Tasks cannot reference a wave number that does not exist. | Wave range integrity |
| P13 | All `dependencies` across all tasks MUST reference task_ids that exist in the plan | Cross-task reference integrity |
| P14 | Every task with `task_type: 'shared_package'` MUST have non-empty `predicted_interfaces` | PSAG validation rule |
| P15 | No PlanSpec may contain any forbidden authority field (see section above) | D-028, D-032, D-035 |

### Warnings (non-blocking, logged for human review)

| # | Rule |
|---|------|
| P-W1 | A task has no dependencies and is not in wave 0 — may indicate a missing dependency |
| P-W2 | A task in wave N depends on a task in wave M where M > N — this is structurally valid but may indicate ordering confusion |
| P-W3 | `predicted_interfaces` exists on a non-`shared_package` task — not an error, but advisory |
| P-W4 | `phases` is set but `waves` <= 1 — phases are meaningless without multiple waves |

---

## Data / Control Flow

```
1. Human authors PlanSpec (editor, CLI tool, or ACCP YAML)
       │
2. PlanSpec submitted to PSAG
       │
3. PSAG performs TaskSpec-level validation (delegated per task)
       │  → Any task-level violation → REJECT
       │
4. PSAG performs PlanSpec-level validation
       │  ├─ Duplicate task_ids?       → REJECT
       │  ├─ Circular dependencies?    → REJECT
       │  ├─ Namespace overlaps?       → REJECT (same wave only)
       │  ├─ Budget integrity?         → REJECT
       │  └─ Forbidden fields?          → REJECT
       │
5. All checks pass → ADMIT
       │
6. PSAG emits PlanAdmitted event (see runtime-event.contract.md)
       │
7. FSM begins execution from wave 0
```

---

## Failure Modes

| Failure | Cause | PSAG Response |
|---------|-------|---------------|
| Duplicate `task_id` | Two tasks share the same ID | REJECT with list of duplicate IDs |
| Circular dependency | A → B → A (or longer cycle) | REJECT with cycle path (ordered list of task_ids) |
| Namespace overlap (same wave) | Task A and Task B in wave 1 both claim `src/auth/` | REJECT with conflict detail: (wave, task_a_id, task_b_id, overlapping_path) |
| Budget overflow | Sum of task budgets exceeds plan budget | REJECT with budget delta (excess amount) |
| Task references nonexistent wave | `tasks[].wave = 5` but `waves = 3` | REJECT with task_id and invalid wave number |
| Dependency on nonexistent task | `dependencies: ["nonexistent-id"]` | REJECT with referencing task_id and missing dependency task_id |
| Empty tasks array | `tasks: []` | REJECT: plan must contain at least one task |
| Missing criteria in any task | Task with empty `acceptance_criteria` | REJECT with task_id of violating task |
| Generated criteria in any task | Task with `criteria_source: 'generated'` | REJECT with task_id and Law 3 citation |

---

## Test / Gate Implications

| Test Category | What to Test |
|---------------|-------------|
| PSAG happy path | Valid PlanSpec with 3 tasks, 2 waves, correct budget → ADMIT |
| PSAG reject: duplicate ids | PlanSpec with two tasks sharing `task_id: "task-1"` → REJECT |
| PSAG reject: circular deps | Task A depends on B, B depends on A → REJECT with cycle path |
| PSAG reject: namespace overlap | Two tasks in wave 1 both have namespace `["src/auth/"]` → REJECT |
| PSAG reject: budget overflow | Task budget sums exceed plan budget → REJECT |
| PSAG reject: wave out of range | Task references wave 5 but plan has 3 waves → REJECT |
| PSAG reject: forbidden field | PlanSpec contains `agent_defined_plan: true` → REJECT |
| PSAG reject: empty tasks | `tasks: []` → REJECT |
| PSAG reject: generated plan | `criteria_source: 'generated'` → REJECT |
| PSAG reject: missing predicted_interfaces | shared_package task without predicted_interfaces → REJECT |
| Dependency chain validation | A → B → C (valid), A → B → C → A (cycle, rejected) |
| Large plan validation | Plan with 50 tasks, 10 waves, valid deps → ADMIT (performance test) |

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Contract-first development (D-098) | This document is the contract, written before implementation |
| lib/contracts boundary (D-019) | This contract resides in `lib/contracts`; imports no kernel/server/adapters/interface |
| Law 1 — Completion Authority | No completion claim fields in PlanSpec |
| Law 2 — Write Authority | Namespace partitioning enforced at wave level |
| Law 3 — Verification Authority | `criteria_source: 'human'` enforced; per-task criteria check delegated |
| Human-authored plans only (D-035) | `agent_defined_plan` in forbidden fields; `human_id` required |
| No agent-generated criteria (D-035) | Plan-level AND per-task checks |
| Number of phases maps to plan structure (D-052) | `phases` field is optional organizational grouping |

---

## Conceptual Example

```json
{
  "plan_id": "auth-system-v1",
  "title": "Authentication System Implementation",
  "description": "Implement a complete authentication system including login, session management, token refresh, and role-based access control. Delivered in 3 waves: types first, then core auth module, then integration middleware.",
  "phases": 1,
  "waves": 3,
  "tasks": [
    {
      "task_id": "auth-types",
      "wave": 0,
      "namespace": ["src/auth/types.ts"],
      "task_type": "shared_package",
      "description": "Define all auth-related TypeScript types: Credentials, Session, TokenPair, Role, AuthError",
      "acceptance_criteria": [
        {
          "id": "ac-types-1",
          "description": "src/auth/types.ts must exist",
          "verification_type": "file_exists",
          "verification_detail": "src/auth/types.ts",
          "required": true
        },
        {
          "id": "ac-types-2",
          "description": "All required type exports are present",
          "verification_type": "diff_contains",
          "verification_detail": "export type Session",
          "required": true
        }
      ],
      "criteria_source": "human",
      "budget": { "time_limit_ms": 60000, "token_limit": 30000, "max_attempts": 3 },
      "dependencies": [],
      "predicted_interfaces": [
        {
          "symbol_name": "Session",
          "symbol_kind": "type",
          "expected_signature": "{ userId: string; token: string; expiresAt: number }",
          "consuming_tasks": ["auth-core-impl", "auth-middleware"]
        },
        {
          "symbol_name": "Credentials",
          "symbol_kind": "type",
          "expected_signature": "{ username: string; password: string }",
          "consuming_tasks": ["auth-core-impl"]
        }
      ]
    },
    {
      "task_id": "auth-core-impl",
      "wave": 1,
      "namespace": ["src/auth/login.ts", "src/auth/session.ts", "tests/auth/"],
      "task_type": "code",
      "description": "Implement login handler and session management logic",
      "acceptance_criteria": [
        {
          "id": "ac-core-1",
          "description": "Unit tests pass",
          "verification_type": "test_passes",
          "verification_detail": "npx vitest run tests/auth/",
          "required": true
        }
      ],
      "criteria_source": "human",
      "budget": { "time_limit_ms": 300000, "token_limit": 200000, "max_attempts": 5 },
      "dependencies": ["auth-types"]
    },
    {
      "task_id": "auth-middleware",
      "wave": 2,
      "namespace": ["src/middleware/auth.ts", "tests/middleware/auth.test.ts"],
      "task_type": "code",
      "description": "Implement Express/Fastify auth middleware using core auth module",
      "acceptance_criteria": [
        {
          "id": "ac-mw-1",
          "description": "Middleware tests pass",
          "verification_type": "test_passes",
          "verification_detail": "npx vitest run tests/middleware/auth.test.ts",
          "required": true
        }
      ],
      "criteria_source": "human",
      "budget": { "time_limit_ms": 180000, "token_limit": 100000, "max_attempts": 4 },
      "dependencies": ["auth-core-impl"]
    }
  ],
  "plan_budget": {
    "total_time_limit_ms": 1800000,
    "total_token_limit": 1200000,
    "max_concurrent_workers": 3,
    "per_task_time_limit_ms": 300000,
    "per_task_token_limit": 200000
  },
  "human_id": "erfolg",
  "criteria_source": "human"
}
```

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Should `phases` have semantic meaning (e.g., phase gate enforcement) or remain purely organizational? | OPEN — defer to P1 |
| Q2 | How are namespace overlaps detected for complex glob patterns? Exact string match or glob intersection? | OPEN — spike during P0.2 |
| Q3 | Should `plan_budget` include a `max_total_attempts` in addition to per-task `max_attempts`? | OPEN — may be needed for system-wide safety |
| Q4 | How does PSAG validate `predicted_interfaces` consistency across shared_package producers and consumers? | OPEN — Assembler territory |
| Q5 | Should PSAG enforce that all dependency paths eventually reach a task in the final wave? (no orphan tasks) | OPEN — currently WARNING only |

---

## Audit Notes

- PlanSpec is the outermost contract in the execution hierarchy. If PSAG admits a bad plan, every downstream component operates on invalid input.
- The two-level check (TaskSpec validation then PlanSpec validation) ensures no single point of failure: even if a task passes individual validation, the plan as a whole may still be rejected (e.g., namespace overlap across tasks).
- `phases` is intentionally soft: giving it hard gate semantics in MVP adds complexity without clear benefit. Organizational grouping is sufficient for P0–P2.
- The budget integrity checks (P6, P7) prevent a common class of errors where individual task budgets are reasonable but the aggregate exceeds what the human intended.
- Circular dependency detection (P4) must use a proper graph algorithm (DFS with visited tracking), not heuristic checking. Nested cycles (A→B→C→D→B) must be detected.
