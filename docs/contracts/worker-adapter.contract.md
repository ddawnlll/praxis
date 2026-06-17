# WorkerAdapter Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the WorkerAdapter contract — the interface that every external worker integration must implement. Adapters bridge PRAXIS to concrete tools (Claude Code, OpenCode, local models) by launching processes, capturing output, and normalizing results into AttemptManifests. Adapters are mechanical bridges, not truth evaluators.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The WorkerAdapter is the boundary between PRAXIS kernel and external worker processes. Every worker type (Claude Code, OpenCode, local model, mock) implements this contract. The adapter's sole job is to:

1. Report worker health
2. Launch attempts and capture all output
3. Abort running attempts on demand
4. Normalize raw worker output into a structured `AttemptManifest`

The adapter must NOT evaluate correctness, declare completion, or produce gate verdicts. Those are kernel responsibilities.

---

## Scope

- Defines the three adapter operations: `healthCheck`, `runAttempt`, `abortAttempt`
- Defines `WorkerHealth` response shape
- Defines `RunAttemptInput` shape
- Defines `RunAttemptResult` shape
- Defines adapter behavior rules (what adapters MUST and MUST NOT do)
- Defines error signal taxonomy

---

## Non-Goals

- How the kernel calls the adapter (server wiring layer)
- How hooks capture events inside the worker process (hook layer)
- How worker output becomes evidence (Truth Engine territory)
- Worker implementation details (Claude Code internals, OpenCode internals)
- Attempt manifest structure details (see `run-attempt.contract.md`)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-021 | Adapters integrate external workers | This is the adapter contract — the single interface all adapters implement |
| D-030 | Adapter never decides completion | Forbidden fields: no gate verdict, no completion status, no truth decision |
| D-028 | Worker self-report is not completion | `worker_reported_status` is a claim field, not a verdict field |
| D-074 | Adapter starts processes, prepares env/config/prompts, normalizes results | Contract operations map to these mechanical responsibilities |
| D-075 | Adapter does not decide completion | Reiterated in forbidden fields |
| D-031 | Hook never decides truth | Adapter passes through hook events; does not evaluate them |
| D-025 | HTTP commands/queries + SSE event stream | Adapter communication is local process management, not HTTP — this is the internal boundary |

---

## Conceptual Model

