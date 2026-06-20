# Praxis Task YAML Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Canonical decisions:** `docs/decisions.md`
**Authoritative ADR:** `docs/adr/ADR-013-plugin-first-pivot.md`

---

## Purpose

Define the v0.1 `.praxis/task.yaml` contract — the core task specification that drives PRAXIS verification. Every `/praxis:verify` run reads this file to determine what evidence to collect and what acceptance criteria to evaluate.

---

## File Path

`.praxis/task.yaml`

Lives in the PRAXIS workspace directory (project-local `.praxis/` or global `~/.praxis/`). It is the single source of truth for what the task requires and how it will be verified.

---

## Human Approval Requirement

The task.yaml contains acceptance criteria that must be approved by a human operator before FinalGate can PASS.

- Agent-generated criteria are drafts only until `human_approved: true`.
- FinalGate ignores criteria with `human_approved: false`.
- Only the human operator (via `/praxis:spec` approval step) can set `human_approved: true`.

This enforces Law 3: *FinalGate criteria come from human-authored TaskSpec only.*

---

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | Unique task identifier (e.g., `"PRAXIS-2026-001"`) |
| `title` | string | Human-readable task title |
| `description` | string | What the agent is expected to do |
| `workspace` | string | Path to the workspace directory (absolute or relative to `.praxis/`) |
| `namespace` | string[] | Files/paths the agent is allowed to modify |
| `acceptance_criteria` | AcceptanceCriterion[] | List of verifiable criteria |
| `required_commands` | string[] | Commands that must have been executed (e.g., `["bun test", "bun run typecheck"]`) |
| `allowed_files` | string[] | Glob patterns for files the agent may modify |
| `forbidden_files` | string[] | Glob patterns for files the agent must NOT touch |
| `evidence_requirements` | EvidenceRequirement[] | What evidence must exist (diff, test output, command logs) |
| `completion_policy` | string | `"all_criteria"` \| `"any_criteria"` \| `"custom"` |
| `human_approved` | boolean | Whether a human has approved the acceptance criteria |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `plan_ref` | string | Reference to a PlanSpec or ACCP plan if applicable |
| `dependencies` | string[] | Other task_ids this task depends on |
| `budget` | TaskBudget | Time/token/attempt budget (optional for v0.1) |
| `notes` | string | Free-form notes from the human operator |
| `created_at` | ISO8601 | Creation timestamp |
| `updated_at` | ISO8601 | Last modification timestamp |

---

## AcceptanceCriterion

Each criterion must have:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique criterion ID within the task (e.g., `"AC-001"`) |
| `description` | string | What this criterion checks |
| `verification_method` | string | `"file_exists"` \| `"test_passes"` \| `"command_output"` \| `"diff_contains"` \| `"no_diff_contains"` \| `"manual_review"` \| `"file_exists_and_grep"` \| `"grep_contains"` \| `"grep_forbidden"` \| `"archive_contains"` |
| `verification_detail` | string \| object | What to check. For `file_exists`: path string. For `grep_contains`: `{file, pattern}`. For `test_passes`: test name or pattern. |
| `required_evidence` | string[] | Evidence types needed: `"diff"`, `"test_output"`, `"command_log"`, `"file_content"` |
| `required` | boolean | Whether this criterion must pass (`true`) or is advisory (`false`) |
| `human_approved` | boolean | Whether a human approved this criterion |
| `criteria_source` | string | Must be `"human"` for FinalGate to evaluate. `"agent"` criteria are drafts. |

### Acceptance Criteria Rules

1. Every criterion must have `id`, `description`, `verification_method`, `required_evidence`, and `human_approved` marker.
2. Agent-generated criteria (`criteria_source: "agent"`) are drafts only until `human_approved: true`.
3. FinalGate cannot PASS criteria that are not human-approved.
4. Required criteria (`required: true`) failing → FinalGate FAIL.
5. Advisory criteria (`required: false`) failing → FinalGate HOLD.

---

