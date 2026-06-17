# Claude Code Adapter Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the Claude Code adapter specifics, including Day 0 Spike gates, the primary (headless + praxis-hook) integration path, Claude local loop vs. PRAXIS supervisory loop separation, rate limit detection, crash detection, divergence signal handling, and the hard boundary that the adapter NEVER decides completion. This document is the implementation blueprint for `adapters/claude-code/`.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The Claude Code adapter is the concrete implementation of the `WorkerAdapter` contract for Anthropic's Claude Code CLI tool. It knows Claude Code's specific mechanics -- CLI invocation, headless mode, hook configuration, settings file format, environment variables, output patterns -- but it does NOT know how to evaluate whether Claude Code's output is correct. That evaluation belongs to the Truth Engine.

This document specifies exactly what the adapter does, what it must NOT do, and how the Day 0 Spike gates the adapter's implementation.

---

## Scope

- Day 0 Spike requirements and GO/NO-GO criteria that gate all Claude Code adapter implementation
- Primary integration path: headless mode + `praxis-hook` for PreToolUse/PostToolUse/Stop capture
- Adapter responsibilities: config building, workspace preparation, CLI invocation, output capture, result normalization
- Claude local loop vs. PRAXIS supervisory loop: why they are independent and must remain so
- Rate limit detection: signal patterns and normalization to `RateLimitSignal`
- Crash detection: process-level failure recognition
- Divergence signal handling: hook-captured vs. claude-reported output discrepancies
- The hard boundary: adapter NEVER decides completion; NO adapter-owned FinalGate; NO direct shared writes
- Messages API fallback trigger: Day 0 Spike NO-GO (delegated design to `docs/pipelines/messages-api-fallback.md`)

---

## Non-Goals

- Generic WorkerAdapter contract (see `docs/pipelines/worker-adapter.md`)
- Hook event capture mechanism (see `docs/pipelines/praxis-hook-capture.md`)
- Messages API fallback implementation details (see `docs/pipelines/messages-api-fallback.md`)
- Truth Engine gate logic (belongs in `kernel/truth-engine`)
- Evidence Hash Chain construction (belongs in `kernel/evidence`)
- RIM repair strategy logic
- Circuit Breaker logic
- Any other worker adapter (OpenCode, local model -- each has its own spec)

---

## Authoritative Decisions Used

| Decision ID | Decision | How It Applies |
|-------------|----------|----------------|
| D-070 | Primary path: Claude Code headless + praxis-hook | This document defines the primary integration path; the adapter implements it |
| D-071 | Fallback path: Messages API if Day 0 Spike NO-GO | Fallback is gated; this document specifies the trigger condition |
| D-072 | Day 0 Spike must verify headless, hooks, divergence, rate limit ceiling | Day 0 Spike requirements specified in full in this document |
| D-073 | Claude adapter is an external worker bridge | This document defines the bridge specifics for Claude Code |
| D-074 | Adapter starts processes, prepares env/config/prompts, normalizes results | All Claude Code-specific mechanics |
| D-075 | Claude adapter does not decide completion | Structurally enforced: no verdict field, no gate logic, no truth evaluation |
| D-076 | Claude local loop is separate from PRAXIS supervisory loop | Two-loop model defined in detail in this document |
| D-077 | Claude Code implementation must not start before Day 0 Spike GO | Implementation gate: all P4 Claude Code work is blocked until Spike returns GO |
| D-078 | Two-layer autonomous model | Claude local loop + PRAXIS supervisory loop mapped to adapter + kernel |
| D-079 | Claude local loop uses tools, edits files, runs commands, stops | Adapter does not interfere with Claude's internal tool-use loop |
| D-080 | PRAXIS supervisory loop admits, captures, verifies, repairs, controls safety | Kernel operates outside and above Claude's loop |
| D-030 | Adapter never decides completion | No adapter method returns a verdict |
| D-028 | Worker self-report is not completion | Claude's "done" message is `worker_reported_status`, not a verdict |
| LAW 1 | Agent says done is not done | Claude saying "done" is evidence, not completion |
| LAW 2 | No worker writes shared integration files | Claude operates in isolated workspace; adapter enforces |
| LAW 3 | FinalGate criteria from human-authored TaskSpec only | Claude does not see or modify acceptance criteria |