```
┌──────────────────────────────────────────────────────────────┐
│                       PRAXIS Kernel                          │
│                                                              │
│  FSM → "run this task"                                       │
│        │                                                     │
│        ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │               WorkerAdapter (contract)               │     │
│  │                                                     │     │
│  │  healthCheck() ──→ WorkerHealth                     │     │
│  │  runAttempt()   ──→ RunAttemptResult                │     │
│  │  abortAttempt() ──→ void                            │     │
│  │                                                     │     │
│  │  Responsibilities:                                  │     │
│  │  • Launch worker process                            │     │
│  │  • Configure workspace, env, hooks, prompt          │     │
│  │  • Capture stdout, stderr, exit code, diff          │     │
│  │  • Normalize output → AttemptManifest               │     │
│  │  • Report worker health                             │     │
│  │  • Abort on demand                                  │     │
│  │                                                     │     │
│  │  NOT responsibilities:                              │     │
│  │  • Evaluate correctness                             │     │
│  │  • Declare completion                               │     │
│  │  • Produce gate verdicts                            │     │
│  │  • Modify worker output                             │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                    │
└─────────────────────────┼────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  External Worker Process                     │
│                                                              │
│  Claude Code / OpenCode / Local Model / Mock Worker          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Hook Layer (praxis-hook)                            │    │
│  │  Intercepts tool calls → KernelOwnedTranscript       │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## Operations

### 1. `healthCheck()`

**Returns:** `Promise<WorkerHealth>`

Reports the current health of the worker. Called periodically by the kernel (Governor) and on-demand by the control plane (UI).

The adapter must return a health status even if the worker is unreachable — the health check itself must not throw. Use `status: 'unavailable'` when the worker cannot be reached.

### 2. `runAttempt(input: RunAttemptInput)`

**Returns:** `Promise<RunAttemptResult>`

Launches a single worker attempt. The adapter:
1. Prepares the workspace (isolated copy, git init if needed)
2. Writes configuration (allowed_paths, budget constraints)
3. Injects the task prompt via the worker's native mechanism
4. Configures hooks to capture tool events
5. Starts the worker process
6. Waits for completion or timeout
7. Captures stdout, stderr, exit code, git diff
8. Normalizes all output into `RunAttemptResult`
9. Returns the result (never throws for worker failures — errors go into `error_signals`)

### 3. `abortAttempt(attemptId: string)`

**Returns:** `Promise<void>`

Forcefully terminates a running attempt. Called when:
- Budget exhausted (time or tokens)
- Circuit Breaker opens mid-attempt
- Human operator aborts via Mission Control
- Governor downgrade requires worker shutdown

The adapter sends SIGTERM, waits a grace period, then SIGKILL if the process has not exited. Should be idempotent (calling abort on an already-finished attempt is a no-op).

---

## Field Definitions

### WorkerHealth

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `status` | enum string | **Yes** | One of: `'healthy'`, `'degraded'`, `'unavailable'`. `'healthy'` = worker responding normally. `'degraded'` = worker responding but with issues (slow, partial errors). `'unavailable'` = worker not reachable. |
| `last_checked` | string (ISO 8601) | **Yes** | Timestamp of when this health check was performed. |
| `details` | string | No | Human-readable details about health status. Required when `status` is `'degraded'` or `'unavailable'`. Max 1024 chars. |

### RunAttemptInput

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `attempt_id` | string | **Yes** | Unique identifier for this attempt. Generated by the kernel FSM before calling the adapter. Non-empty. |
| `task_run_id` | string | **Yes** | The TaskRun this attempt belongs to. Links attempt results back to the task lifecycle. Non-empty. |
| `worker_id` | string | **Yes** | Which worker instance is handling this attempt. Used for health tracking and event routing. Non-empty. |
| `workspace_path` | string | **Yes** | Absolute path to the isolated workspace. The adapter must operate within this directory. |
| `namespace` | string[] | **Yes** | File path prefixes the worker is allowed to modify. Maps to `TaskSpec.namespace`. Non-empty. |
| `allowed_paths` | string[] | **Yes** | Read-only paths the worker may access. Superset of namespace. Workers may read but not write to paths outside namespace. |
| `prompt_ref` | string | **Yes** | Reference to the task prompt content. Could be a file path, a stored prompt ID, or inline content. Adapter resolves this to the actual prompt text injected into the worker. |
| `hook_config_ref` | string | **Yes** | Reference to hook configuration. Tells the adapter which hooks to attach (pre-tool, post-tool, stop hooks). |
| `budget` | TaskBudget | **Yes** | Time, token, and attempt limits for this run. Adapter must enforce or forward these constraints. Same shape as `TaskSpec.budget`. |

### RunAttemptResult

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `attempt_id` | string | **Yes** | Matches the input `attempt_id`. Used for correlation. |
| `process_exit_code` | number or null | **Yes** | The worker process exit code. `null` if the process was killed before exit (timeout, abort, crash). |
| `stdout_ref` | string | **Yes** | Reference to captured stdout content (file path or stream ID). The raw stdout is preserved as evidence. |
| `stderr_ref` | string | **Yes** | Reference to captured stderr content (file path or stream ID). The raw stderr is preserved as evidence. |
| `diff_ref` | string | **Yes** | Reference to the git diff produced by this attempt (file path or stream ID). Empty diff is valid — it is evidence that the worker changed nothing. |
| `changed_files` | string[] | **Yes** | List of files modified, created, or deleted during the attempt. Relative to workspace root. May be empty. |
| `hook_event_refs` | string[] | **Yes** | References to hook event logs (file paths or stream IDs). Each reference points to captured tool events. May be empty if no hooks fired. |
| `worker_reported_status` | string | **Yes** | **CLAIM ONLY.** What the worker said about its own completion. Typical values: `'completed'`, `'failed'`, `'timeout'`, `'crashed'`. MUST be treated as a claim, not a verdict. Truth Engine independently evaluates. |
| `error_signals` | ErrorSignal or null | **Yes** | Structured error information if the attempt ended abnormally. See sub-type below. `null` if no error signal detected. |
| `started_at` | string (ISO 8601) | **Yes** | Timestamp when the worker process started. |
| `ended_at` | string (ISO 8601) | **Yes** | Timestamp when the worker process ended (exit, killed, or crashed). |
| `duration_ms` | number | **Yes** | Wall clock duration of the attempt. Must equal `ended_at - started_at` (in ms). Must be >= 0. |

### ErrorSignal

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `signal_type` | enum string | **Yes** | One of: `'RateLimitSignal'`, `'CrashSignal'`, `'TimeoutSignal'`, `'ResourceExhaustedSignal'`, `'UnknownSignal'`. |
| `message` | string | **Yes** | Human-readable description of the error. Min 1 char, max 1024 chars. |
| `details` | object | No | Type-specific error details. `RateLimitSignal` should include `retry_after_ms` if available. `CrashSignal` should include `stack_trace` if available. `TimeoutSignal` should include `timeout_type: 'wall_clock' | 'token'`. |

---

## Forbidden Authority Fields

The following fields MUST NOT appear in `RunAttemptResult` or any sub-type. Their presence indicates the adapter is overstepping its mechanical role.

| Forbidden Field | Reason | Governing Decision |
|-----------------|--------|-------------------|
| `gate_verdict` | Adapter does not run gates. Only Truth Engine produces verdicts. | D-030, D-032 |
| `completion_status` | Adapter does not decide completion. | D-030, D-028 |
| `truth_decision` | Adapter is not the Truth Engine. | D-030, D-032 |
| `final_gate_result` | FinalGate is kernel-owned. Adapter output feeds into gates, never contains gate results. | D-030, D-033 |
| `passed_acceptance_criteria` | Adapter does not evaluate criteria. | D-030, D-035 |
| `attempt_passed` | Binary pass/fail is a gate verdict, not adapter output. | D-030 |
| `is_complete` | Completion is determined by Truth Engine FinalGate PASS. | D-032 |
| `worker_says_done` | Already covered by `worker_reported_status` (a claim, not a verdict). A separate "done" field would circumvent the claim/verdict distinction. | D-028 |
| `evaluated_correctness` | Adapter does not evaluate. | D-030 |

---

## MUST / MUST NOT Rules

### Adapter MUST

| # | Rule |
|---|------|
| M1 | Normalize all worker output into `RunAttemptResult` without evaluating correctness |
| M2 | Capture stdout, stderr, exit code, and git diff for every attempt |
| M3 | Preserve raw worker output — do not filter, modify, or summarize |
| M4 | Produce a `RunAttemptResult` even if the worker crashes (exit code null, error_signal populated) |
| M5 | Enforce `allowed_paths` — the adapter must configure the worker to only write within its namespace |
| M6 | Report worker health truthfully — do not report `'healthy'` when the worker is degraded or unreachable |
| M7 | Treat `worker_reported_status` as a claim: pass it through verbatim, do not interpret it |
| M8 | Abort running attempts when `abortAttempt()` is called, with a grace period before force kill |
| M9 | Set `error_signals` to a structured `ErrorSignal` when the attempt ends abnormally |
| M10 | Ensure `duration_ms` equals the actual wall-clock time the worker process ran |

### Adapter MUST NOT

| # | Rule |
|---|------|
| N1 | **Evaluate correctness** of worker output (Truth Engine responsibility) |
| N2 | **Declare completion** in any form (gate_verdict, completion_status, truth_decision, etc.) |
| N3 | **Produce gate verdicts** (PASS, HOLD, FAIL — these are Truth Engine outputs) |
| N4 | **Modify worker output** (stdout, stderr, diff, hook events) |
| N5 | **Write outside `allowed_paths`** (adapter itself must respect namespace boundaries) |
| N6 | **Filter or suppress error signals** (if the worker crashed, report it) |
| N7 | **Invent worker output** (if the worker produced nothing, report nothing) |
| N8 | **Import kernel** (adapter depends on `lib/contracts` only, not kernel internals) |
| N9 | **Retry on failure** (retry is the FSM's job via RIM; adapter runs exactly one attempt per call) |
| N10 | **Interpret `worker_reported_status`** as truth (it is evidence, never a verdict) |

---

## Failure Modes

| Failure | Adapter Behavior | Error Signal |
|---------|-----------------|--------------|
| Worker process crashes | Capture partial output, set `process_exit_code: null`, populate `error_signals` as `CrashSignal` | `CrashSignal` with stack trace if available |
| Worker exceeds time budget | `abortAttempt()` is called by kernel; adapter force-kills process | `TimeoutSignal` with `timeout_type: 'wall_clock'` |
| Worker exceeds token budget | Worker's own token tracking triggers stop; adapter captures partial output | `TimeoutSignal` with `timeout_type: 'token'` |
| Worker hits rate limit | Worker reports rate limit; adapter captures error output | `RateLimitSignal` with `retry_after_ms` if available |
| Worker is unreachable (health check) | `healthCheck()` returns `WorkerHealth { status: 'unavailable' }` | Not an attempt error — health status only |
| Workspace path does not exist | Adapter creates workspace or reports error | `CrashSignal` with message about missing workspace |
| Hook configuration invalid | Adapter runs without hooks (graceful degradation); logs warning | No error signal — attempt proceeds without hooks |
| Adapter itself crashes | Attempt is marked as failed by kernel timeout; adapter restarts | Kernel detects via health check timeout |

---

## Test / Gate Implications

| Test Category | What to Test |
|---------------|-------------|
| Happy path | Valid `RunAttemptInput` → adapter launches worker → returns complete `RunAttemptResult` with exit code 0 |
| Worker crash | Worker process dies → adapter returns `RunAttemptResult` with `process_exit_code: null`, `error_signals: CrashSignal` |
| Timeout | Worker exceeds time limit → adapter (or kernel) aborts → `error_signals: TimeoutSignal` |
| Empty output | Worker runs but produces no diff, no file changes → adapter returns empty `changed_files`, empty `diff_ref` |
| Forbidden field absence | `RunAttemptResult` must never contain `gate_verdict`, `completion_status`, etc. |
| Claim vs. verdict | Worker reports `'completed'` but produced no changes → `worker_reported_status` says `'completed'`, but `changed_files` is empty. Truth Engine must catch this. |
| Abort idempotency | `abortAttempt()` called twice → second call is no-op, no crash |
| Health check: unavailable | Worker process not running → `healthCheck()` returns `{ status: 'unavailable' }` |
| Health check: degraded | Worker responding slowly → `healthCheck()` returns `{ status: 'degraded', details: '...' }` |
| Adapter does not import kernel | Static analysis: adapter package has no imports from `kernel/` |
| Namespace enforcement | Adapter configures worker with write restrictions → worker writes to non-namespace path → adapter reports it (or worker tool restriction prevents it) |

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Contract-first development (D-098) | This document is the contract, written before implementation |
| lib/contracts boundary (D-019) | Adapter contract lives in `lib/contracts`; adapter implementations live in `adapters/` |
| Adapter never decides completion (D-030) | Forbidden fields section enforces; N2, N3 MUST NOT rules |
| Adapter normalizes output (D-074) | `RunAttemptResult` is normalized form of raw worker output |
| Worker self-report is not completion (D-028) | `worker_reported_status` labeled as CLAIM ONLY |
| Hook does not decide truth (D-031) | `hook_event_refs` are raw references passed through without evaluation |
| No kernel imports (D-020, D-027) | Dependencies: `lib/contracts` → adapter; no reverse import |

---

## Conceptual Examples

### WorkerHealth (healthy)
```json
{
  "status": "healthy",
  "last_checked": "2026-06-18T14:30:00Z",
  "details": null
}
```

### WorkerHealth (degraded)
```json
{
  "status": "degraded",
  "last_checked": "2026-06-18T14:30:00Z",
  "details": "Worker responding with 3000ms average latency, threshold is 1000ms"
}
```

### WorkerHealth (unavailable)
```json
{
  "status": "unavailable",
  "last_checked": "2026-06-18T14:30:00Z",
  "details": "Worker process not running. Last known PID 48291 terminated unexpectedly."
}
```

### RunAttemptInput
```json
{
  "attempt_id": "attempt-abc123-001",
  "task_run_id": "taskrun-auth-core-001",
  "worker_id": "claude-code-worker-1",
  "workspace_path": "/home/praxis/workspaces/plan-auth-v1/task-auth-core-impl/",
  "namespace": ["src/auth/login.ts", "src/auth/session.ts", "tests/auth/"],
  "allowed_paths": ["src/auth/", "tests/auth/", "src/auth/types.ts", "package.json"],
  "prompt_ref": "prompts://plan-auth-v1/task-auth-core-impl/prompt.txt",
  "hook_config_ref": "hooks://claude-code-pre-post-tool.json",
  "budget": {
    "time_limit_ms": 300000,
    "token_limit": 200000,
    "max_attempts": 5
  }
}
```

### RunAttemptResult (success)
```json
{
  "attempt_id": "attempt-abc123-001",
  "process_exit_code": 0,
  "stdout_ref": "evidence://attempt-abc123-001/stdout.log",
  "stderr_ref": "evidence://attempt-abc123-001/stderr.log",
  "diff_ref": "evidence://attempt-abc123-001/diff.patch",
  "changed_files": ["src/auth/login.ts", "src/auth/session.ts", "tests/auth/login.test.ts"],
  "hook_event_refs": [
    "evidence://attempt-abc123-001/hooks/pre-tool-001.json",
    "evidence://attempt-abc123-001/hooks/post-tool-001.json",
    "evidence://attempt-abc123-001/hooks/pre-tool-002.json",
    "evidence://attempt-abc123-001/hooks/post-tool-002.json"
  ],
  "worker_reported_status": "completed",
  "error_signals": null,
  "started_at": "2026-06-18T14:30:00.000Z",
  "ended_at": "2026-06-18T14:33:45.500Z",
  "duration_ms": 225500
}
```

### RunAttemptResult (crash)
```json
{
  "attempt_id": "attempt-abc123-002",
  "process_exit_code": null,
  "stdout_ref": "evidence://attempt-abc123-002/stdout.log",
  "stderr_ref": "evidence://attempt-abc123-002/stderr.log",
  "diff_ref": "evidence://attempt-abc123-002/diff.patch",
  "changed_files": ["src/auth/login.ts"],
  "hook_event_refs": [
    "evidence://attempt-abc123-002/hooks/pre-tool-001.json"
  ],
  "worker_reported_status": "crashed",
  "error_signals": {
    "signal_type": "CrashSignal",
    "message": "Worker process terminated with signal SIGSEGV",
    "details": {
      "stack_trace": "Segmentation fault at 0x7f8a2c001000",
      "signal_code": 11
    }
  },
  "started_at": "2026-06-18T14:35:00.000Z",
  "ended_at": "2026-06-18T14:35:12.300Z",
  "duration_ms": 12300
}
```

---

## Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Should adapters be long-lived processes (daemon mode) or spawned per attempt? | OPEN — Day 0 Spike should inform |
| Q2 | How does the adapter handle partial output buffering (streaming stdout vs. waiting for completion)? | OPEN — implementation detail |
| Q3 | Should the adapter pre-validate `allowed_paths` before launching the worker, or trust the worker's tool restrictions? | OPEN — defense-in-depth suggests both |
| Q4 | What is the grace period between SIGTERM and SIGKILL in `abortAttempt()`? | OPEN — 5 seconds is a reasonable default, spike to confirm |
| Q5 | Should `hook_event_refs` be a reference (like stdout_ref) or inline event data? | OPEN — P0.2 contracts port will determine |

---

## Audit Notes

- The adapter contract is the most critical boundary for Law 1 enforcement. Every adapter implementation must be audited against the MUST NOT rules (N1–N10) before integration.
- The `worker_reported_status` field is intentionally named with "reported" to signal it is a claim, not a verdict. This naming convention should be preserved in all adapter implementations.
- `ErrorSignal` is a discriminated union on `signal_type`. All adapter implementations must use the exact signal type strings listed. Adding new signal types requires updating this contract.
- The adapter's mechanical nature is its safety property: if an adapter does only I/O normalization and never evaluates, it cannot introduce truth errors. The forbidden fields section is the primary enforcement mechanism.
- Evidence references (`stdout_ref`, `stderr_ref`, `diff_ref`, `hook_event_refs`) use URI-like strings. The exact reference scheme (file paths, content-addressed store keys, stream IDs) will be defined during P2 implementation.