## EvidenceRequirement

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"git_diff"` \| `"command_log"` \| `"test_output"` \| `"file_content"` \| `"hook_capture"` |
| `path` | string | Path or glob for the evidence |
| `required` | boolean | Whether this evidence must exist |

---

## TaskBudget (Optional for v0.1)

| Field | Type | Description |
|-------|------|-------------|
| `max_attempts` | number | Maximum repair attempts before ABORT |
| `max_time_minutes` | number | Time budget in minutes |
| `max_tokens` | number | Token budget (if tracking) |

---

## Validation Rules (PSAG-lite v0.1)

The praxis CLI validates task.yaml on `init` and `verify`:

| Rule | Check |
|------|-------|
| V1 | All required fields present |
| V2 | `acceptance_criteria` not empty |
| V3 | Criterion IDs unique |
| V4 | At least one criterion has `required: true` |
| V5 | `human_approved` must be `true` for FinalGate to PASS |
| V6 | No forbidden fields present |
| V7 | `workspace` path exists on disk |
| V8 | `namespace` not empty |

---

## Forbidden Fields

These fields must NOT appear in `.praxis/task.yaml`:

| Forbidden Field | Why |
|-----------------|-----|
| `agent_can_mark_complete` | Violates Law 1 — agent cannot declare completion |
| `worker_verdict_is_truth` | Violates Law 1 — worker self-report is not truth |
| `skip_final_gate` | Violates Law 1 — FinalGate cannot be bypassed |
| `auto_accept_agent_claim` | Violates Law 1 — agent claims are not completion evidence |
| `criteria_source_override` | Violates Law 3 — criteria source must be human |
| `agent_approved` | Violates Law 3 — agent cannot approve its own criteria |

---

## Example: Minimal task.yaml

```yaml
task_id: "PRAXIS-2026-001"
title: "Add health check endpoint"
description: "Add a GET /health endpoint that returns {status: 'ok'} with 200 status code"
workspace: "."
namespace:
  - "src/server/routes/health.ts"
  - "src/server/__tests__/health.test.ts"
acceptance_criteria:
  - id: "AC-001"
    description: "Health endpoint file exists"
    verification_method: "file_exists"
    verification_detail: "src/server/routes/health.ts"
    required_evidence:
      - "file_content"
    required: true
    human_approved: true
    criteria_source: "human"
  - id: "AC-002"
    description: "Health endpoint tests pass"
    verification_method: "test_passes"
    verification_detail: "health"
    required_evidence:
      - "test_output"
    required: true
    human_approved: true
    criteria_source: "human"
required_commands:
  - "bun test"
  - "bun run typecheck"
allowed_files:
  - "src/server/routes/health.ts"
  - "src/server/__tests__/health.test.ts"
forbidden_files:
  - "src/server/index.ts"
  - "package.json"
evidence_requirements:
  - type: "git_diff"
    path: "."
    required: true
  - type: "test_output"
    path: "bun test"
    required: true
  - type: "command_log"
    path: "."
    required: true
completion_policy: "all_criteria"
human_approved: true
```

## Example: Agent-Drafted (Before Human Approval)

```yaml
task_id: "PRAXIS-2026-002"
title: "Refactor auth middleware"
workspace: "."
namespace:
  - "src/server/middleware/auth.ts"
acceptance_criteria:
  - id: "AC-001"
    description: "Auth middleware tests pass"
    verification_method: "test_passes"
    verification_detail: "auth"
    required_evidence:
      - "test_output"
    required: true
    human_approved: false        # ← Agent drafted; human not yet approved
    criteria_source: "agent"     # ← Agent-generated
# ... other fields ...
human_approved: false            # ← Task overall not yet approved
```

Running `/praxis:verify` on this task would result in **FinalGate FAIL** because `human_approved` is `false`.

---

## How FinalGate Uses task.yaml

1. Read `.praxis/task.yaml`
2. Check `human_approved`. If `false` → FAIL immediately.
3. For each `acceptance_criterion`:
   a. Skip if `human_approved: false` (with warning)
   b. Collect `required_evidence`
   c. Execute `verification_method` against evidence
   d. Record criterion PASS/HOLD/FAIL
4. Apply `completion_policy`:
   - `"all_criteria"` → all required criteria must PASS
   - `"any_criteria"` → at least one required criterion must PASS
5. Produce FinalGate verdict: PASS / HOLD / FAIL

---

## How RepairPacket Uses task.yaml

When FinalGate returns HOLD or FAIL, `/praxis:repair` reads task.yaml to:

1. Identify which criteria failed
2. Extract `verification_detail` for each failed criterion
3. Generate a RepairPacket with failed criterion ID, evidence of failure, suggested fix direction, and files in namespace that may need changes

**RepairPacket MUST NOT:**
- Modify acceptance criteria
- Change `human_approved` status
- Add or remove criteria
- Claim the work is done

---

## Decision Compliance Checklist

- [x] File path: `.praxis/task.yaml` (D-139)
- [x] Human approval required (Law 3, D-128)
- [x] Acceptance criteria rules enforced
- [x] Forbidden fields defined and rejected
- [x] FinalGate usage defined
- [x] RepairPacket usage defined
- [x] Agent-generated criteria are drafts only
- [x] No implementation authorized
- [x] Status: DRAFT_FOR_AUDIT
