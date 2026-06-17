# Worker / Adapter Boundary

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** docs/decisions.md
**Purpose:** Define the boundary between PRAXIS and external coding workers (Claude Code, OpenCode, local models) mediated through the WorkerAdapter contract. Establish what adapters do, what they must never do, and how they translate external tool output into structured PRAXIS evidence.

> This document must not override docs/decisions.md. If there is a conflict, docs/decisions.md wins.

---

## Purpose

Adapters are the mechanical bridge between PRAXIS and external worker processes. They launch workers, configure their environment, capture their output, and normalize results into structured types. Adapters are not judges. They do not evaluate correctness, decide completion, or produce gate verdicts. All verification belongs to the kernel Truth Engine.

## Scope

- The `WorkerAdapter` contract and its methods
- Adapter responsibilities: launch, configure, capture, normalize
- What adapters return: `RunAttemptResult` and its fields
- Error signal normalization: `RateLimitSignal`, `CrashSignal`, `TimeoutSignal`
- Mock adapter as contract-compliant test double
- Namespace and workspace constraints on adapters
- What adapters MUST NOT do

## Non-Goals

- Claude Code-specific adapter implementation (see `adapters/claude-code/` design)
- Hook implementation details (see `hooks/praxis-hook/` design)
- Truth Engine gate logic (see `docs/pipelines/evidence-to-truth-engine.md`)
- ACCP artifact compilation (see `kernel/accp/` design)

## Authoritative Decisions Used

| Decision ID | Summary | Status |
|-------------|---------|--------|
| D-021 | `adapters/` integrate external workers | HARD_LOCK |
| D-030 | Adapter never decides completion | HARD_LOCK |
| D-073 | Claude adapter is an external worker bridge | HARD_LOCK |
| D-074 | Adapter starts processes, prepares env/config/prompts, normalizes results | HARD_LOCK |
| D-075 | Claude adapter does not decide completion | HARD_LOCK |
| D-076 | Claude local loop is separate from PRAXIS supervisory loop | HARD_LOCK |
| D-079 | Claude local loop uses tools, edits files, runs commands, stops | HARD_LOCK |
| D-080 | PRAXIS supervisory loop admits, captures, runs gates, dispatches repair, controls safety | HARD_LOCK |
| D-101 | Required contracts include WorkerAdapter, RunAttemptInput, RunAttemptResult | HARD_LOCK |

## Conceptual Model

### ASCII Dependency and Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         KERNEL                                   │
│                                                                  │
│  kernel/core                      kernel/evidence                │
│  (requests attempt via            (consumes RunAttemptResult,    │
│   abstract WorkerAdapter)          builds EvidenceRecords)       │
│                                                                  │
│         │                                    ▲                   │
│         │ calls adapter.runAttempt()          │ raw events via   │
│         ▼                                    │ hooks/praxis-hook │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              WorkerAdapter (lib/contracts)                │   │
│  │              (typed interface, no implementation)         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
└──────────────────────────────┼────────────────────────────────────┘
                               │ implements
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                          ADAPTER                                  │
│                                                                   │
│  adapters/claude-code/    adapters/mock-worker/                   │
│  adapters/opencode/       adapters/local-model/                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Adapter Responsibilities (MECHANICAL ONLY)                  │ │
│  │                                                             │ │
│  │  1. Health-check worker availability                       │ │
│  │  2. Prepare workspace (cwd, env vars, hook config)         │ │
│  │  3. Build prompt from TaskSpec + RepairPacket context      │ │
│  │  4. Launch external worker process                         │ │
│  │  5. Monitor process lifecycle (running, exited, crashed)   │ │
│  │  6. Capture stdout, stderr, exit code                      │ │
│  │  7. Detect rate limits, crashes, timeouts                  │ │
│  │  8. Normalize raw output into RunAttemptResult             │ │
│  │  9. Return structured result (NOT a verdict)               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
└──────────────────────────────┼────────────────────────────────────┘
                               │ launches
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   EXTERNAL WORKER PROCESS                         │
│                                                                   │
│  Claude Code CLI   OpenCode CLI   Local Model Process             │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Worker Internal Loop (PRAXIS does NOT intercept)            │ │
│  │                                                             │ │
│  │  Receive prompt → Think → Use tools → Edit files →          │ │
│  │  Run commands → Self-report status → Exit                   │ │
│  │                                                             │ │
│  │  PRAXIS observes via hooks only.                            │ │
│  │  PRAXIS does NOT control worker's internal decisions.       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              │ hook calls (PreToolUse, etc.)      │
│                              ▼                                    │
│                    hooks/praxis-hook                               │
│                    (captures raw events)                           │
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Principle