---

## Conceptual Model

The Claude Code adapter is a machine operator for a Claude Code process. It starts Claude, gives it a task, watches it work, and reports what happened. It does not interpret Claude's output for correctness. It does not decide whether Claude "did a good job." It reports mechanics, not quality.

```
+------------------------------------------------------------------+
|                        PRAXIS RUNTIME                             |
|                                                                  |
|  kernel/core (FSM)      kernel/truth-engine      kernel/evidence |
|       |                        |                        |         |
|       | "run attempt"           | "was it correct?"      | "what  |
|       v                        v                        | happened|
|  +--------------------------------------------------+   | exactly"|
|  |        Claude Code Adapter (adapters/claude-code) |   |        |
|  |                                                  |   |        |
|  |  [Claude-specific mechanics]                     |   |        |
|  |  1. Build CLI command with --headless            |   |        |
|  |  2. Write Claude settings with hook config       |   |        |
|  |  3. Prepare environment (ANTHROPIC_API_KEY, etc) |   |        |
|  |  4. Spawn: claude --headless --settings <path>   |   |        |
|  |  5. Capture stdout/stderr/exit code              |   |        |
|  |  6. Detect rate limits, crashes, timeouts        |   |        |
|  |  7. Collect hook event file refs                 |   |        |
|  |  8. Normalize to RunAttemptResult                |   |        |
|  |                                                  |   |        |
|  |  NEVER:                                          |   |        |
|  |  - Decides if Claude output is correct           |   |        |
|  |  - Evaluates whether the task is complete        |   |        |
|  |  - Emits a gate verdict (PASS/HOLD/FAIL)         |   |        |
|  |  - Writes shared integration files               |   |        |
|  |  - Modifies Claude's internal loop               |   |        |
|  +--------------------------+-----------------------+   |        |
|                             |                           |        |
+-----------------------------+---------------------------+--------+
                              | process spawn / stdio
                              v
              +-------------------------------+
              |     Claude Code Process       |
              |     (claude --headless)        |
              |                               |
              |  Claude's Internal Loop:       |
              |  Think → Tool Use → Observe    |
              |    → Think → Tool Use → ...    |
              |    → Stop (claim done)         |
              |                               |
              |  Hook calls on each tool use:  |
              |  PreToolUse → praxis-hook      |
              |  PostToolUse → praxis-hook     |
              |  Stop → praxis-hook            |
              +-------------------------------+
```

### The Two Independent Loops

PRAXIS uses a two-layer autonomous model. The two loops are independent and must remain so.

**Claude Local Loop (internal to the Claude Code process):**
```
Claude thinks → Claude decides to use a tool → Claude calls PreToolUse hook
  → Claude executes the tool → Claude calls PostToolUse hook
  → Claude observes the tool output → Claude thinks again
  → ... (repeat until Claude decides to stop) ...
  → Claude calls Stop hook → Claude process exits
```
Claude's internal loop is unchanged. Claude decides what tools to use, what files to edit, what commands to run. PRAXIS does not intercept, modify, or influence Claude's decision-making. The hooks observe; they do not control.

**PRAXIS Supervisory Loop (external to Claude, in the kernel):**
```
PSAG admits plan → FSM creates TaskRun → Governor grants worker slot
  → Adapter launches Claude Code process → Hooks capture tool events
  → Kernel builds KernelOwnedTranscript from hook events → Evidence captured
  → Truth Engine runs EvidenceGate → ExecGate → FinalGate
  → PASS → COMPLETE / HOLD → RIM repair / FAIL → human review
  → Circuit Breaker monitors system health
  → Governor adjusts concurrency
```
The supervisory loop does not participate in Claude's tool-use decisions. It observes Claude's actions through hooks and evaluates Claude's results through gates. It operates at the attempt level, not the tool-call level.

**Why the loops must be independent:**
- If PRAXIS controlled Claude's tool choices, PRAXIS would be the agent -- and then PRAXIS could not independently verify the agent's output (circular verification).
- If Claude's "done" signal directly caused PRAXIS to mark COMPLETE, then LAW 1 would be violated (agent says done = done).
- Separation ensures that Claude can operate at full autonomy while PRAXIS can independently evaluate Claude's output against human-authored criteria.

---

## Data / Control Flow

