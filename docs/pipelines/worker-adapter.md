# Worker Adapter Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the generic worker adapter pipeline contract that all PRAXIS worker adapters must implement. The adapter is a mechanical bridge: launch, capture, normalize. It possesses no completion authority, no truth-deciding capability, and no shared-write privilege. This document is tool-agnostic -- it applies to Claude Code, OpenCode, local models, and mock workers equally.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The WorkerAdapter contract defines the mechanical boundary between PRAXIS and an external coding worker process. An adapter's sole purpose is to verify worker health, prepare an isolated workspace, launch the worker, capture all output artifacts, and normalize those artifacts into a structured `RunAttemptResult`. The adapter is a machine operator -- it does not think, judge, or verify. All verification belongs to the Truth Engine in `kernel/truth-engine`.

The five-stage pipeline -- healthCheck, prepareAttempt, runAttempt, captureOutput, normalizeResult -- is the unambiguous sequence every adapter must follow. No step is optional. No step decides truth.

---

## Scope

- The five-stage adapter pipeline: `healthCheck` -> `prepareAttempt` -> `runAttempt` -> `captureOutput` -> `normalizeResult` -> return `RunAttemptResult`
- The `WorkerAdapter` interface contract and each method's responsibilities and constraints
- Input/output types: `WorkerHealth`, `RunAttemptInput`, `RunAttemptResult`
- AdapterError normalization: raw conditions to typed signals (`RateLimitSignal`, `CrashSignal`, `TimeoutSignal`)
- The `worker_reported_status` field and its CLAIM ONLY designation
- The mock adapter contract and its role as the same-contract testing surrogate
- What the adapter MUST NOT do (completion authority, shared writes, gate evaluation, truth decisions)

---

## Non-Goals

- Claude Code-specific implementation details (see `docs/pipelines/claude-code-adapter.md`)
- Hook event capture mechanics (see `docs/pipelines/praxis-hook-capture.md`)
- Messages API fallback design (see `docs/pipelines/messages-api-fallback.md`)
- Gate evaluation or Truth Engine logic (those belong in `kernel/truth-engine`)
- Workspace management, namespace enforcement, or assembly (those belong in `kernel/core` and `kernel/assembler`)
- Evidence Hash Chain construction (belongs in `kernel/evidence`)
- ACCP artifact generation
- RIM repair strategy logic
- Circuit Breaker decision logic

---

## Authoritative Decisions Used

| Decision ID | Decision | How It Applies |
|-------------|----------|----------------|
| D-021 | Adapters integrate external workers | This document defines the exact integration contract |
| D-030 | Adapter never decides completion | The adapter produces normalized evidence; it never emits a PASS/HOLD/FAIL verdict |
| D-028 | Worker self-report is not completion (Law 1) | `worker_reported_status` is a claim, not a verdict; documented as CLAIM ONLY throughout |
| D-073 | Claude adapter is an external worker bridge | This contract defines what "bridge" means mechanically for ALL adapters |
| D-074 | Adapter starts processes, prepares env/config/prompts, normalizes results | These are the adapter's permitted responsibilities; the pipeline encodes them |
| D-075 | Claude adapter does not decide completion | Enforced structurally: no verdict field exists in `RunAttemptResult` |
| D-111 | Parallel work allowed only with namespace ownership | Adapters respect `namespace` and `allowed_paths` boundaries |
| D-031 | Hook never decides truth | Adapter passes hook config and collects hook event refs; evaluates nothing |
| LAW 1 | Agent says done is not done | Adapter role: capture the claim; Truth Engine role: evaluate the claim |
| LAW 2 | No worker writes shared integration files | Adapter must not write outside `workspace_path` and `allowed_paths` |
| LAW 3 | FinalGate criteria from human-authored TaskSpec only | Adapter does not touch, read, or evaluate acceptance criteria |
| D-027 | Dependency direction: kernel <- lib <- server -> adapters | Adapters import only `lib/contracts`; never import from `kernel/*` or `interface/*` |

---

## Conceptual Model