```
Adapter is a MACHINE OPERATOR, not a JUDGE.

Machine operator:  Launch process, read output, report what happened.
Judge:             Evaluate correctness, decide completion.  ← KERNEL ONLY
```

## Data / Control Flow

### Attempt Lifecycle Through the Adapter

```
1. kernel/core decides to run an attempt
     │
2. kernel/core calls adapter.healthCheck()
     │  → WorkerHealth { available: boolean, reason?: string }
     │
3. kernel/core calls adapter.runAttempt(input: RunAttemptInput)
     │
4. Adapter prepares environment:
     │  - Sets cwd to assigned workspace
     │  - Prepares env vars (including PRAXIS_HOOK_ENABLED, ATTEMPT_ID, etc.)
     │  - Writes hook config (if applicable)
     │  - Builds prompt from input.taskSpec + input.repairPacket
     │
5. Adapter launches external worker process
     │
6. Worker runs independently
     │  - Hooks capture PreToolUse, PostToolUse, Stop events
     │  - Hook events flow directly to server (not through adapter)
     │
7. Worker process exits (or is killed after timeout)
     │
8. Adapter captures:
     │  - process_exit_code
     │  - stdout content (reference path or inline)
     │  - stderr content (reference path or inline)
     │  - elapsed wall time
     │
9. Adapter detects abnormal terminations:
     │  - Rate limit hit → RateLimitSignal
     │  - Process crash → CrashSignal
     │  - Timeout → TimeoutSignal
     │
10. Adapter normalizes into RunAttemptResult
     │
11. Adapter returns RunAttemptResult to kernel
     │
12. kernel/evidence captures git diff, changed files, test output
     │  (these are NOT adapter responsibilities)
     │
13. kernel/truth-engine runs gates against evidence
```

### RunAttemptResult Structure

```
RunAttemptResult {
  attempt_id: string;                  // matches input
  adapter_id: string;                  // e.g., "claude-code", "mock-worker"
  adapter_version: string;             // adapter implementation version

  process_exit_code: number | null;    // null if killed before exit
  signal: string | null;               // e.g., "SIGTERM", null if normal exit

  stdout_ref: string;                  // reference to captured stdout
  stderr_ref: string;                  // reference to captured stderr

  diff_ref: string | null;             // reference to git diff (captured by kernel, null if no changes)
  changed_files: string[];             // list of changed file paths (reported by worker)

  hook_event_refs: string[];           // references to hook events captured during this attempt

  worker_reported_status: string;      // CLAIM ONLY. e.g., "done", "error", "stopped"
                                        // ↑ THIS IS NOT A VERDICT. It is raw worker output.

  error_signal: ErrorSignal | null;    // normalized error if abnormal termination

  elapsed_ms: number;                  // wall clock time
  started_at: string;                  // ISO 8601
  ended_at: string;                    // ISO 8601
}
```

### ErrorSignal Types

```
ErrorSignal = RateLimitSignal | CrashSignal | TimeoutSignal

RateLimitSignal {
  type: 'rate_limit';
  provider: string;              // e.g., "anthropic"
  retry_after_ms: number | null; // from Retry-After header if available
  raw_message: string;           // original error text
}

CrashSignal {
  type: 'crash';
  exit_code: number | null;
  signal: string | null;         // e.g., "SIGSEGV"
  core_dumped: boolean;
  raw_stderr_tail: string;       // last N lines of stderr
}

TimeoutSignal {
  type: 'timeout';
  timeout_ms: number;            // configured timeout that was exceeded
  elapsed_ms: number;            // how long the process ran
  was_killed: boolean;           // was the process sent SIGTERM/SIGKILL?
}
```

All ErrorSignal types are normalized, machine-readable representations of what happened to the worker process. NONE of them are gate verdicts. The Truth Engine may use ErrorSignal data as evidence, but the adapter does not decide what an ErrorSignal means for completion.

## Component Responsibilities

### Adapter Responsibilities (MUST DO)

