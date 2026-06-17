# RunAttempt Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the RunAttempt contract — the normalized data shape produced by an adapter after a single worker attempt. The RunAttemptResult (and its extended form AttemptManifest) carry ALL output data and evidence references from a worker run, but carry NO verdicts, completion decisions, or truth claims.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

A RunAttempt is a single execution of a worker on a task. The adapter captures everything the worker did — stdout, stderr, exit code, file changes, hook events, timing — and normalizes it into a `RunAttemptResult`. The kernel then extends this into an `AttemptManifest` by attaching additional metadata (evidence chain references, gate results placeholder).

The critical design property: **RunAttemptResult is evidence, not verdict**. It carries what the worker produced and what the worker claimed, but never declares success or failure. That determination belongs to the Truth Engine.

---

## Scope

- Defines `RunAttemptInput` (input to adapter's `runAttempt()`)
- Defines `RunAttemptResult` (output from adapter)
- Defines `AttemptManifest` (kernel-extended version with evidence and timing)
- Defines timing and evidence reference fields
- Defines the relationship between `worker_reported_status` (claim) and actual gate verdicts (determined later)

---

## Non-Goals

- Adapter behavior during the attempt (see `worker-adapter.contract.md`)
- How evidence is hashed and chained (Evidence Hash Chain territory)
- How gates evaluate the attempt (Truth Engine territory)
- How attempts are retried (RIM territory)
- TaskRun lifecycle FSM transitions (kernel territory)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-028 | Worker self-report is not completion | `worker_reported_status` is a CLAIM ONLY field |
| D-030 | Adapter never decides completion | No verdict/completion fields in RunAttemptResult |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | AttemptManifest has placeholder for gate results (populated by Truth Engine, not adapter) |
| D-034 | EvidenceRecord and EHC are required | `AttemptManifest` links to EvidenceRecords |
| D-104 | Agent claims are not completion evidence | `worker_reported_status` does not influence gate evaluation |
| D-105 | False-done tests mandatory | Empty diff + "completed" claim is the classic false-done scenario |
| D-106 | Empty diff must not complete | ExecGate checks `changed_files` and `diff_ref` content |

---

## Conceptual Model

```
┌────────────────────────────────────────────────────────────┐
│  1. Kernel FSM creates RunAttemptInput                     │
│     (attempt_id, task_run_id, workspace, namespace, etc.)   │
│                         │                                  │
│                         ▼                                  │
│  2. Adapter receives RunAttemptInput                       │
│     → Launches worker process                              │
│     → Captures all output                                  │
│     → Normalizes into RunAttemptResult                     │
│                         │                                  │
│                         ▼                                  │
│  3. RunAttemptResult returned to kernel                    │
│     (stdout, stderr, diff, exit code, files, hooks, etc.)  │
│     (NO verdicts, NO completion decisions)                 │
│                         │                                  │
│                         ▼                                  │
│  4. Kernel extends to AttemptManifest                      │
│     • Adds EvidenceRecord chain references                 │
│     • Adds timing metadata                                 │
│     • Adds gate results placeholder (empty — Truth Engine   │
│       populates later)                                     │
│                         │                                  │
│                         ▼                                  │
│  5. AttemptManifest fed to Truth Engine                    │
│     EvidenceGate → ExecGate → FinalGate                    │
│     Each gate reads evidence, produces verdicts            │
└────────────────────────────────────────────────────────────┘
```

### Truth vs. Claim Boundary

```
Worker says:           "I completed the task"     →  CLAIM (worker_reported_status)
Worker produced:       stdout, stderr, diff       →  EVIDENCE (captured output)
Worker changed:        file list                   →  EVIDENCE (changed_files)
Worker's tool calls:   hook events                 →  EVIDENCE (hook_event_refs)
                                                      ↓
Truth Engine checks:   Evidence present?           →  EvidenceGate
                       Tests pass?                 →  ExecGate
                       Criteria satisfied?          →  FinalGate
                                                      ↓
Truth Engine declares: PASS / HOLD / FAIL          →  VERDICT (gate output)
```

---

## Field Definitions

### RunAttemptInput

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `attempt_id` | string | **Yes** | Unique identifier for this attempt. Generated by kernel FSM. Non-empty, max 128 chars. |
| `task_run_id` | string | **Yes** | The TaskRun this attempt is part of. Links attempts across retries. Non-empty. |
| `worker_id` | string | **Yes** | Which worker instance executes this attempt. Non-empty. |
| `workspace_path` | string | **Yes** | Absolute path to the isolated workspace directory. |
| `namespace` | string[] | **Yes** | File paths the worker owns exclusively. From TaskSpec. Non-empty. |
| `allowed_paths` | string[] | **Yes** | All paths the worker may access (read: all; write: namespace only). Superset of namespace. |
| `prompt_ref` | string | **Yes** | Reference to the task prompt. Resolved by adapter to worker-injectable form. |
| `hook_config_ref` | string | **Yes** | Reference to hook configuration for this attempt. |
| `budget` | TaskBudget | **Yes** | Time, token, and attempt limits. Same shape as `TaskSpec.budget`. |

### RunAttemptResult

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `attempt_id` | string | **Yes** | Matches input `attempt_id`. Used for correlation. |
| `task_run_id` | string | **Yes** | Matches input `task_run_id`. Links to TaskRun lifecycle. |
| `worker_id` | string | **Yes** | Matches input `worker_id`. Identifies which worker ran. |
| `process_exit_code` | number or null | **Yes** | Worker process exit code. `null` if killed/terminated before natural exit. |
| `stdout_ref` | string | **Yes** | Reference to captured stdout. Preserved as evidence, not interpreted. |
| `stderr_ref` | string | **Yes** | Reference to captured stderr. Preserved as evidence, not interpreted. |
| `diff_ref` | string | **Yes** | Reference to git diff. May reference an empty diff (worker changed nothing). |
| `changed_files` | string[] | **Yes** | File paths modified, created, or deleted. Relative to workspace root. May be empty. |
| `hook_event_refs` | string[] | **Yes** | References to hook event records. Each is raw tool call data. May be empty. |
| `worker_reported_status` | string | **Yes** | **CLAIM ONLY.** What the worker reported about its own state at exit. Typical values: `'completed'`, `'failed'`, `'timeout'`, `'crashed'`, `'interrupted'`. Do not treat as truth. |
| `error_signals` | ErrorSignal or null | **Yes** | Structured error if the attempt ended abnormally. `null` if no error. See `worker-adapter.contract.md` for ErrorSignal definition. |
| `started_at` | string (ISO 8601) | **Yes** | When the worker process started. |
| `ended_at` | string (ISO 8601) | **Yes** | When the worker process ended. |
| `duration_ms` | number | **Yes** | Wall clock duration. Must equal `ended_at - started_at` (ms). Must be >= 0. |

### AttemptManifest

The `AttemptManifest` is the kernel-extended version of `RunAttemptResult`. It contains ALL fields from `RunAttemptResult` plus:

| Field | Type | Required | Source | Validation |
|-------|------|----------|--------|------------|
| *(all RunAttemptResult fields)* | — | **Yes** | Adapter output | Same validation as RunAttemptResult |
| `manifest_id` | string | **Yes** | Kernel generated | Unique manifest identifier. Non-empty. |
| `evidence_chain_refs` | string[] | **Yes** | Kernel: Evidence Hash Chain | References to EvidenceRecords produced from this attempt's output. At minimum: one for stdout, one for stderr, one for diff. |
| `transcript_ref` | string | No | Kernel: Hook layer | Reference to the KernelOwnedTranscript if hooks captured tool events. |
| `namespace_violations` | string[] | **Yes** | Kernel: Namespace check | File paths the worker wrote to that were outside its namespace. Empty if no violations. |
| `divergence_flags` | DivergenceFlag[] | **Yes** | Kernel: Divergence detector | Any mismatches between hook-captured events and worker-reported output. Empty if no divergence. |
| `gate_results` | GateResult placeholder | **Yes** | Kernel: Truth Engine placeholder | Initially empty/absent. Populated by Truth Engine after gate evaluation. NOT populated by adapter. |

### DivergenceFlag

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `flag_id` | string | **Yes** | Unique identifier for this divergence flag. |
| `hook_event_ref` | string | **Yes** | Reference to the hook event that shows what actually happened. |
| `worker_claim` | string | **Yes** | What the worker claimed happened (from worker_reported_status or output). |
| `discrepancy` | string | **Yes** | Human-readable description of the mismatch. |
| `severity` | enum string | **Yes** | One of: `'info'`, `'warning'`, `'critical'`. `'critical'` feeds Circuit Breaker. |

### GateResult (placeholder in AttemptManifest)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `evidence_gate` | Verdict or null | No | EvidenceGate result. `null` until EvidenceGate runs. |
| `exec_gate` | Verdict or null | No | ExecGate result. `null` until ExecGate runs. |
| `final_gate` | Verdict or null | No | FinalGate result. `null` until FinalGate runs. |
| `evaluated_at` | string (ISO 8601) or null | No | When gate evaluation was performed. |
| `evaluated_by` | string or null | No | Truth Engine instance identifier. |

### Verdict (conceptual shape for gate output)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `verdict` | enum string | **Yes** | One of: `'PASS'`, `'HOLD'`, `'FAIL'`. |
| `reason` | string | **Yes** | Human-readable explanation of why this verdict was reached. |
| `criteria_results` | CriterionResult[] | **Yes** | Per-criterion evaluation results. Maps to `TaskSpec.acceptance_criteria`. |
| `evidence_cited` | string[] | **Yes** | References to specific evidence records that support the verdict. |

---

## Forbidden Authority Fields

The following fields MUST NOT appear in `RunAttemptResult` or `RunAttemptInput`.

| Forbidden Field | Reason | Governing Decision |
|-----------------|--------|-------------------|
| `completion_verdict` | RunAttemptResult carries evidence, not verdicts. | D-028, D-032 |
| `gate_result` | Gate results are populated in AttemptManifest by Truth Engine, not by the adapter. | D-030, D-032 |
| `passed_acceptance_criteria` | Adapter does not evaluate criteria. | D-030, D-035 |
| `truth_decision` | Truth Engine owns truth. Adapter output is input to gates, not gate output. | D-030, D-032 |
| `is_successful` | Binary success/failure is a gate verdict. | D-030 |
| `worker_verdict` | Worker does not issue verdicts. `worker_reported_status` is a claim, not a verdict. | D-028 |
| `final_gate_passed` | FinalGate is kernel territory. | D-032, D-033 |
| `attempt_complete` | Completion is determined by FinalGate PASS. | D-028, D-032 |

---

## Data / Control Flow

```
RunAttemptInput
  │
  │  [adapter launches worker, captures output]
  │
  ▼
RunAttemptResult  ←── adapter returns this (EVIDENCE ONLY)
  │
  │  [kernel: Evidence Hash Chain, divergence check, namespace check]
  │
  ▼
AttemptManifest  ←── kernel extends RunAttemptResult
  │                    • evidence_chain_refs added
  │                    • transcript_ref added (if hooks)
  │                    • namespace_violations populated
  │                    • divergence_flags populated
  │                    • gate_results placeholder (empty)
  │
  │  [Truth Engine: EvidenceGate → ExecGate → FinalGate]
  │
  ▼
AttemptManifest  ←── Truth Engine populates gate_results
  │                    • evidence_gate: Verdict
  │                    • exec_gate: Verdict
  │                    • final_gate: Verdict  ← THIS is the source of truth
  │
  ▼
CompleteAttemptRecord  ←── Final form for archival/audit
```

---

## Failure Modes

| Failure | How Detected | Manifest Impact |
|---------|-------------|-----------------|
| Worker never started | Adapter returns error; no RunAttemptResult produced | Attempt is abandoned; FSM routes to ABORTED |
| Worker crashed | Adapter returns RunAttemptResult with `error_signals: CrashSignal` | `changed_files` may be partial; `process_exit_code: null` |
| Worker timed out | Adapter returns RunAttemptResult with `error_signals: TimeoutSignal` | `changed_files` may be partial |
| Worker claimed done, produced nothing | Adapter returns RunAttemptResult with `worker_reported_status: 'completed'` but `changed_files: []`, `diff_ref` is empty diff | ExecGate catches this (false-done); FinalGate FAIL |
| Worker wrote outside namespace | Namespace check compares `changed_files` against `namespace` | `namespace_violations` populated; feeds Circuit Breaker |
| Hook events diverge from worker report | Divergence detector compares `hook_event_refs` against `worker_reported_status` | `divergence_flags` populated; EHC break classification |
| Empty stdout/stderr | Worker produced no terminal output | EvidenceGate may HOLD (insufficient evidence) |
| Zero tests ran | `ExecGate` inspects test output, finds no test results | ExecGate FAIL (D-107: zero tests ran must not pass) |

---

## Test / Gate Implications

| Test Category | What to Test |
|---------------|-------------|
| Input/output shape match | `RunAttemptResult.attempt_id` matches `RunAttemptInput.attempt_id` |
| Claim not verdict | `worker_reported_status: 'completed'` with empty `changed_files` → Truth Engine must FAIL, not PASS |
| Forbidden field absence | `RunAttemptResult` must not contain `completion_verdict`, `gate_result`, `passed_acceptance_criteria`, `truth_decision` |
| Error signal structure | `CrashSignal`, `TimeoutSignal`, `RateLimitSignal` each have correct shape |
| AttemptManifest extension | Kernel correctly extends `RunAttemptResult` into `AttemptManifest` with all additional fields |
| Namespace violation detection | Worker writes to `src/other/` (outside namespace) → `namespace_violations` contains `src/other/file.ts` |
| Divergence detection | Hook shows tool call failed; worker reported success → `divergence_flags` has critical flag |
| Evidence chain linkage | `evidence_chain_refs` in `AttemptManifest` correctly references generated EvidenceRecords |
| Gate results placeholder | `AttemptManifest.gate_results` is empty before Truth Engine runs; populated after |
| Empty diff detection | `changed_files: []` with `worker_reported_status: 'completed'` → false-done → FAIL |

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Contract-first development (D-098) | This document is the contract, written before implementation |
| lib/contracts boundary (D-019) | This contract lives in `lib/contracts`; imports no kernel/server/adapters/interface |
| Law 1 — Completion Authority | No completion verdict fields in RunAttemptResult |
| Worker self-report is not completion (D-028) | `worker_reported_status` labeled CLAIM ONLY throughout |
| Adapter never decides completion (D-030) | Forbidden fields enforce; adapter produces RunAttemptResult, kernel extends to AttemptManifest |
| EvidenceRecord and EHC required (D-034) | `evidence_chain_refs` in AttemptManifest |
| False-done tests mandatory (D-105) | Empty diff + completed claim scenario documented |
| Empty diff must not complete (D-106) | ExecGate responsibility; RunAttemptResult carries data for detection |
| Zero tests must not pass (D-107) | ExecGate responsibility; RunAttemptResult carries data for detection |

---

## Conceptual Examples

### RunAttemptInput
```json
{
  "attempt_id": "attempt-run-42-001",
  "task_run_id": "taskrun-auth-core-001",
  "worker_id": "claude-code-worker-1",
  "workspace_path": "/home/praxis/workspaces/plan-auth-v1/task-auth-core/",
  "namespace": ["src/auth/login.ts", "src/auth/session.ts", "tests/auth/"],
  "allowed_paths": ["src/auth/", "tests/auth/", "src/auth/types.ts", "package.json", "tsconfig.json"],
  "prompt_ref": "prompts://plan-auth-v1/auth-core/prompt-v2.txt",
  "hook_config_ref": "hooks://default/claude-code-pre-post.json",
  "budget": {
    "time_limit_ms": 300000,
    "token_limit": 200000,
    "max_attempts": 5
  }
}
```

### RunAttemptResult (normal completion, no errors)
```json
{
  "attempt_id": "attempt-run-42-001",
  "task_run_id": "taskrun-auth-core-001",
  "worker_id": "claude-code-worker-1",
  "process_exit_code": 0,
  "stdout_ref": "evidence://plan-auth-v1/attempt-run-42-001/stdout.log",
  "stderr_ref": "evidence://plan-auth-v1/attempt-run-42-001/stderr.log",
  "diff_ref": "evidence://plan-auth-v1/attempt-run-42-001/diff.patch",
  "changed_files": [
    "src/auth/login.ts",
    "src/auth/session.ts",
    "tests/auth/login.test.ts",
    "tests/auth/session.test.ts"
  ],
  "hook_event_refs": [
    "evidence://plan-auth-v1/attempt-run-42-001/hooks/event-001.json",
    "evidence://plan-auth-v1/attempt-run-42-001/hooks/event-002.json",
    "evidence://plan-auth-v1/attempt-run-42-001/hooks/event-003.json"
  ],
  "worker_reported_status": "completed",
  "error_signals": null,
  "started_at": "2026-06-18T14:30:00.000Z",
  "ended_at": "2026-06-18T14:34:12.500Z",
  "duration_ms": 252500
}
```

### RunAttemptResult (false-done: claimed done, produced nothing)
```json
{
  "attempt_id": "attempt-run-43-001",
  "task_run_id": "taskrun-api-handler-001",
  "worker_id": "claude-code-worker-1",
  "process_exit_code": 0,
  "stdout_ref": "evidence://plan-auth-v1/attempt-run-43-001/stdout.log",
  "stderr_ref": "evidence://plan-auth-v1/attempt-run-43-001/stderr.log",
  "diff_ref": "evidence://plan-auth-v1/attempt-run-43-001/diff.patch",
  "changed_files": [],
  "hook_event_refs": [],
  "worker_reported_status": "completed",
  "error_signals": null,
  "started_at": "2026-06-18T14:40:00.000Z",
  "ended_at": "2026-06-18T14:40:03.100Z",
  "duration_ms": 3100
}
```
*Note: `changed_files` is empty, `hook_event_refs` is empty, `duration_ms` is suspiciously low (3100ms), yet `worker_reported_status` says `'completed'`. This is the canonical false-done scenario. Truth Engine must detect this and produce FAIL.*

### AttemptManifest (kernel-extended, before gate evaluation)
```json
{
  "manifest_id": "manifest-run-42-001",
  "attempt_id": "attempt-run-42-001",
  "task_run_id": "taskrun-auth-core-001",
  "worker_id": "claude-code-worker-1",
  "process_exit_code": 0,
  "stdout_ref": "evidence://plan-auth-v1/attempt-run-42-001/stdout.log",
  "stderr_ref": "evidence://plan-auth-v1/attempt-run-42-001/stderr.log",
  "diff_ref": "evidence://plan-auth-v1/attempt-run-42-001/diff.patch",
  "changed_files": [
    "src/auth/login.ts",
    "src/auth/session.ts",
    "tests/auth/login.test.ts"
  ],
  "hook_event_refs": [
    "evidence://plan-auth-v1/attempt-run-42-001/hooks/event-001.json"
  ],
  "worker_reported_status": "completed",
  "error_signals": null,
  "started_at": "2026-06-18T14:30:00.000Z",
  "ended_at": "2026-06-18T14:34:12.500Z",
  "duration_ms": 252500,
  "evidence_chain_refs": [
    "ehc://plan-auth-v1/attempt-run-42-001/stdout",
    "ehc://plan-auth-v1/attempt-run-42-001/stderr",
    "ehc://plan-auth-v1/attempt-run-42-001/diff"
  ],
  "transcript_ref": "transcript://plan-auth-v1/attempt-run-42-001/kernel-owned-transcript.json",
  "namespace_violations": [],
  "divergence_flags": [],
  "gate_results": {
    "evidence_gate": null,
    "exec_gate": null,
    "final_gate": null,
    "evaluated_at": null,
    "evaluated_by": null
  }
}
```

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Should `AttemptManifest` be an immutable record once gate evaluation begins? | OPEN — likely yes, but needs implementation decision |
| Q2 | How are `evidence_chain_refs` structured — URI scheme? Content-addressed hash? Database row IDs? | OPEN — P0.2 contracts port and P3 evidence implementation |
| Q3 | Should `RunAttemptResult` include `token_consumed` (actual token count) in addition to budget limits? | OPEN — useful for cost tracking |
| Q4 | Should `DivergenceFlag.severity` have a fourth level (`'blocking'`) that immediately opens Circuit Breaker? | OPEN — `'critical'` may be sufficient |
| Q5 | Is `GateResult` its own contract or fully defined here? | OPEN — likely needs its own contract (`gate-verdict.contract.md`) |

---

## Audit Notes

- `RunAttemptResult` is the boundary between adapter output and kernel processing. The shape must be stable across all adapter implementations (Claude Code, OpenCode, local model, mock).
- The false-done example (RunAttemptResult with empty changes but `worker_reported_status: 'completed'`) is the single most important test case. Every PRAXIS gate must detect this scenario.
- `AttemptManifest` extends `RunAttemptResult` without modifying any adapter-produced fields. This is intentional: the kernel adds metadata without altering evidence. If an adapter field needs correction, the manifest should add a correction field rather than modifying the original.
- `gate_results` starts empty (`null` for all three gates) and is populated incrementally as each gate runs. This supports the sequential gate pipeline (EvidenceGate → ExecGate → FinalGate) where earlier gate results inform later gates.
- `namespace_violations` is populated by kernel-level namespace check, not by the adapter. The adapter enforces `allowed_paths` at the worker configuration level; the kernel verifies compliance by comparing `changed_files` against `namespace`.