An adapter is a **translator** between PRAXIS's internal attempt model and an external worker process. It knows how to start a specific tool (Claude Code, OpenCode, a local model, or a mock) and how to interpret that tool's mechanical output. It does not know what "correct" output looks like. It does not know whether the task is done.

```
+------------------------------------------------------------+
|                      PRAXIS RUNTIME                        |
|                                                            |
|  kernel/core (FSM)                                         |
|       | requests attempt execution                         |
|       v                                                    |
|  server/runtime (composition root)                         |
|       | selects adapter by worker kind                     |
|       v                                                    |
|  +------------------------------------------------------+ |
|  |              WorkerAdapter (contract)                  | |
|  |                                                      | |
|  |  1. healthCheck()       → WorkerHealth               | |
|  |  2. prepareAttempt()    → workspace/env ready         | |
|  |  3. runAttempt()        → spawn worker process        | |
|  |  4. captureOutput()     → collect artifacts           | |
|  |  5. normalizeResult()   → RunAttemptResult            | |
|  |                                                      | |
|  |  NO gate evaluation. NO truth decision.               | |
|  |  NO shared writes. NO completion authority.           | |
|  +--------------------------+---------------------------+ |
|                             |                             |
|                             v                             |
|  +------------------------------------------------------+ |
|  |         Concrete Adapter Implementation               | |
|  |  (claude-code / opencode / mock-worker / ...)         | |
|  +--------------------------+---------------------------+ |
|                             |                             |
+-----------------------------+-----------------------------+
                              | process spawn / stdio / IPC
                              v
              +-------------------------------+
              |  External Worker Process      |
              |  (Claude Code, OpenCode,      |
              |   local model, mock)          |
              +-------------------------------+
```

The adapter is the outermost layer. It touches the worker process. Everything inside it -- evidence capture, truth evaluation, repair, assembly -- is kernel territory. The adapter hands off a `RunAttemptResult` and its job is done.

---

## Data / Control Flow

### Normal Pipeline (Happy Path)

```
+-----------+    +--------------+    +-----------+    +-------------+    +--------------+
| health    |--->| prepare      |--->| run       |--->| capture     |--->| normalize    |
| Check     |    | Attempt      |    | Attempt   |    | Output      |    | Result       |
+-----------+    +--------------+    +-----------+    +-------------+    +--------------+
     |                |                   |                  |                   |
     v                v                   v                  v                   v
WorkerHealth    workspace/env       worker process      stdout/stderr      RunAttemptResult
  status:         ready              launched            diff snapshot      returned to
  healthy |     prompt set          hook events          hook event refs    kernel/core
  degraded |    hook config'd       streaming            changed files
  unavailable  budget loaded                                                   |
                                                                              v
                                                                     kernel/evidence
                                                                     (gate pipeline)
```

### Abnormal Pipeline (Failure / Timeout / Crash)

```
+-----------+    +--------------+    +-----------+
| health    |--->| prepare      |--->| run       |
| Check     |    | Attempt      |    | Attempt   |
+-----------+    +--------------+    +-----------+
     |                |                   |
     | unavailable     | workspace        | process crash,
     |                 | not writable     | timeout, or
     v                 v                  | rate limit
  REJECT           throw error            v
  (no attempt      (no attempt        +-------------+    +--------------+
   created)         created)          | capture     |--->| normalize    |
                                      | Output      |    | Result       |
                                      +-------------+    +--------------+
                                                            |
                                                            v
                                                       error signals
                                                       attached:
                                                       CrashSignal |
                                                       TimeoutSignal |
                                                       RateLimitSignal
```

### Abort Path (External Interruption)

```
                      +-----------+
                      | abort     |  ← Called when supervisor decides to terminate
                      | Attempt   |    (Circuit Breaker OPEN, budget exhausted,
                      +-----------+     human intervention, task preemption)
                            |
                            v
                      SIGTERM → grace period → SIGKILL
                      cleanup workspace temp files
                      log abort reason
```

---

## Component Responsibilities

### Stage 1: `healthCheck(): Promise<WorkerHealth>`

Called before any attempt is created. Verifies the worker tool is present, functional, and not in a degraded state that would prevent execution.