| Responsibility | Description |
|---------------|-------------|
| **Health check** | Verify the external worker binary is available and responsive |
| **Environment preparation** | Set cwd, env vars, hook config, authentication tokens |
| **Prompt construction** | Build the prompt from TaskSpec, RepairPacket context, and strategy instructions |
| **Process management** | Launch, monitor, and (if needed) kill the external worker process |
| **Output capture** | Capture stdout, stderr, exit code, and elapsed time |
| **Error detection** | Detect rate limits, crashes, and timeouts; normalize into ErrorSignal types |
| **Result normalization** | Package all raw output into a structured `RunAttemptResult` |
| **Claim passthrough** | Pass `worker_reported_status` as-is (a claim, not a verdict) |
| **Contract compliance** | Implement the `WorkerAdapter` interface from `lib/contracts` |

### Adapter MUST NOT (prohibited behaviors)

| Prohibition | Rationale | Law/Decision |
|-------------|-----------|--------------|
| **Produce PASS/HOLD/FAIL verdict** | Only Truth Engine produces gate verdicts | Law 1, D-030 |
| **Evaluate acceptance criteria** | Acceptance criteria belong to FinalGate | Law 3, D-036 |
| **Decide if task is complete** | Completion authority is kernel Truth Engine | Law 1, D-075 |
| **Build Evidence Hash Chain** | EHC is kernel/evidence responsibility | D-034 |
| **Run gate logic** | Gates are kernel-owned (D-033) | D-030 |
| **Write to shared integration files** | Only Assembler writes shared files | Law 2 |
| **Mutate files outside assigned namespace** | Workers operate in isolated namespaces | Law 2, D-108 |
| **Persist runtime events directly** | Events flow through server/event-bus | D-095 |
| **Interpret hook events for truth** | Hooks are raw evidence; kernel interprets | D-031 |
| **Override TaskSpec** | TaskSpec is immutable once admitted | D-036 |
| **Emit completion claims as fact** | Worker self-report is evidence, not verdict | D-028 |
| **Import kernel/truth-engine** | Adapters are external bridges, not kernel | D-027 |

### Mock Adapter

The mock adapter (`adapters/mock-worker`) implements the same `WorkerAdapter` contract. It MUST support:

| Behavior | Purpose |
|----------|---------|
| Return empty diff | Test false-done detection (D-105, D-106) |
| Return failing test output | Test ExecGate HOLD |
| Return successful patch | Test normal PASS flow |
| Return namespace violation | Test namespace enforcement (D-108) |
| Return delayed output | Test timeout handling |
| Emit transcript chunks | Test hook event capture path |
| Simulate crash (CrashSignal) | Test crash recovery |
| Simulate rate limit (RateLimitSignal) | Test rate limit handling |
| Return zero tests ran | Test zero-test detection (D-107) |
| Return exit code 0 with no diff | Test agent self-report without changes |

The mock adapter is mandatory for deterministic testing of the Truth Engine and kernel safety components without requiring a real Claude Code process.

## Namespace and Workspace Constraints

### Adapter MUST

- Launch the worker with `cwd` set to the assigned workspace directory
- Ensure the worker's file operations are confined to the declared namespace
- NOT allow the worker to access files outside its namespace
- Report any namespace violation attempt (file access outside namespace) through hook events

### Adapter MUST NOT

- Write to any file in the workspace itself (adapter writes hook config only, outside workspace)
- Modify the workspace after the worker process exits
- Clean up the workspace (workspace cleanup is managed by kernel/core)
- Collude with the worker to bypass namespace restrictions

## Failure Modes

### Worker Exits with Code 0, Claims "Done"

The adapter returns `worker_reported_status: "done"` in `RunAttemptResult`. This is a CLAIM. The kernel Truth Engine must still:
- Check that a git diff exists (EvidenceGate)
- Check that tests ran and passed (ExecGate)
- Check that all acceptance criteria are met (FinalGate)

If the worker produced no diff but claimed "done," this is a false-done scenario (D-106).

### Worker Crashes (CrashSignal)

The adapter returns a `RunAttemptResult` with `error_signal: CrashSignal { ... }`. The process_exit_code may be null or non-zero. The kernel must:
- Check if partial evidence was produced (partial diff, partial transcript)
- If evidence is incomplete → EvidenceGate HOLD or FAIL
- If evidence is complete but worker crashed → RIM may initiate repair