### Primary Path (Headless + Hooks) -- GO Scenario

```
+-------------+    +----------------+    +-------------------+    +----------------+
| Build       |--->| Prepare        |--->| Launch            |--->| Capture        |
| Config      |    | Workspace      |    | claude --headless |    | Output         |
+-------------+    +----------------+    +-------------------+    +----------------+
      |                  |                       |                        |
      v                  v                       v                        v
  CLI arguments      Write prompt          Claude Code              stdout captured
  --headless         to workspace          process starts           stderr captured
  --settings <path>  Install hook          Hook config active       exit code captured
  --no-permissions   settings file         PreToolUse fires         hook event refs
  (task-specific)    Set env vars           on each tool use        collected
                     (ANTHROPIC_API_KEY)   PostToolUse fires        diff captured
                                           on each tool use        worker_reported_
                                           Stop fires               status extracted
                                           on completion
      |                  |                       |                        |
      +------------------+-----------------------+------------------------+
                                                  |
                                                  v
                                        +------------------+
                                        | Normalize        |
                                        | Result           |
                                        +------------------+
                                                  |
                                                  v
                                        RunAttemptResult
                                        (returned to kernel)
                                        NO verdict field
```

### What Happens at Each Stage

#### 1. Build Config

The adapter constructs the Claude Code CLI invocation from `RunAttemptInput`.

**CLI arguments constructed:**
```
claude \
  --headless \                          # Non-interactive mode; no TUI
  --settings <path/to/settings.json> \  # Hook config lives here
  --no-permissions \                    # Bypass interactive permission prompts
  --output-format json \                # Structured output for parsing
  --max-turns <budget derived> \        # Prevent infinite loops
  --model <model from config> \         # Which Claude model to use
  --workspace <input.workspace_path> \  # Working directory
  < task_prompt.txt                     # Task description from stdin or --prompt
```