**What it checks:**
- Worker binary exists and is executable
- Worker binary version is compatible
- Rate limit state (if trackable before launch -- e.g., API quota remaining)
- Auth/credentials are valid (if applicable)
- Basic connectivity to any required external API

**Return type -- `WorkerHealth`:**

```
status: 'healthy' | 'degraded' | 'unavailable'

healthy:
  Worker tool is present, responsive, and ready.
  Attempt can proceed.

degraded:
  Worker tool is present but has warnings.
  Example: near rate limit, older binary version, slow API response.
  Attempt can proceed but is flagged -- downstream may choose to defer or prioritize.

unavailable:
  Worker tool cannot be used.
  Example: binary not found, auth expired, fully rate-limited, API unreachable.
  Attempt is REJECTED. No attempt is created.
```

**Contract:**
```
interface WorkerHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  worker_binary: string;
  worker_version: string;
  degradation_reasons?: string[];
  checked_at: string;  // ISO 8601
}
```

### Stage 2: `prepareAttempt(input: RunAttemptInput): Promise<void>`

Sets up the isolated workspace environment for the attempt. Runs AFTER health check passes, BEFORE the worker process is spawned.

**Responsibilities:**
- Ensure workspace directory exists at `input.workspace_path`
- Write the plan prompt / task description to a known file in the workspace
- Prepare all environment variables the worker process needs
- Install hook configuration (write the hook settings file so the external tool can invoke hooks)
- Validate that `workspace_path` is within `input.allowed_paths`
- Set up any worker-specific scaffolding (test fixtures, config files, language runtime)