### Rate Limit Hit (RateLimitSignal)

The adapter returns a `RunAttemptResult` with `error_signal: RateLimitSignal { ... }`. The kernel must:
- Not retry immediately (respect `retry_after_ms`)
- Count rate limits toward system failure rate (feeds Circuit Breaker)
- If rate limits are persistent, Circuit Breaker may open

### Timeout (TimeoutSignal)

The adapter kills the worker process and returns `TimeoutSignal`. The kernel must:
- Treat any partial evidence as incomplete (EvidenceGate HOLD)
- Count timeouts toward failure rate
- If timeouts are persistent, Governor may demote concurrency tier

### Adapter Cannot Launch Worker

If `healthCheck()` returns `{ available: false, reason: "claude-code binary not found" }`, the kernel must:
- Reject attempts for this adapter kind
- Signal the unavailability to Mission Control
- NOT fall back to another adapter automatically (this is a server/config decision)

## Test / Gate Implications

- **Mock adapter contract tests**: Verify mock adapter implements same `WorkerAdapter` interface as real adapters
- **ErrorSignal normalization tests**: Every error path produces the correct ErrorSignal type
- **False-done adapter tests**: Mock adapter returns empty diff with `worker_reported_status: "done"` and kernel correctly detects as HOLD/FAIL
- **Adapter isolation tests**: Adapter tests do not require kernel Truth Engine
- **Contract boundary tests**: Kernel can consume `RunAttemptResult` from any adapter implementation
- **Namespace violation tests**: Mock adapter simulates file writes outside namespace, kernel detects
- **Crash/timeout/rate-limit tests**: Each ErrorSignal type is correctly normalized and kernel handles appropriately

## Decision Compliance Checklist

| Check | Decision Ref | Status |
|-------|-------------|--------|
| Adapter implements WorkerAdapter contract | D-021, D-101 | COMPLIANT |
| Adapter never decides completion | D-030, D-075 | COMPLIANT |
| Adapter normalizes worker output only | D-074 | COMPLIANT |
| Adapter never produces gate verdicts | D-030, D-032 | COMPLIANT |
| Adapter respects namespace isolation | D-108, Law 2 | COMPLIANT |
| Adapter does not build EHC | D-033, D-034 | COMPLIANT |
| Adapter does not evaluate acceptance criteria | D-036, Law 3 | COMPLIANT |
| Mock adapter shares same contract | D-067 | COMPLIANT |
| Worker self-report is claim, not verdict | D-028, Law 1 | COMPLIANT |
| Claude local loop is independent | D-076, D-079 | COMPLIANT |

## Open Questions

1. **Adapter error signal granularity**: Should there be additional error signal types beyond RateLimit, Crash, and Timeout? Possible additions: `AuthFailureSignal` (invalid API key), `QuotaExhaustedSignal` (billing limit).
2. **Prompt construction responsibility**: Should the adapter build the full prompt, or should `kernel/rim` produce a prompt template that the adapter fills with tool-specific formatting? Lean toward adapter-owned prompt construction for tool-specific optimization.
3. **stdout/stderr storage**: Should the adapter store stdout/stderr in memory and return inline, or write to temp files and return references? References are preferred for large outputs; inline is acceptable for expectedly small outputs.
4. **Abort attempt semantics**: When `abortAttempt()` is called, should the adapter send SIGTERM and wait, or SIGKILL immediately? Should the adapter attempt a graceful shutdown first?
5. **Multiple adapter instances**: Can a single adapter process manage multiple concurrent workers, or is each worker a separate adapter instance? Each worker should be a separate adapter instance for isolation.

## Audit Notes

- This document is the companion to `docs/pipelines/worker-adapter.md`. That document defines the pipeline contract; this document defines the boundary responsibilities and constraints.
- The adapter is the ONLY component that directly interacts with external worker processes. All other kernel and server components interact with worker output through the adapter's normalized `RunAttemptResult`.
- The `worker_reported_status` field is deliberately named to emphasize its status as a claim. Future code reviewers should flag any code that uses `worker_reported_status` as a gate input without going through kernel evidence and gates.
- Error signals are normalized for a reason: different workers fail in different ways. All error signals must be losslessly representable regardless of the worker kind. The adapter MUST NOT hide or simplify error information.