**Settings file contents (written by adapter before launch):**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "praxis-hook pre-tool"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "praxis-hook post-tool"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "praxis-hook stop"
          }
        ]
      }
    ]
  }
}
```

#### 2. Prepare Workspace

Sets up the environment where Claude Code will run:
- Verifies workspace directory exists at `input.workspace_path`
- Writes the task prompt to a known file (e.g., `workspace/.praxis/task_prompt.txt`)
- Writes the hook settings file (e.g., `workspace/.praxis/claude_settings.json`)
- Sets environment variables: `ANTHROPIC_API_KEY`, `PRAXIS_ATTEMPT_ID`, `PRAXIS_TASK_RUN_ID`, `PRAXIS_RUNTIME_URL`, `PRAXIS_WORKSPACE_PATH`, `PRAXIS_NAMESPACE`
- Ensures `praxis-hook` binary is on PATH or at a known absolute path
- Validates that `workspace_path` is within `input.allowed_paths`

The environment variables `PRAXIS_ATTEMPT_ID`, `PRAXIS_TASK_RUN_ID`, and `PRAXIS_RUNTIME_URL` are how the hook binary knows where to POST events and how to tag them. The adapter owns setting these; the hook owns reading them.

#### 3. Launch claude --headless

Spawns the Claude Code process. This is the standard `runAttempt` stage from the generic adapter pipeline, specialized for Claude Code:

- Spawns `claude` as a child process with the constructed CLI arguments
- Streams stdout and stderr to capture buffers
- Monitors process lifecycle: running, exited, crashed, timed out
- Enforces `input.budget.timeout_ms`; kills process if exceeded
- While Claude runs, praxis-hook is called on every PreToolUse, PostToolUse, and Stop event (see `docs/pipelines/praxis-hook-capture.md`)

**This stage does NOT:**
- Parse Claude's output for correctness
- Intercept or modify Claude's tool calls
- Decide whether Claude is "doing well"
- Communicate with Claude except through stdout/stdin and exit code

#### 4. Capture Output

After Claude exits, the adapter collects all artifacts:
- stdout and stderr from process buffers → written to capture files
- git diff of workspace → written to diff capture file
- Changed files list → enumerated
- Hook event file references → collected (paths to files written by praxis-hook)
- Worker self-reported status → extracted from Claude's stdout (e.g., the final message before Stop)

Rate limit and crash detection happen during this stage by examining the captured output.

#### 5. Normalize Result

Transforms Claude-specific raw output into the standard `RunAttemptResult`:
- Map exit code to `process_exit_code`
- Reference capture files via `stdout_ref`, `stderr_ref`, `diff_ref`
- Attach `changed_files`, `hook_event_refs`, `worker_reported_status`
- Classify error signals:
  - Rate limit patterns in stderr → `RateLimitSignal`
  - Crash patterns (SIGSEGV, non-zero exit not attributable to rate limit) → `CrashSignal`
  - Timeout enforced by adapter → `TimeoutSignal`
- Return the `RunAttemptResult` to the kernel

**This is where the adapter's job ends.** The `RunAttemptResult` contains NO verdict. It is raw evidence. The Truth Engine takes over from here.

---

## Day 0 Spike

The Day 0 Spike is a mandatory gating activity. It must be completed and return GO before any Claude Code adapter implementation begins. Per D-072 and D-077, the Spike gates P4.

### Spike Purpose

Prove that Claude Code headless mode + praxis-hook integration is viable for PRAXIS's requirements. The Spike answers: can we reliably run Claude Code in headless mode, capture every tool event through hooks, detect divergence between hook-captured output and Claude's reported output, and understand the practical rate limit ceiling?

### Spike Requirements (All Must Be Verified)

#### S1: Headless Mode Verification
- Verify `claude --headless` launches and completes a simple coding task without TUI interaction
- Verify the process exits with a predictable exit code (0 for success, non-zero for failure/error)
- Verify stdout contains the full conversation transcript
- Verify the process can be killed with SIGTERM and responds within the grace period
- Verify the process respects `--max-turns` and stops after the configured turn limit

**GO criterion:** Headless mode works reliably for at least 20 consecutive simple tasks without hanging, crashing, or requiring interactive input.

#### S2: Hook Reliability Verification
- Verify PreToolUse hook fires BEFORE every tool invocation with the tool name and input
- Verify PostToolUse hook fires AFTER every tool invocation with the tool output
- Verify Stop hook fires when Claude decides to stop (with stop reason)
- Verify hooks fire for ALL tool types Claude Code uses (Read, Write, Edit, Bash, etc.)
- Verify hook events are NOT missed (e.g., rapid successive tool calls -- does the Nth call's PreToolUse always fire?)
- Verify hook execution does not materially slow down Claude's tool execution (< 100ms per hook call)
- Verify hook failure does not crash or hang the Claude Code process (hook is fire-and-forget)

**GO criterion:** Over 100+ tool calls across 10+ sessions, zero missed hook events, zero Claude Code crashes caused by hooks. Hook latency is under 100ms for 99th percentile.

#### S3: Divergence Detection Feasibility
- Verify that hook-captured PreToolUse input matches what Claude reports it used
- Verify that hook-captured PostToolUse output matches what Claude reports it observed
- Identify at least one real scenario where Claude's self-reported output diverges from hook-captured output
- Measure the latency between hook-captured event time and Claude's internal event time
- Verify that hook events are timestamped at capture time, not processing time

**GO criterion:** Divergence is detectable. At least one real divergence scenario is documented. Hook timestamps are accurate to within 1 second of the actual tool execution time.

#### S4: Rate Limit Ceiling Measurement
- Run Claude Code headless in a tight loop (20+ tasks back-to-back) and measure when rate limiting begins
- Identify the exact rate limit response pattern (HTTP 429, specific error message in stderr, token bucket behavior)
- Measure the practical ceiling: how many tasks can run before rate limiting? How long is the cooldown?
- Test whether rate limits are per-API-key, per-organization, or per-process
- Determine if rate limits affect different Claude models differently
- Test whether Claude Code itself handles rate limit retries internally or surfaces the error immediately

**GO criterion:** The practical ceiling is known. The rate limit response pattern is identified. PRAXIS can design its retry/cooldown strategy around real ceiling data.

#### S5: Headless Stability Under Load
- Run Claude Code headless for an extended session (50+ tool calls) and verify no degradation
- Test with increasingly large codebases (100 files, 500 files, 1000 files)
- Test with increasingly complex tasks (single-file edit, multi-file refactor, test suite generation)
- Verify that stdout/stderr remain capturable throughout (no buffer overflow, no truncation)
- Verify that hook events continue to fire after long-running sessions (> 30 minutes)

**GO criterion:** Headless mode is stable for sessions up to 30 minutes with 100+ tool calls. No silent failures or missed captures.

### Spike Deliverables

The Spike must produce a written report containing:
1. GO or NO-GO verdict with evidence for each of S1-S5
2. Raw session logs from all Spike test runs
3. Hook event capture logs showing every PreToolUse/PostToolUse/Stop event
4. Divergence scenario documentation (if any found)
5. Rate limit ceiling data: tasks/hour ceiling, cooldown duration, exact error pattern
6. Any unexpected behaviors or edge cases discovered
7. Updated risk assessment for the headless + hooks approach

### GO/NO-GO Decision

**GO:** All five Spike requirements (S1-S5) pass their GO criteria. The headless + hooks path is viable. P4 implementation proceeds with the Claude Code adapter as specified in this document.

**NO-GO:** One or more Spike requirements fail. The headless + hooks path is NOT viable for PRAXIS's requirements. The fallback path (Messages API with PRAXIS-instrumented tools) is activated. See `docs/pipelines/messages-api-fallback.md`.

**PARTIAL-GO:** Some requirements pass, some have acceptable workarounds. The Spike report documents which requirements have caveats. Human project owner decides GO/NO-GO based on risk tolerance.

---

## Detection Responsibilities

### Rate Limit Detection

The adapter detects rate limiting by examining Claude Code's stderr output for known patterns:

| Pattern | Example | Detection Method |
|---------|---------|-----------------|
| HTTP 429 in stderr | `Error: 429 Too Many Requests` | Regex match for `429` in stderr |
| Rate limit message | `Rate limit exceeded. Please wait...` | Regex match for `rate limit` (case-insensitive) |
| Token bucket exhausted | `You have reached your usage limit` | Regex match for known Anthropic API error strings |
| Organization limit | `Organization rate limit reached` | Regex match |
| Retry-after header value | `Retry-After: 300` | Parsed from stderr if present |

**What the adapter does on detection:**
- Attaches a `RateLimitSignal` to `RunAttemptResult.error_signals`
- Includes `retry_after_ms` if available
- Does NOT retry internally (retry is a kernel/RIM decision)
- Does NOT block or sleep (the adapter returns immediately with the signal)

**What the kernel does with the signal (NOT the adapter's concern):**
- The kernel may delay the next attempt for this worker
- The kernel may switch to a different worker/adapter
- The Circuit Breaker may track rate limit frequency as a system health metric
- RIM may factor rate limit into its repair strategy

### Crash Detection

The adapter detects process crashes through process-level signals and exit codes:

| Condition | Detection |
|-----------|-----------|
| Process killed by signal (SIGSEGV, SIGABRT, etc.) | `raw.exit_signal` is not null |
| Process exits with unexpected non-zero code | Non-zero exit code + no rate limit pattern in stderr |
| Process cannot be spawned (binary missing) | Spawn throws ENOENT |
| Process hangs and is killed by timeout | `raw.timed_out === true` → this is a `TimeoutSignal`, not a `CrashSignal` |

**What the adapter does:**
- Attaches a `CrashSignal` with `exit_code`, `exit_signal`, and descriptive `detail`
- Does NOT restart the process (restart is a kernel/RIM decision)

**Distinction: crash vs. task failure.**
A non-zero exit code from Claude is NOT necessarily a crash. Claude may exit with code 1 because it could not complete the task (e.g., it determined the task is impossible). The adapter does not distinguish "crash" from "Claude decided it failed" -- that distinction is EvidenceGate/ExecGate territory. The adapter reports the exit code and any signal. The Truth Engine interprets.

### Divergence Signal Handling

Divergence is detected when hook-captured tool events contradict Claude's self-reported output. The adapter itself does NOT detect divergence -- divergence detection belongs to `kernel/evidence` (specifically the divergence-detector module). However, the adapter plays a critical role:

**Adapter's role:**
- Collects `hook_event_refs` pointing to hook-captured event files
- Collects Claude's self-reported status as `worker_reported_status`
- Includes Claude's own transcript from stdout as raw evidence
- Does NOT compare them, does NOT flag discrepancies

**Kernel's role (not the adapter):**
- Compares hook-captured PreToolUse input against Claude's reported tool input
- Compares hook-captured PostToolUse output against Claude's reported tool output
- Compares hook-captured Stop reason against Claude's reported completion reason
- If discrepancies exist, classifies as divergence
- Divergence feeds into: EHC break classification, ExecGate evaluation, Circuit Breaker triggers

The adapter must ensure that `hook_event_refs` is accurate and complete, because the kernel's divergence detection depends on it. If the adapter fails to collect hook event refs, divergence cannot be detected.

---

## What the Claude Code Adapter MUST NOT Do

### NO Adapter-Owned FinalGate

The adapter has ZERO gate authority. It does not evaluate whether Claude's output meets acceptance criteria. It does not decide whether the task is complete. It does not assign a PASS, HOLD, or FAIL. Any gate-like logic in the adapter is a LAW 1 violation.

Specifically, the adapter MUST NOT:
- Check whether `changed_files` matches acceptance criteria
- Check whether tests passed based on stdout content
- Evaluate whether Claude "did enough work"
- Short-circuit and mark the attempt complete because exit code was 0 and Claude said "done"
- Have any method, type, or variable named with "gate", "verdict", "complete", "pass", "fail", or "hold" in an evaluative sense

### NO Direct Shared Writes

The adapter writes ONLY within `input.workspace_path` and `input.allowed_paths`. It does not write to shared integration files. It does not produce patches that the assembler did not request. It does not modify the PRAXIS repository, the event log, the database, or any kernel-owned state.

### NO Truth Decisions

The adapter reports mechanics. It does not evaluate correctness. Questions the adapter MUST NOT answer:
- "Was Claude's output good?" -- Truth Engine answers
- "Should we retry this task?" -- RIM answers
- "Did Claude actually do the task?" -- EvidenceGate answers
- "Did the tests really pass?" -- ExecGate answers
- "Are all acceptance criteria met?" -- FinalGate answers

### NO Loop Interference

The adapter starts Claude and lets it run. It does not:
- Intercept and modify Claude's tool calls
- Inject additional instructions mid-session (beyond the initial prompt)
- Override Claude's tool choices
- Terminate Claude early because "it looks like it's going in circles" (timeout enforcement is the only permitted kill reason)
- Communicate with Claude outside of the initial prompt and stdin

---

## MUST / MUST NOT Rules

### MUST

- Implement the full `WorkerAdapter` contract (see `docs/pipelines/worker-adapter.md`)
- Use Claude Code headless mode (`--headless`) as the primary invocation method
- Write a valid Claude Code hook settings file before every attempt launch
- Set `PRAXIS_ATTEMPT_ID`, `PRAXIS_TASK_RUN_ID`, `PRAXIS_RUNTIME_URL`, and `PRAXIS_WORKSPACE_PATH` environment variables before spawning Claude
- Captured stdout, stderr, exit code, diff, and changed_files for every attempt
- Detect rate limits via stderr pattern matching and produce `RateLimitSignal`
- Detect crashes via exit signal and produce `CrashSignal`
- Enforce `budget.timeout_ms` and produce `TimeoutSignal` when the limit is exceeded
- Collect `hook_event_refs` pointing to all hook-captured event files
- Extract `worker_reported_status` from Claude's final message verbatim
- Return `RunAttemptResult` with NO verdict field
- Pass the Day 0 Spike GO criteria before any implementation begins

### MUST NOT

- Start implementation before Day 0 Spike returns GO (D-077)
- Emit a PASS/HOLD/FAIL verdict
- Evaluate completion, correctness, or quality of Claude's output
- Evaluate acceptance criteria
- Write shared integration files
- Modify files outside `workspace_path` and `allowed_paths`
- Intercept, modify, or suppress Claude's tool calls
- Inject instructions into Claude's session mid-execution
- Retry failed attempts internally (retry belongs to kernel/RIM)
- Make truth decisions based on Claude's exit code or self-reported status
- Use `worker_reported_status` to skip evidence capture or gate evaluation
- Import from `kernel/*`, `interface/*`, or `server/*` (adapter imports only `lib/contracts`)
- Contain any field, method, or type name suggesting gate authority or completion decision

---

## Failure Modes

| Failure | Detection | Adapter Response | Downstream Effect |
|---------|-----------|-----------------|-------------------|
| Claude Code binary not found | healthCheck → unavailable | Return unavailable | No attempt. Select different worker or fail task. |
| ANTHROPIC_API_KEY not set | healthCheck → unavailable | Return unavailable | No attempt. |
| Claude exits 0, produced no diff, claims "done" | Normal run + capture | Return accurate `RunAttemptResult` (empty diff, worker_reported_status: "done") | EvidenceGate → HOLD (empty diff). DivergenceDetector flags claim vs. evidence mismatch. |
| Claude exits 0, produced diff, tests fail | Normal run + capture | Return accurate result (exit 0, diff present, worker_reported_status: "task completed") | ExecGate evaluates test output → HOLD (tests fail). FinalGate evaluates criteria → HOLD/FAIL. |
| Claude hits rate limit mid-session | Stderr pattern match | Return `RateLimitSignal` | ExecGate → HOLD. RIM may retry after cooldown. Circuit Breaker tracks rate limit frequency. |
| Claude process crashes (SIGSEGV) | Process exits with signal | Return `CrashSignal { exit_signal: 'SIGSEGV' }` | ExecGate → HOLD/FAIL. Evidence preserved up to crash point. |
| Claude process hangs (no output for budget.timeout_ms) | Timeout enforcement | Kill process, return `TimeoutSignal` | ExecGate → HOLD. Partial evidence captured. RIM may retry with shorter budget. |
| Hook binary not found | Claude's hook config references missing binary | Hook events not captured. hook_event_refs empty. | ExecGate → HOLD (missing transcript). Divergence detection unavailable. |
| Hook runtime server unreachable | praxis-hook cannot POST events | Hook spools to local file (see hook spec). Adapter collects spool refs. | Server ingests spool on recovery. Evidence delayed but not lost. |
| Claude produces output but hook events are missing (hook failure) | hook_event_refs empty or incomplete | Adapter returns available refs; annotates that hooks may have failed | DivergenceDetector flags missing hook events. EHC break classification evaluates the gap. |
| Settings file malformed | Claude fails to start or ignores hooks | Adapter detects Claude startup failure or missing hook events | Attempt may be retried with corrected settings. |
| Claude leaves workspace in indeterminate state | Filesystem capture | Adapter captures whatever state exists | EvidenceGate evaluates actual state. Assembler validates on integration. |

---

## Test / Gate Implications

### Day 0 Spike Tests (Pre-Implementation)

The Spike itself must produce test evidence for all five requirements (S1-S5). These are manual integration tests, not automated unit tests. The Spike report is the test evidence.

### Unit Tests (Post-Spike, Pre-P4 Gate)

- Claude command builder: correct CLI arguments for all input configurations
- Claude settings writer: valid JSON with correct hook structure
- Claude env builder: correct environment variables set
- Claude output normalizer: maps all error conditions to correct signal types
- Rate limit detector: recognizes all known rate limit patterns
- Crash detector: recognizes crash signals and distinguishes from task failure
- Claude adapter FULL contract test: success, empty_diff, failing_test, rate_limit, crash, timeout, namespace_violation (using mock or controlled Claude sessions)

### Integration Tests (P4 Gate)

- One real Claude Code attempt in isolated workspace with hooks
- Hook events reach runtime server (PreToolUse, PostToolUse, Stop all present)
- KernelOwnedTranscript built from hook events
- ExecGate evaluates real command output from hook transcript
- Empty-diff false-done is caught in real Claude session
- Rate limit symptom is detected when rate limiting is actually hit
- Adapter does not import from kernel, interface, or server packages

### Decision Compliance Tests (Structural)

- `RunAttemptResult` type returned by Claude adapter has no verdict/completion field (TypeScript structural check)
- Claude adapter package has no imports from `kernel/*` (boundary checker)
- Claude adapter package has no imports from `interface/*` (boundary checker)
- Claude adapter package has no imports from `server/*` (boundary checker)

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Day 0 Spike completed with GO verdict before any adapter implementation (D-077) | [ ] |
| Adapter uses Claude Code headless mode as primary path (D-070) | [ ] |
| Adapter writes valid hook settings file for every attempt | [ ] |
| Adapter sets all required PRAXIS environment variables before spawn | [ ] |
| `RunAttemptResult` contains no PASS/HOLD/FAIL field (D-075, D-030) | [ ] |
| `worker_reported_status` is extracted verbatim; not used for verdict decisions | [ ] |
| Adapter does not import from `kernel/*` (D-027) | [ ] |
| Adapter does not import from `interface/*` (D-027) | [ ] |
| Adapter does not import from `server/*` (D-027) | [ ] |
| Adapter does not write shared integration files (LAW 2) | [ ] |
| Adapter does not evaluate acceptance criteria (LAW 3) | [ ] |
| Adapter does not intercept Claude's tool calls (D-079) | [ ] |
| Claude local loop and PRAXIS supervisory loop are independent (D-076, D-078) | [ ] |
| Rate limit, crash, and timeout are normalized to typed signals | [ ] |
| hook_event_refs is always collected (may be empty if hooks failed, but never omitted) | [ ] |
| Messages API fallback is gated on Day 0 Spike NO-GO; not implemented otherwise (D-071) | [ ] |
| No adapter-owned FinalGate or gate-like evaluation logic | [ ] |

---

## Open Questions

| ID | Question | Owner | Notes |
|----|----------|-------|-------|
| CC-001 | What is the exact Claude Code CLI argument for specifying the task prompt? `--prompt <text>`, `--prompt-file <path>`, or stdin piping? | Day 0 Spike (S1) | Must be determined during Spike. The adapter must use whichever method headless mode reliably supports. |
| CC-002 | Does Claude Code headless mode support JSON output? What is the exact `--output-format` flag? | Day 0 Spike (S1) | If JSON output is available, the adapter can parse structured results. If not, stdout parsing is required. |
| CC-003 | What is the `--max-turns` equivalent in Claude Code? Is there a flag to limit tool-use loops? | Day 0 Spike (S1) | Without a turn limit, Claude could loop indefinitely. The Spike must identify how to cap turns. |
| CC-004 | Does Claude Code retry on rate limit internally, or surface the error immediately? | Day 0 Spike (S4) | If Claude retries internally, the adapter may not see the rate limit until Claude's internal retries are exhausted. |
| CC-005 | Can `praxis-hook` be invoked by absolute path in Claude Code's hook config, or must it be on PATH? | Day 0 Spike (S2) | Absolute path is preferred for reliability but must be verified. |
| CC-006 | What happens when a hook command fails (non-zero exit)? Does Claude Code continue, abort the tool call, or abort the session? | Day 0 Spike (S2) | Hook failure must not crash Claude Code. The Spike must verify this. |
| CC-007 | What is the default Claude Code timeout (if any) for a single session? | Day 0 Spike (S1) | The adapter's budget.timeout_ms should interact cleanly with any Claude-native timeout. |
| CC-008 | Should the adapter include the trace of Claude's internal thinking/reasoning in captured output, or only the final tool calls and results? | Architecture | Including thinking trace aids debugging and auditability but increases capture volume. |

---

## Audit Notes

- This document is DRAFT_FOR_AUDIT v0.1. The Day 0 Spike will provide real-world data that may necessitate revisions to detection patterns, CLI arguments, and failure mode handling.
- The Spike is NOT optional. Per D-077, no Claude Code adapter code may be written before the Spike returns GO. The Spike deliverables listed in this document are the minimum required.
- The hard separation between Claude's local loop and PRAXIS's supervisory loop is the architectural foundation of the adapter design. Any feature that blurs this boundary (e.g., "the adapter could suggest tool choices to Claude") must be rejected unless a new ADR explicitly authorizes it.
- The `--no-permissions` flag bypasses Claude Code's interactive permission prompts. This is required for autonomous execution but must be combined with PRAXIS's namespace enforcement and allowed_paths constraints so Claude cannot access files outside the workspace.
- The adapter's rate limit detection relies on pattern matching Claude Code's stderr. If Claude Code's error format changes in a future version, the adapter's detection may silently fail. The adapter must include version-specific rate limit pattern tests that are updated when Claude Code's target version changes.
- This document was written against `docs/decisions.md` as the canonical source. Any conflict with `architecture.md` or other documents is resolved in favor of `docs/decisions.md`.
- The generic adapter pipeline (`docs/pipelines/worker-adapter.md`) is the parent contract. This document adds Claude Code specifics. Where this document is silent, the generic pipeline applies.