**This method MUST NOT:**
- Start the worker process (that is Stage 3: `runAttempt`)
- Modify files outside `workspace_path` and `allowed_paths`
- Decide or evaluate task readiness ("is this task too hard?" -- not the adapter's call)
- Write to shared integration files
- Access kernel state

**Input type -- `RunAttemptInput`:**

```
interface RunAttemptInput {
  attempt_id: string;         // Unique attempt identifier (e.g., "att_01J...")
  task_run_id: string;        // Parent TaskRun identifier
  worker_id: string;          // Worker slot identifier
  workspace_path: string;     // Absolute path to isolated workspace (git worktree)
  namespace: string[];        // Exclusive file path globs this worker owns
  allowed_paths: string[];    // Full list of paths the worker may touch
  prompt_ref: string;         // Path to the plan prompt / task description file
  hook_config_ref: string;    // Path to the hook configuration file (if hooks used)
  budget: AttemptBudget;      // Time, token, and retry limits
}

interface AttemptBudget {
  timeout_ms: number;         // Max wall-clock time for this attempt
  token_limit: number;        // Max tokens the worker may consume
  max_attempts: number;       // Max repair attempts (informational -- RIM enforces)
}
```

**Key constraint:** `prepareAttempt` must be idempotent. If called twice for the same `attempt_id`, the second call is a no-op, not an error. This supports recovery scenarios where the runtime is uncertain whether preparation completed before a crash.

### Stage 3: `runAttempt(input: RunAttemptInput): Promise<RawAttemptOutput>`

Spawns the external worker process and monitors it until completion, crash, or timeout.

**Responsibilities:**
- Build the worker command from `input` (binary path, CLI arguments, env vars)
- Spawn the worker process as a child process
- Stream stdout and stderr into capture buffers (memory or temp files)
- Monitor process lifecycle: running, exited normally, exited with error, killed by signal
- Enforce `input.budget.timeout_ms`: if the worker exceeds the time budget, kill the process
- Return raw output on process exit (including partial output if killed)

**The adapter does NOT interpret output during execution.** It only collects it. The adapter cannot and must not decide whether the worker's output "looks good" or "looks suspicious." Every byte is captured; nothing is filtered.

**Optional callback:**
The `onChunk` callback enables real-time transcript streaming from the adapter to the runtime server and UI:
```
runAttempt(input: RunAttemptInput, onChunk?: (chunk: TranscriptChunk) => void): Promise<RawAttemptOutput>;
```
If `onChunk` is provided, the adapter emits `TranscriptChunk` events for every stdout/stderr chunk. These chunks are evidence of what the worker produced in real time. The callback does not affect adapter behavior -- it is purely an observation hook.

**RawAttemptOutput (internal, not the final result):**
```
interface RawAttemptOutput {
  attempt_id: string;
  stdout_buffer: string;         // Full captured stdout
  stderr_buffer: string;         // Full captured stderr
  exit_code: number | null;      // null if process was killed before exit
  exit_signal: string | null;    // Signal name if killed (SIGTERM, SIGKILL, SIGSEGV, etc.)
  wall_time_ms: number;          // Actual wall-clock time
  timed_out: boolean;            // True if process was killed by budget enforcement
}
```

### Stage 4: `captureOutput(attemptDir: string, raw: RawAttemptOutput): Promise<RawAttemptCapture>`

Collects all output artifacts produced by the worker attempt. Runs AFTER the worker process exits (or is killed). This is a filesystem and artifact collection step, not a process-management step.

**Responsibilities:**
- Write `raw.stdout_buffer` and `raw.stderr_buffer` to files in a known capture directory
- Capture git diff of the workspace (`git diff`): write to a diff capture file
- Collect list of changed files (`git diff --name-only`): write to a file list
- Collect hook event file references (paths to files written by praxis-hook during execution)
- Collect the worker's self-reported status text if available (extracted from stdout or a status file)
- Ensure all captured files are within `allowed_paths`

**Why separate `captureOutput` from `runAttempt`?** Decoupling launch from artifact collection enables:
- Recovery: if `runAttempt` succeeds but the runtime crashes before capture, capture can be re-run from the existing workspace
- Testing: capture logic can be tested independently with pre-recorded raw output
- Flexibility: adapters that intercept output via IPC or files can capture after the fact

**RawAttemptCapture (internal, not the final result):**
```
interface RawAttemptCapture {
  attempt_id: string;
  stdout_ref: string;            // Path to captured stdout file
  stderr_ref: string;            // Path to captured stderr file
  diff_ref: string;              // Path to captured git diff (or empty-file marker)
  changed_files: string[];       // List of changed file paths
  hook_event_refs: string[];     // Paths to hook-captured event files
  worker_reported_status: string | null;  // Worker's own claim about completion
}
```

### Stage 5: `normalizeResult(capture: RawAttemptCapture, raw: RawAttemptOutput, input: RunAttemptInput): RunAttemptResult`

Transforms raw worker output into the standardized `RunAttemptResult` that the kernel consumes. This is the final adapter step.

**Responsibilities:**
- Map process exit code to standardized field
- Classify error conditions into typed `AdapterErrorSignal` values (see Error Normalization below)
- Attach output file references (`stdout_ref`, `stderr_ref`, `diff_ref`)
- Attach `changed_files` list
- Attach `hook_event_refs`
- Attach `worker_reported_status` as a plain-text claim -- NOT evaluated, NOT interpreted
- Attach `wall_time_ms` from the raw output
- Attach any error signals detected

**Return type -- `RunAttemptResult`:**

```
interface RunAttemptResult {
  attempt_id: string;
  process_exit_code: number | null;    // null if process was killed before exit
  stdout_ref: string;                  // Path to captured stdout file
  stderr_ref: string;                  // Path to captured stderr file
  diff_ref: string;                    // Path to captured git diff (or empty-file marker)
  changed_files: string[];            // List of file paths that changed
  hook_event_refs: string[];          // Paths to hook-captured event files
  worker_reported_status: string | null;  // Worker's own claim (CLAIM ONLY -- NOT a verdict)
  error_signals: AdapterErrorSignal[];    // Detected error conditions
  wall_time_ms: number;               // Actual wall-clock time spent
}
```

**CRITICAL: `RunAttemptResult` contains no PASS/HOLD/FAIL field.** The adapter produces evidence. The Truth Engine produces verdicts. The adapter's job ends when `normalizeResult` returns. The kernel's job begins when it receives the `RunAttemptResult`.

### Abort: `abortAttempt(attemptId: string): Promise<void>`

Terminates a running worker process cleanly. Called when external conditions demand it.

**Called when:**
- Supervisor decides to abort (timeout, budget exhausted)
- Circuit Breaker opens during attempt execution
- Human intervention requests abort via API
- Higher-priority task preempts this worker

**Responsibilities:**
- Send SIGTERM to the worker process
- Wait a configurable grace period (default: 5 seconds)
- If process is still running, send SIGKILL
- Clean up workspace temp files if appropriate (preserve captured evidence)
- Log the abort reason

---

## AdapterError Normalization

Adapter errors are normalized into typed signals. This allows the Truth Engine and Circuit Breaker to reason about failure patterns systematically rather than pattern-matching on raw output strings.

| Raw Condition | Signal Type | Detection Method |
|---------------|-------------|-----------------|
| Worker process exceeds timeout | `TimeoutSignal` | `raw.timed_out === true` |
| Worker process crashes (SIGSEGV, uncaught exception, non-zero exit not attributable to rate limit) | `CrashSignal` | Non-zero exit code + no rate limit pattern in stderr |
| Worker process hits API rate limit (stderr contains rate limit messages, HTTP 429 patterns) | `RateLimitSignal` | Pattern match on stderr/stdout for known rate limit signatures |
| Worker binary not found during `runAttempt` | `CrashSignal` (subtype: binary_missing) | Spawn throws ENOENT |
| Workspace not writable | Thrown during `prepareAttempt` -- no attempt created | Filesystem permission check fails |

**Signal type definitions:**

```
type AdapterErrorSignal = RateLimitSignal | CrashSignal | TimeoutSignal;

interface RateLimitSignal {
  signal_type: 'rate_limit';
  timestamp: string;       // ISO 8601
  detail?: string;         // e.g., "HTTP 429 on POST /v1/messages", "Token bucket exhausted"
  retry_after_ms?: number; // If the rate limit response includes a retry-after hint
}

interface CrashSignal {
  signal_type: 'crash';
  timestamp: string;
  detail?: string;         // e.g., "SIGSEGV", "ENOENT: binary not found", "workspace_error"
  exit_code?: number;
  exit_signal?: string;
}

interface TimeoutSignal {
  signal_type: 'timeout';
  timestamp: string;
  detail?: string;         // e.g., "Exceeded budget timeout of 300000ms"
  timeout_ms: number;      // The timeout value that was exceeded
}
```

### `worker_reported_status` is a CLAIM, Not a Verdict

The `worker_reported_status` string carries the worker's own claim about what happened. Examples:

- "Task completed successfully."
- "All tests pass. Ready for review."
- "Done."
- "Rate limit exceeded. Please try again later."
- `null` (worker produced no status message)

The adapter:
- Extracts this claim from worker output verbatim or with minimal normalization (trim, null-to-null)
- Attaches it as `worker_reported_status`
- Does NOT evaluate it
- Does NOT use it to decide whether the attempt succeeded
- Does NOT gate on it
- Does NOT use it to skip evidence capture

The Truth Engine:
- Receives `worker_reported_status` as one evidence item among many
- Cross-references the claim with actual evidence (diff, test output, changed files)
- Flags divergence if the claim contradicts the evidence (e.g., claims "done" but diff is empty)

The UI:
- May display `worker_reported_status` as the worker's claim
- Must display the Truth Engine verdict as the actual completion status
- Must not conflate the claim with the verdict

---

## The Mock Adapter

The mock adapter (`adapters/mock-worker`) must implement the exact same `WorkerAdapter` contract. It simulates worker behavior without launching a real external process. Its outputs are deterministic and configurable, enabling thorough gate testing without depending on Claude Code availability, API keys, or rate limits.

**Required mock behaviors:**

| Mode | `process_exit_code` | `changed_files` | `diff_ref` content | `worker_reported_status` | `error_signals` |
|------|-------------------|-----------------|---------------------|--------------------------|-----------------|
| success | 0 | populated | real-looking diff | "Task completed successfully." | [] |
| empty_diff | 0 | [] | empty | "Task completed successfully." | [] |
| failing_test | 1 | populated | real-looking diff | "Tests are failing." | [] |
| namespace_violation | 0 | populated (outside namespace) | real-looking diff | "Done." | [] |
| crash | null | [] | empty | null | [CrashSignal] |
| rate_limit | 1 | [] | empty | "Rate limit exceeded." | [RateLimitSignal] |
| timeout | null | [] | empty | null | [TimeoutSignal] |
| divergence | 0 | [] | empty | "All tasks completed." | [] |

**Testing mandate:** The mock adapter must be implemented AND fully tested before any real adapter implementation begins. It validates the `WorkerAdapter` contract in isolation and provides the deterministic inputs that P3 kernel safety core tests depend on. Per D-103 and D-104, all mock behaviors must have corresponding test cases.

The mock adapter is not optional. It is a required deliverable of P2 (Mock Runtime Vertical Slice) and a prerequisite for P3 (Kernel Safety Core) testing.

---

## MUST / MUST NOT Rules

### Adapter MUST

- Implement all five pipeline stages in order: `healthCheck` → `prepareAttempt` → `runAttempt` → `captureOutput` → `normalizeResult`
- Return a `WorkerHealth` with status `healthy`, `degraded`, or `unavailable` from `healthCheck`
- Return a `RunAttemptResult` with all required fields populated (null is valid for optional fields)
- Classify errors into typed `AdapterErrorSignal` values (never untyped strings)
- Enforce `budget.timeout_ms` and kill the worker process when exceeded
- Validate that `workspace_path` exists and is writable before spawning the worker
- Pass `worker_reported_status` as a verbatim or minimally-normalized claim, never as a verdict
- Return control to the kernel immediately after `normalizeResult` returns
- Capture ALL worker output (stdout, stderr, exit code) regardless of whether the worker "looks successful"
- Preserve evidence even on failure, crash, or timeout (partial output is still evidence)

### Adapter MUST NOT

- Emit a PASS/HOLD/FAIL verdict (D-030) -- `RunAttemptResult` must have no verdict field
- Decide whether the attempt is complete (LAW 1)
- Write to shared integration files (LAW 2)
- Modify files outside `workspace_path` and `allowed_paths`
- Evaluate acceptance criteria (belongs to Truth Engine FinalGate; LAW 3)
- Build evidence hash chains (belongs to `kernel/evidence`)
- Decide whether evidence is sufficient (belongs to EvidenceGate)
- Access or modify kernel state directly
- Import from `kernel/*` packages (dependency direction violation per D-027)
- Import from `interface/*` packages
- Import from `server/*` packages (server composes adapters, not vice versa)
- Use `worker_reported_status` to short-circuit gate evaluation or skip evidence capture
- Filter or suppress worker output based on content ("this looks like an error, skip it")
- Modify hook event files or hook configuration
- Perform any action that looks like truth evaluation, evidence weighting, or completion judgment

---

## Failure Modes

| Failure | Stage | Detection | Adapter Response | Downstream Effect |
|---------|-------|-----------|-----------------|-------------------|
| Worker binary not found | healthCheck | Binary executable check fails | Return `WorkerHealth { status: 'unavailable' }` | No attempt created. Kernel selects another worker or fails task. |
| Worker binary missing between health check and run | runAttempt | Spawn throws ENOENT | Return `RunAttemptResult` with `CrashSignal { detail: 'binary_missing' }` | EvidenceGate sees no evidence → HOLD or FAIL |
| Auth expired / API key invalid | healthCheck | Credential check fails | Return `WorkerHealth { status: 'unavailable' }` | No attempt created |
| Workspace not writable | prepareAttempt | Filesystem write check fails | Throw error; do not create attempt | Kernel logs error; task may be retried with different workspace |
| Worker process timeout | runAttempt | `raw.timed_out === true` | Kill process with SIGTERM → SIGKILL; return `TimeoutSignal` | ExecGate sees timeout → HOLD; RIM may trigger repair |
| Worker process crash | runAttempt | Process exits with signal or unexpected non-zero code | Return `CrashSignal` with exit details | ExecGate sees crash → HOLD or FAIL; system health degraded |
| API rate limit hit mid-run | runAttempt / captureOutput | Pattern match on stderr for rate limit signatures | Return `RateLimitSignal` with detail | ExecGate sees rate limit → HOLD; Circuit Breaker may track rate limit frequency |
| Worker produces no output | captureOutput | Empty stdout, empty stderr, null exit code | Return `RunAttemptResult` with empty refs | EvidenceGate → HOLD (empty diff) |
| Worker self-reports "done" but diff is empty | normalizeResult | `worker_reported_status` has completion claim; `changed_files` is empty | Return with both fields populated accurately | DivergenceDetector flags mismatch; EHC break may be classified |
| Hook config install fails | prepareAttempt | Hook config file write fails | Log warning; continue without hooks (degraded mode) OR fail attempt (adapter-specific policy) | If continued without hooks: ExecGate sees no hook events → degraded evidence |
| SIGTERM grace period expires | abortAttempt | Process still alive after grace period | Send SIGKILL; log forced kill | Process terminated; partial evidence preserved |

---

## Test / Gate Implications

### Unit Test Requirements (per adapter implementation)

Every adapter implementation must have unit tests covering:

- **healthCheck:** healthy binary found; degraded (near rate limit, old version); unavailable (binary missing, auth expired)
- **prepareAttempt:** workspace created; prompt written; hook config installed; workspace outside allowed_paths throws
- **runAttempt:** process succeeds with exit 0; process fails with exit 1; process times out and is killed; process crashes with signal; onChunk callback receives chunks
- **captureOutput:** diff captured; changed_files enumerated; hook event refs collected; worker_reported_status extracted (or null if absent)
- **normalizeResult:** success mapping; crash normalization (CrashSignal); timeout normalization (TimeoutSignal); rate limit normalization (RateLimitSignal); worker_reported_status preserved verbatim
- **abortAttempt:** SIGTERM sent; SIGKILL sent after grace period; cleanup completes

### Mock Adapter Test Requirements

The mock adapter must pass all of the above tests before any real adapter. Additionally, all 8 mock behaviors (success, empty_diff, failing_test, namespace_violation, crash, rate_limit, timeout, divergence) must have dedicated test cases that verify exact output shapes.

### Phase Gate Implications

| Phase | Adapter Test Requirement |
|-------|-------------------------|
| P2 (Mock Runtime) | Mock adapter passes all contract tests with all 8 behavior modes. SSE events flow from mock worker to desktop. |
| P3 (Kernel Safety) | Truth Engine correctly handles all mock adapter failure modes: empty diff → HOLD, namespace violation → FAIL, crash → HOLD/FAIL, divergence → HOLD/FAIL |
| P4 (Real Worker) | Claude Code adapter passes contract tests (gated on Day 0 Spike GO). Adapter produces `RunAttemptResult` with no verdict field. Hook events arrive. Divergence detected. |
| P5 (Parallel) | Three mock adapters run concurrently without interfering. Three real adapters (post-P4) run concurrently with namespace isolation. |

### False-Done Test Integration

The adapter pipeline is the injection point for false-done scenarios:
- Mock adapter mode `empty_diff` + `worker_reported_status: "Task completed successfully."` tests that the adapter does not filter the claim and that the Truth Engine correctly identifies the divergence
- Mock adapter mode `divergence` tests the full divergence detection pipeline from adapter output through EvidenceGate to EHC break classification

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| `RunAttemptResult` contains no PASS/HOLD/FAIL field (D-030) | [ ] |
| `worker_reported_status` documented as CLAIM ONLY in type and this doc (D-028) | [ ] |
| Adapter imports only from `lib/contracts` and `lib/*` utilities (D-027) | [ ] |
| Adapter does not import from `kernel/*` (D-027) | [ ] |
| Adapter does not import from `interface/*` (D-027) | [ ] |
| Adapter does not import from `server/*` (D-027) | [ ] |
| Adapter does not write outside `workspace_path` and `allowed_paths` (LAW 2) | [ ] |
| Adapter does not evaluate acceptance criteria (LAW 3) | [ ] |
| Adapter does not build evidence hash chains (kernel/evidence territory) | [ ] |
| Adapter does not emit gate verdicts (Truth Engine territory) | [ ] |
| Adapter pipeline follows five-stage sequence without shortcuts | [ ] |
| Error signals are typed (`RateLimitSignal \| CrashSignal \| TimeoutSignal`), not untyped strings | [ ] |
| `RunAttemptInput.namespace` is populated from TaskSpec (D-108) | [ ] |
| `RunAttemptInput.allowed_paths` is authoritative for write boundaries | [ ] |
| Mock adapter implements full `WorkerAdapter` contract with all 8 behavior modes (D-103, D-104) | [ ] |
| Mock adapter tests exist and pass before real adapter implementation | [ ] |
| `worker_reported_status` is not used to short-circuit gate evaluation | [ ] |
| No adapter method has a "completion" or "verdict" return field | [ ] |

---

## Open Questions

| ID | Question | Owner | Notes |
|----|----------|-------|-------|
| WA-001 | Where do `stdout_ref`, `stderr_ref`, `diff_ref` files physically live? In the workspace directory or in a runtime-managed attempt storage directory? | Server/storage design (P2/P3) | The files must persist long enough for the Truth Engine to read them and for ACCP to archive them. Workspace cleanup policy interacts with this. |
| WA-002 | What is the exact grace period between SIGTERM and SIGKILL in `abortAttempt`? | Implementation (P4) | Default 5 seconds, configurable via runtime config. Must be validated on target platforms (Linux/macOS/Windows signal semantics differ). |
| WA-003 | Should `captureOutput` be a separate stage or merged into `runAttempt`? | Architecture | This document mandates separate stages for clarity and recoverability. Concrete adapters may implement them as a single internal call chain if both stages are still independently verifiable. |
| WA-004 | How does the mock adapter simulate `namespace_violation`? Does it write files outside the workspace or fabricate `changed_files` entries? | Mock adapter implementation (P2) | The mock adapter fabricates the output -- it produces `changed_files` entries with paths outside the namespace without actually writing files. The Truth Engine must catch this based on the output shape, not filesystem side effects. |
| WA-005 | Should `RunAttemptResult` include `resource_usage` (peak memory, CPU time) in v0.1? | Architecture | Defer to v0.2. The current type is focused on correctness signals. Resource metering is a Governor concern and can be added when concurrency tiers are implemented (P5). |
| WA-006 | What happens when `healthCheck` returns `degraded`? Does the kernel proceed, defer, or reject? | kernel/core (P3) | The kernel makes this decision, not the adapter. The adapter reports; the kernel evaluates. Likely behavior: proceed with degraded flag, log warning, may deprioritize this worker for future attempts. |

---

## Audit Notes

- This is a DRAFT_FOR_AUDIT v0.1 specification. All methods, types, and rules are subject to revision based on Day 0 Spike feedback, P0.2 contract porting, and P3 kernel safety core implementation.
- The five-stage pipeline is deliberately strict. Shortcuts (e.g., combining `captureOutput` into `runAttempt` silently) are violations of this specification until explicitly permitted by an ADR.
- The `worker_reported_status` CLAIM ONLY designation is a structural enforcement of LAW 1. Any code reviewer who sees `worker_reported_status` used in a conditional that decides PASS/HOLD/FAIL must flag it as a LAW 1 violation.
- The adapter exists at the outermost boundary. It touches the external world (process spawn, filesystem, network). The kernel is pure. The adapter must never let external-world concerns (retry logic, API backoff, timeout handling) leak into truth evaluation.
- The mock adapter is not a convenience -- it is a safety requirement. It is how PRAXIS tests its gate pipeline without live Claude Code dependency. Mock adapter tests failing must block P3.
- This document was written against `docs/decisions.md` as the canonical source. Any conflict with `architecture.md` or other documents is resolved in favor of `docs/decisions.md`.
- The existing `worker-adapter.md` at the time of this rewrite was v0.1 DRAFT_FOR_AUDIT. This document is a complete rewrite to the same version label, replacing the prior draft. The prior draft's `AttemptManifest` type is subsumed into the `RawAttemptOutput` + `RawAttemptCapture` + `RunAttemptResult` chain.
