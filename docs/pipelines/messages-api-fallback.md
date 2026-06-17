# Messages API Fallback Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the Messages API fallback integration path for Claude Code. This path is activated ONLY if the Day 0 Spike returns NO-GO for the primary headless + hooks path. It uses the Claude Messages API with PRAXIS-instrumented tools, where PRAXIS owns the tool execution loop. This document specifies what stays the same (Truth Engine, Three Laws, evidence model, gate pipeline), what changes (adapter implementation), and what must NOT change (Truth Engine authority, completion authority, shared-write authority).

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The Messages API fallback is the contingency plan for Claude Code integration. If the Day 0 Spike demonstrates that the primary headless + hooks path is not viable (hooks miss events, headless mode is unstable, rate limit ceiling is too low, divergence detection is unreliable), the fallback activates.

The fallback uses the Claude Messages API directly -- PRAXIS calls the API, receives Claude's tool-use requests, executes those tools itself in the isolated workspace, and feeds the results back to Claude. In this model, PRAXIS owns the tool execution loop. Claude provides reasoning and tool-use decisions; PRAXIS provides the execution environment and captures all evidence directly.

This document is a specification, not an implementation plan. It must NOT be implemented unless the Day 0 Spike returns NO-GO.

---

## Scope

- The trigger condition: Day 0 Spike NO-GO (or PARTIAL-GO with human decision to proceed with fallback)
- The fallback integration model: Messages API + PRAXIS-owned tool execution loop
- What the tool-use loop looks like: Claude responds with tool_use → PRAXIS executes tool → PRAXIS captures result → result sent back to Claude → loop continues
- What stays identical between primary and fallback paths
- What changes between primary and fallback paths
- Tradeoffs: what the fallback gains vs. loses compared to the primary path
- The hard invariants: Truth Engine authority, Three Laws, evidence model, gate pipeline do NOT change

---

## Non-Goals

- Implementing the fallback (it is gated on Day 0 Spike NO-GO; must NOT be implemented now)
- Modifying Truth Engine authority (the fallback must NOT change who decides completion)
- Modifying the Three Laws (the fallback is bound by the same laws as the primary path)
- Designing the exact fallback adapter API (that is an implementation concern if the fallback is activated)
- How to configure or authenticate the Messages API (Claude API standard; not PRAXIS-specific)
- How Claude Code hook settings work (those are primary-path only; irrelevant to fallback)
- Details of the PRAXIS-instrumented tool definitions (implementation concern)

---

## Authoritative Decisions Used

| Decision ID | Decision | How It Applies |
|-------------|----------|----------------|
| D-071 | Fallback path: Claude Messages API + PRAXIS-instrumented tools if Day 0 Spike NO-GO | This document defines that fallback path in full |
| D-070 | Primary path: Claude Code headless + praxis-hook | This document is the contingency if D-070 fails |
| D-072 | Day 0 Spike must verify headless, hooks, divergence, rate limit ceiling | The Spike's NO-GO verdict activates this fallback |
| D-030 | Adapter never decides completion | Fallback adapter also never decides completion; Truth Engine still owns PASS/HOLD/FAIL |
| D-028 | Worker self-report is not completion (Law 1) | Claude's final text response is evidence, not completion |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | Unchanged by fallback |
| D-034 | EvidenceRecord and EHC are required | Unchanged by fallback |
| D-075 | Claude adapter does not decide completion | Unchanged by fallback |
| D-076 | Claude local loop separate from PRAXIS supervisory loop | In fallback, PRAXIS runs the tool execution loop; the separation becomes PRAXIS loop vs. Claude's reasoning/decision-making |
| D-078 | Two-layer autonomous model | Adapted for fallback: PRAXIS tool execution layer + Claude reasoning layer |
| LAW 1 | Agent says done is not done | Claude's response text is evidence, not completion; FinalGate still decides |
| LAW 2 | No worker writes shared integration files | PRAXIS executes tools in isolated workspace; same LAW 2 enforcement |
| LAW 3 | FinalGate criteria from human-authored TaskSpec only | Unchanged by fallback |
| D-027 | Dependency direction | Fallback adapter still cannot import from kernel/* or interface/* |

---

## Conceptual Model

In the fallback path, PRAXIS does not observe Claude Code through hooks. Instead, PRAXIS calls the Claude Messages API directly and owns the tool execution loop. Claude provides reasoning and tool-use instructions; PRAXIS executes those instructions in the isolated workspace and reports factual results back to Claude.

```
+------------------------------------------------------------------+
|                        PRAXIS RUNTIME                             |
|                                                                    |
|  +------------------------------------------------------------+  |
|  |         Fallback Claude Adapter (adapters/claude-code)      |  |
|  |                                                            |  |
|  |  LOOP:                                                     |  |
|  |   1. Call Messages API with system prompt + task + history  |  |
|  |   2. Claude responds with:                                  |  |
|  |      a. text (reasoning, explanation) → capture as evidence |  |
|  |      b. tool_use (tool name + input) → execute in workspace |  |
|  |      c. stop_reason (end_turn, tool_use, max_tokens, etc.)  |  |
|  |   3. If tool_use:                                           |  |
|  |      a. PRAXIS executes the tool in the workspace           |  |
|  |      b. PRAXIS captures the tool output (stdout, stderr,    |  |
|  |         exit code, file changes)                            |  |
|  |      c. PRAXIS appends tool_result to the conversation       |  |
|  |      d. PRAXIS records the tool execution as evidence       |  |
|  |      e. Loop back to step 1 with updated history            |  |
|  |   4. If stop_reason = end_turn:                             |  |
|  |      a. Claude's final text is captured as evidence         |  |
|  |      b. Worker self-reported status extracted               |  |
|  |      c. Loop ends → capture output → normalize result       |  |
|  |                                                            |  |
|  |  PRAXIS OWNS:                                              |  |
|  |  - Tool execution (Read, Write, Edit, Bash)                |  |
|  |  - Evidence capture (every tool result captured directly)   |  |
|  |  - Workspace isolation (tools execute in workspace only)   |  |
|  |  - Token tracking (count API tokens consumed)              |  |
|  |  - Timeout enforcement (budget across all API calls)        |  |
|  |                                                            |  |
|  |  PRAXIS DOES NOT OWN:                                      |  |
|  |  - Claude's reasoning / tool choices                       |  |
|  |  - Whether the output is correct (Truth Engine owns that)  |  |
|  |  - Completion decisions (FinalGate owns that)              |  |
|  +------------------------------------------------------------+  |
|                                                                    |
|  +------------------------------------------------------------+  |
|  |  kernel/truth-engine    kernel/evidence    kernel/circuit-   |  |
|  |  (unchanged)             (unchanged)        breaker          |  |
|  |                                                  (unchanged) |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
        │
        │ HTTP POST to Claude Messages API
        │ (api.anthropic.com/v1/messages)
        v
+------------------------------------------------------------------+
|                    Claude Messages API                             |
|                                                                    |
|  Receives: conversation history with PRAXIS-instrumented tools    |
|  Returns: text + tool_use blocks + stop_reason                    |
|                                                                    |
|  Claude's role:                                                    |
|  - Analyzes the task and conversation history                      |
|  - Decides what tool to use next (or decides to stop)              |
|  - Provides reasoning in text blocks                               |
|  - Issues tool_use blocks with tool name and input                 |
|                                                                    |
|  Claude does NOT:                                                  |
|  - Execute tools (PRAXIS executes)                                 |
|  - See the workspace filesystem directly (PRAXIS reads/writes)     |
|  - Run shell commands (PRAXIS runs them via Bash tool)             |
|  - Decide if the task is complete (Truth Engine decides)           |
+------------------------------------------------------------------+
```

In this model, the boundary is clear: Claude thinks and decides what to do; PRAXIS does it and records what happened. Claude never touches the filesystem directly. Every file read, file write, and command execution goes through PRAXIS's tool implementations, giving PRAXIS complete, reliable evidence capture.

---

## Data / Control Flow

### Tool Execution Loop (One Turn)

```
+-------------------+    +-------------------+    +-------------------+
| 1. Build API      |--->| 2. Call Messages  |--->| 3. Parse Response |
|    Request        |    |    API             |    |                   |
+-------------------+    +-------------------+    +-------------------+
     |                                                  |
     v                                                  v
  System prompt:                             Claude's response has:
    "You are an AI     ┌──────────────────────┼──────────────────────┐
     coding agent..."  │                      │                      │
                       │ text blocks           │ tool_use blocks       │ stop_reason =
  Task description:    │ (Claude's reasoning,  │ (tool name + input)   │ end_turn
    (from prompt_ref)  │ explanations,         │                       │
                       │ planning)             │                       │
  Tool definitions:    │                      │                       │
    Read               │ Capture as evidence   │ Extract tool name     │ Capture final
    Write              │ for audit trail       │ and input params      │ text as
    Edit               │                      │                       │ worker_reported_
    Bash               └──────────────────────┼──────────────────────┘ status
  Conversation hist:         │                      │
    (previous turns)         │                      v
    tool_results             │          +-------------------+
                             │          | 4. Execute Tool   |
                             │          |    (PRAXIS-owned) |
                             │          +-------------------+
                             │                   │
                             │          +--------+--------+
                             │          │                 │
                             │     Read/Write/Edit    Bash
                             │          │                 │
                             │          v                 v
                             │     File content      stdout/stderr
                             │     (captured)        exit_code
                             │                        (captured)
                             │          │                 │
                             │          +--------+--------+
                             │                   │
                             │                   v
                             │          +-------------------+
                             │          | 5. Build          |
                             │          |    tool_result    |
                             │          +-------------------+
                             │                   │
                             │                   v
                             │          tool_result block:
                             │            tool_use_id
                             │            content (output)
                             │            is_error (if failure)
                             │                   │
                             │                   v
                             │          +-------------------+
                             │          | 6. Record         |
                             │          |    Evidence       |
                             │          +-------------------+
                             │                   │
                             │                   v
                             │          EvidenceRecord:
                             │            source: 'adapter'
                             │            kind: 'tool_execution'
                             │            content: tool + result
                             │                   │
                             └───────────────────┘
                                                 |
                                                 v
                                      +-------------------+
                                      | 7. Loop back to   |
                                      |    step 1 with     |
                                      |    updated history |
                                      +-------------------+
```

### End-to-End Flow (One Attempt)

```
Adapter starts attempt
       │
       v
Build system prompt + task description + PRAXIS tool definitions
       │
       v
+------------------------------------------------------------------+
|                      TOOL EXECUTION LOOP                          |
|                                                                    |
|  while (stop_reason != 'end_turn' && turn_count < max_turns) {    |
|    call Messages API with history                                  |
|    if (tool_use blocks present) {                                  |
|      for each tool_use:                                            |
|        execute tool in workspace                                   |
|        capture stdout/stderr/exit_code/file_changes                |
|        build tool_result block                                     |
|        record EvidenceRecord                                       |
|      append all tool_results to history                            |
|      turn_count++                                                  |
|    }                                                               |
|    if (stop_reason == 'end_turn') {                                |
|      break loop                                                    |
|    }                                                               |
|  }                                                                 |
|                                                                    |
+------------------------------------------------------------------+
       │
       v
Capture final output:
  - Claude's final text (worker_reported_status)
  - All tool execution evidence records
  - git diff of workspace
  - changed files list
       │
       v
Normalize to RunAttemptResult
  - Same RunAttemptResult shape as primary path
  - No hook_event_refs (no hooks in fallback)
  - Evidence built into EHC from tool execution records
  - worker_reported_status from Claude's final text
       │
       v
Return to kernel → Truth Engine → gates (unchanged)
```

---

## What Stays Identical

The following components, interfaces, and authorities are IDENTICAL between the primary path and the fallback path. The fallback does not change them.

### Authorities (Must Not Change)

| Authority | Primary Path | Fallback Path | Notes |
|-----------|-------------|---------------|-------|
| **Truth Engine** | `kernel/truth-engine` decides PASS/HOLD/FAIL | Same | Unchanged. No fallback adapter method returns a verdict. |
| **EvidenceGate** | Evaluates diff, file changes | Same | Unchanged. Evidence comes from tool execution records instead of hook events, but EvidenceGate evaluates the same types of evidence. |
| **ExecGate** | Evaluates command execution, test output | Same | Unchanged. Tool execution records include Bash tool outputs with exit codes and stdout/stderr. |
| **FinalGate** | Evaluates acceptance criteria from TaskSpec | Same | Unchanged. Acceptance criteria are human-authored and immutable. |
| **Circuit Breaker** | System-level safety, CLOSED/OPEN/HALF_OPEN | Same | Unchanged. Failure rate tracking, EHC break classification, and state transitions work identically. |
| **RIM** | Repair strategies on HOLD/FAIL | Same | Unchanged. RepairPacket built from failure signatures works identically. |
| **Governor** | Concurrency control, tier promotion/demotion | Same | Unchanged. Governor does not care how the adapter works internally. |
| **PSAG** | Plan admission gate | Same | Unchanged. Plan admission is adapter-agnostic. |
| **Assembler** | Wave-level deterministic assembly | Same | Unchanged. Assembler receives verified patches regardless of adapter. |
| **ACCP** | Async artifacts | Same | Unchanged. |

### Contracts (Must Not Change)

| Contract | Primary Path | Fallback Path | Notes |
|----------|-------------|---------------|-------|
| **RunAttemptInput** | Same shape | Same shape | Unchanged. The adapter receives the same input. |
| **RunAttemptResult** | Same shape | Same shape | Unchanged. Same fields, same absence of verdict field. `hook_event_refs` will be empty in fallback (no hooks). |
| **WorkerHealth** | Same shape | Same shape | Unchanged. Health check verifies API key validity instead of binary presence. |
| **TaskSpec** | Same shape | Same shape | Unchanged. Acceptance criteria are identical. |
| **EvidenceRecord** | Same shape | Same shape | Unchanged. Source may be `'adapter'` instead of `'kernel_hook'`, but record shape is identical. |
| **AcceptanceCriterion** | Same shape | Same shape | Unchanged. |

### Three Laws (Must Not Change)

| Law | Primary Path | Fallback Path |
|-----|-------------|---------------|
| **LAW 1:** Agent says done != done; Truth Engine FinalGate PASS = done | Claude's Stop message is not completion | Claude's `stop_reason: end_turn` + final text is not completion; both are evidence |
| **LAW 2:** No worker writes shared integration files | Claude operates in isolated workspace via hooks | PRAXIS executes tools in isolated workspace; no shared writes |
| **LAW 3:** FinalGate criteria from human-authored TaskSpec only | Adapter does not touch criteria | Adapter does not touch criteria |

### EHC and Evidence Model (Must Not Change)

- Evidence Hash Chain construction is identical (`content_hash` → `chain_hash`)
- EHC break classification (NOISE/SUSPECTED/CONFIRMED) is identical
- Circuit Breaker response to CONFIRMED EHC breaks is identical
- KernelOwnedTranscript is built from evidence records (source changes from `kernel_hook` to `adapter`, but structure is identical)

---

## What Changes

The following components change between the primary path and the fallback path.

### Adapter Implementation

| Aspect | Primary Path | Fallback Path |
|--------|-------------|---------------|
| **Worker launch** | Spawn `claude --headless` as child process | Call Messages API via HTTP (no child process) |
| **Tool execution** | Claude Code executes tools internally; hooks observe | PRAXIS adapter executes tools; Claude only requests them |
| **Hook involvement** | `praxis-hook` captures PreToolUse/PostToolUse/Stop | No hooks. PRAXIS captures tool results directly. |
| **Evidence source** | `hook_event_refs` → hook-captured event files | Direct tool execution records from adapter |
| **Rate limit detection** | Pattern match on Claude Code stderr | API response status codes (HTTP 429) + response headers (`Retry-After`) |
| **Crash detection** | Process signal detection (SIGSEGV, etc.) | HTTP errors, API timeouts, API error responses |
| **Timeout enforcement** | Kill child process after budget | Stop API loop after budget; finish current API call gracefully |
| **Health check** | Check `claude` binary exists and is executable | Check API key is valid; check API endpoint is reachable |
| **Divergence detection** | Compare hook events vs. Claude's self-report | Less relevant -- PRAXIS executes tools directly, so tool output is authoritative. Divergence detection becomes: compare tool results vs. Claude's interpretation of results. |
| **Real-time streaming** | onChunk callback from child process stdout/stderr | API streaming (SSE from Anthropic API); text and tool_use blocks arrive incrementally |

### Tool Execution

In the fallback path, PRAXIS must implement each tool that Claude can request:

```
PRAXIS-Instrumented Tools:

  Read:
    input: { file_path: string, offset?: number, limit?: number }
    PRAXIS action: read file from workspace, return content
    captured: file content returned

  Write:
    input: { file_path: string, content: string }
    PRAXIS action: write file to workspace
    captured: file path, pre-write hash (if file existed), post-write hash

  Edit:
    input: { file_path: string, old_string: string, new_string: string }
    PRAXIS action: find old_string in file, replace with new_string, write
    captured: file path, old_string, new_string, success/failure, diff

  Bash:
    input: { command: string, timeout?: number }
    PRAXIS action: execute command in workspace shell, capture stdout/stderr/exit_code
    captured: command, stdout, stderr, exit_code, wall_time_ms
```

These tool implementations must be read-only (Read), write-only (Write), edit-only (Edit), and command-execution-only (Bash) respectively. They must NOT:
- Evaluate whether the tool call was "correct" or "good"
- Filter or modify the tool's input or output beyond basic normalization
- Access files outside `allowed_paths`
- Execute commands outside the workspace

The tool implementations are the fallback's equivalent of the hook layer. They capture evidence directly because PRAXIS is the one executing the tools.

### Claude's Role Changes

| Aspect | Primary Path | Fallback Path |
|--------|-------------|---------------|
| **Tool execution authority** | Claude executes tools directly | Claude requests tools; PRAXIS executes |
| **Filesystem access** | Claude accesses filesystem directly | Claude never touches filesystem; PRAXIS mediates all access |
| **Command execution** | Claude runs commands directly | PRAXIS runs commands and reports results |
| **Session control** | Claude decides when to stop (Stop hook) | Claude's `stop_reason` controls the loop; PRAXIS enforces max_turns |
| **Evidence reliability** | Depends on hook reliability (Day 0 Spike concern) | PRAXIS captures evidence directly -- 100% reliable (no hooks to miss) |

---

## Tradeoffs: Primary vs. Fallback

### What the Fallback Gains

1. **Complete evidence capture.** PRAXIS executes every tool, so every tool call is captured. No hook events missed. No divergence between "what Claude said it did" and "what actually happened" -- PRAXIS did it, so PRAXIS knows exactly what happened.

2. **Full tool execution control.** PRAXIS can enforce namespace restrictions, timeout budgets, and allowed_paths at the tool-execution level. Claude cannot accidentally or intentionally access files outside the workspace because Claude never touches the filesystem directly.

3. **No binary dependency.** The fallback does not require the `claude` CLI binary to be installed. It only requires an API key and HTTP access to the Anthropic API.

4. **Cross-platform simplicity.** HTTP calls to the Messages API work identically on Linux, macOS, and Windows. No child process management, no signal handling, no platform-specific process spawning.

5. **Rate limit visibility.** The API returns explicit HTTP 429 responses with `Retry-After` headers. Pattern matching on stderr (primary path) is less reliable.

6. **Streaming control.** The Messages API supports SSE streaming, which maps naturally to PRAXIS's real-time transcript streaming via the `onChunk` callback.

### What the Fallback Loses

1. **Claude's native tool optimization.** Claude Code's internal tool execution is highly optimized (caching, parallel tool calls, intelligent tool selection). PRAXIS's reimplementation will be slower and less sophisticated.

2. **Tool coverage.** Claude Code supports many tools beyond Read/Write/Edit/Bash (e.g., NotebookEdit, WebSearch, Task, etc.). PRAXIS would need to implement each one. The primary path gets full tool coverage for free.

3. **Claude Code features.** `--no-permissions`, settings management, session persistence, and other Claude Code features are lost. The fallback must reimplement or do without.

4. **Latency per tool call.** In the primary path, Claude executes a tool and reports the result in one message. In the fallback, Claude issues a `tool_use`, PRAXIS executes, PRAXIS sends `tool_result`, Claude issues the next message. Each tool call requires an extra API round-trip.

5. **Higher API token costs.** The fallback sends tool results back to Claude as part of the conversation history. Large tool outputs (e.g., reading a 5000-line file) consume tokens on both the request and the response side. The primary path's tool execution is local and costs zero API tokens.

6. **No Claude Code ecosystem.** Claude Code plugins, custom hooks (beyond PRAXIS hooks), and community extensions are unavailable.

7. **Implementation complexity.** PRAXIS must implement reliable tool execution (Read, Write, Edit, Bash), manage conversation history carefully, handle API errors, manage token counting for budget enforcement, and implement prompt caching for efficiency. This is significantly more code than the primary path's process-spawning adapter.

8. **Max turns enforcement.** In the primary path, Claude Code's `--max-turns` flag handles loop termination. In the fallback, PRAXIS must implement its own turn counter and loop-break logic.

### Summary Table

| Dimension | Primary Path | Fallback Path | Winner |
|-----------|-------------|---------------|--------|
| Evidence reliability | Depends on hook reliability (Spike concern) | 100% (PRAXIS executes) | Fallback |
| Tool coverage | Full Claude Code tool set | Limited to PRAXIS-implemented tools | Primary |
| Implementation complexity | Low (spawn process, capture output) | High (tool execution, history mgmt, API loop) | Primary |
| API token cost | Low (tools are local) | Higher (tool results in history) | Primary |
| Latency | Low (local tool execution) | Higher (extra API round-trip per tool) | Primary |
| Cross-platform | Moderate (child process mgmt) | Good (HTTP only) | Fallback |
| Divergence detection | Hook vs. Claude comparison | PRAXIS tool results are authoritative | Fallback |
| Claude Code features | Full (permissions, settings, plugins) | None | Primary |
| Binary dependency | Requires `claude` CLI installed | Only requires API key | Fallback |

---

## PRAXIS Tool Definitions

The PRAXIS-instrumented tools must be defined as Anthropic-compatible tool schemas and included in every Messages API request:

```typescript
// Tool definitions sent to Messages API
const PRAXIS_TOOLS = [
  {
    name: 'Read',
    description: 'Read a file from the workspace. Returns the file content.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file within the workspace' },
        offset: { type: 'number', description: 'Line number to start reading from (optional)' },
        limit: { type: 'number', description: 'Maximum number of lines to read (optional)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: 'Write a file to the workspace. Creates the file if it does not exist, overwrites if it does.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file within the workspace' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: 'Perform an exact string replacement in an existing file.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file within the workspace' },
        old_string: { type: 'string', description: 'The text to replace' },
        new_string: { type: 'string', description: 'The text to replace it with' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Bash',
    description: 'Execute a shell command within the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (optional, default: 120000)' },
      },
      required: ['command'],
    },
  },
];
```

### Tool Execution Rules

When PRAXIS receives a `tool_use` block from Claude:

1. **Validate the tool name** against the known set (`Read`, `Write`, `Edit`, `Bash`). Unknown tool → `tool_result` with `is_error: true`.
2. **Validate the tool input** against the schema. Malformed input → `tool_result` with `is_error: true`.
3. **Check namespace constraints:** the tool must not access files outside `allowed_paths`. Violation → `tool_result` with `is_error: true`.
4. **Execute the tool** in the isolated workspace.
5. **Capture the output:** full stdout, stderr, exit code (for Bash), file content (for Read), success/failure (for Write/Edit).
6. **Build `tool_result` block** with the captured output.
7. **Record EvidenceRecord** for this tool execution.
8. **Append `tool_result` to conversation history.**

If any tool execution fails (is_error: true), the loop continues. Claude receives the error and can decide to try a different approach or stop. PRAXIS does NOT decide whether the error means the task failed -- that is Truth Engine territory.

---

## MUST / MUST NOT Rules

### Fallback Adapter MUST

- Implement the full `WorkerAdapter` contract (same contract as primary path)
- Call the Claude Messages API with PRAXIS-instrumented tool definitions
- Execute ALL tool_use blocks in the isolated workspace (Claude never touches the filesystem directly)
- Capture complete tool output (stdout, stderr, exit code, file content) for every tool execution
- Build EvidenceRecords for every tool execution
- Enforce `budget.timeout_ms` across the entire API loop
- Enforce `budget.token_limit` by tracking total API tokens consumed
- Enforce max_turns to prevent infinite loops
- Return `RunAttemptResult` with NO verdict field (same contract, same constraint)
- Preserve Claude's final text as `worker_reported_status` (CLAIM ONLY)
- Respect `namespace` and `allowed_paths` in all tool executions

### Fallback Adapter MUST NOT

- Execute a tool outside `allowed_paths` (namespace enforcement at tool level)
- Execute a tool that Claude did not request
- Modify tool_use input or tool_result output beyond basic normalization
- Evaluate whether tool output is "correct" or "sufficient"
- Emit a PASS/HOLD/FAIL verdict
- Write to shared integration files
- Modify the Truth Engine, evidence model, gate pipeline, or any kernel component
- Change how completion is decided (FinalGate still owns that)
- Import from `kernel/*`, `interface/*`, or `server/*`
- Skip evidence capture for any tool execution (even "trivial" reads)
- Short-circuit the loop because "Claude's output looks good"

### MUST NOT (Meta -- About the Fallback Itself)

- Implement the fallback before Day 0 Spike returns NO-GO (D-077: Claude Code implementation must not start before Spike GO, and that includes the fallback)
- Change the Truth Engine's authority (the fallback is an adapter change, not a kernel change)
- Remove the primary path specification (the primary path remains the target; fallback is contingency only)
- Describe the fallback as "the plan" or "the primary path" (it is explicitly a contingency)
- Use the fallback as an excuse to weaken evidence requirements ("we execute tools directly so we don't need EHC" -- WRONG, EHC is still required)

---

## Failure Modes

| Failure | Detection | Adapter Response | Downstream Effect |
|---------|-----------|-----------------|-------------------|
| API key invalid or expired | Messages API returns 401 | healthCheck → unavailable | No attempt created |
| API rate limit (HTTP 429) | API response status code | Return `RateLimitSignal` with `retry_after_ms` from `Retry-After` header | ExecGate → HOLD. Circuit Breaker tracks rate limit frequency. |
| API timeout (network issue) | HTTP request timeout | Retry with backoff (up to configurable max); if still failing, return `CrashSignal` or `TimeoutSignal` depending on budget | Attempt failed. RIM may retry. |
| API returns server error (5xx) | HTTP response status code | Retry with backoff; if persistent, return `CrashSignal` | Attempt failed. |
| Tool execution fails (e.g., Bash command non-zero exit) | Exit code ≠ 0 | Build tool_result with stderr + exit code; mark `is_error: false` (exit code ≠ 0 is valid tool output, not an adapter error) | Claude sees the error output and can adjust. ExecGate evaluates command output. |
| Tool accesses file outside namespace | Tool execution validation | Build tool_result with `is_error: true`; log namespace violation | Namespace violation flagged. EvidenceGate → FAIL. |
| Max turns exceeded | Turn counter >= max_turns | Break loop; return partial result with `TimeoutSignal` | ExecGate → HOLD. Partial evidence preserved. |
| Token budget exceeded | Token counter >= budget.token_limit | Stop loop; return partial result with `TimeoutSignal` | ExecGate → HOLD. Partial evidence preserved. |
| Claude returns malformed response (invalid JSON) | Response parsing fails | Retry once; if still malformed, return `CrashSignal` | Attempt failed. |
| Claude's response has no tool_use and no stop_reason | Response parsing | Treat as end_turn with empty text | Worker self-reported nothing. EvidenceGate → HOLD. |

---

## Test / Gate Implications

### If the Fallback Is Activated (Post Spike NO-GO)

All of the following tests must be written as part of the fallback implementation:

- **Tool execution tests:** Read returns file content; Write creates/modifies file; Edit replaces string; Bash executes command and captures output; all tools reject paths outside allowed_paths
- **API loop tests:** loop terminates on end_turn; loop breaks on max_turns; loop breaks on token budget exceeded; loop breaks on time budget exceeded; loop handles API errors gracefully
- **Evidence capture tests:** every tool execution produces an EvidenceRecord; EHC chain is valid after full attempt; missing tool execution record → EHC break classification
- **Contract compliance tests:** RunAttemptResult has no verdict field; worker_reported_status extracted from final text; adapter imports only from lib/contracts
- **False-done tests:** Claude says "done" but no tools were executed → HOLD; Claude says "done" but no files were changed → HOLD; Claude says "done" but test Bash command failed → HOLD
- **Comparison tests (if both paths exist):** same task run through both primary and fallback; verify both produce evidence records; verify Truth Engine evaluates both identically; verify both return non-verdict RunAttemptResult

### Gates That Must Still Pass (Unchanged from Primary Path)

| Gate | Requirement | Fallback Status |
|------|------------|-----------------|
| P3 Kernel Safety Gate | Truth Engine, false-done, EHC, Circuit Breaker, PSAG | Identical -- kernel is unchanged |
| P4 Real Worker Gate | Adapter normalization, evidence capture, divergence detection | Same requirements, different evidence source |
| P5 Parallel Execution Gate | 3 concurrent workers, namespace isolation, assembler | Same -- adapter type is transparent to parallel execution |
| P6 Production Gate | e2e, stability, restart recovery | Same -- ACCP artifacts, CLI, desktop are unchanged |

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Fallback is gated on Day 0 Spike NO-GO (D-071, D-077) | [ ] |
| Fallback is NOT implemented before Spike NO-GO | [ ] |
| Fallback adapter implements full WorkerAdapter contract | [ ] |
| RunAttemptResult has no verdict field (D-030, D-075) | [ ] |
| worker_reported_status is CLAIM ONLY (D-028) | [ ] |
| Adapter does not import from kernel/* (D-027) | [ ] |
| Adapter does not import from interface/* (D-027) | [ ] |
| Adapter does not import from server/* (D-027) | [ ] |
| Adapter does not write shared integration files (LAW 2) | [ ] |
| Adapter does not evaluate acceptance criteria (LAW 3) | [ ] |
| Truth Engine authority is unchanged (LAW 1, D-032) | [ ] |
| Evidence model and EHC are unchanged (D-034) | [ ] |
| Gate pipeline is unchanged (EvidenceGate, ExecGate, FinalGate) | [ ] |
| Circuit Breaker is unchanged (D-084, D-085) | [ ] |
| RIM is unchanged | [ ] |
| Governor is unchanged | [ ] |
| PSAG is unchanged | [ ] |
| Assembler is unchanged | [ ] |
| ACCP is unchanged | [ ] |
| PRAXIS executes ALL tools (Claude never touches filesystem directly) | [ ] |
| Tool definitions include Read, Write, Edit, Bash with correct schemas | [ ] |
| All tool executions captured as EvidenceRecords | [ ] |
| Namespace enforcement at tool-execution level | [ ] |

---

## Open Questions

| ID | Question | Owner | Notes |
|----|----------|-------|-------|
| MF-001 | What additional tools beyond Read/Write/Edit/Bash should PRAXIS implement for the fallback? | Architecture / Spike data | Claude Code supports many tools. The Spike should identify which tools Claude uses most frequently so PRAXIS can prioritize implementation. |
| MF-002 | Should the fallback support Claude's prompt caching to reduce token costs? | Implementation | Prompt caching can significantly reduce costs for repeated system prompts. The Messages API supports it. This is an implementation optimization, not an architectural concern. |
| MF-003 | What is the max_turns default for the fallback loop? | Architecture | Primary path uses Claude Code's `--max-turns`. Fallback must define its own. Suggested default: 50 turns. |
| MF-004 | How does the fallback handle Claude's parallel tool_use requests (multiple tool_use blocks in one response)? | Implementation | Execute sequentially, capture all results, append all tool_results to history. Parallel execution in isolated workspaces is safe but adds complexity. |
| MF-005 | Should the fallback use streaming (SSE from Anthropic API) or non-streaming? | Implementation | Streaming enables real-time transcript display in Mission Control (maps to onChunk callback). Non-streaming is simpler. Decision TBD during implementation. |
| MF-006 | How does the fallback interact with ACCP artifact generation? | Architecture | Identical to primary path. ACCP reads stored evidence records. Source of evidence changes but record shape is identical. |
| MF-007 | If the fallback is activated, should the primary path be removed from the codebase? | Architecture | No. The primary path remains the target. Fallback is contingency. Both can coexist if the primary path is later fixed. |
| MF-008 | Should the fallback adapter be in `adapters/claude-code/` or a separate package? | Architecture | Same package. `adapters/claude-code/` would contain both primary and fallback implementations, selected by config after Day 0 Spike verdict. |

---

## Audit Notes

- This document is DRAFT_FOR_AUDIT v0.1. It is a specification of what the fallback SHOULD look like if activated. It is NOT an implementation plan. No code should be written against this document unless the Day 0 Spike returns NO-GO.
- The primary purpose of this document is to ensure that if the fallback is activated, it does not weaken PRAXIS's safety model. The "What Stays Identical" and "MUST NOT" sections exist specifically to prevent scope creep that would compromise the Three Laws.
- The fallback's key advantage -- complete, 100% reliable evidence capture because PRAXIS executes tools directly -- is also the reason it is NOT the primary path: implementing and maintaining tool execution is substantially more complex than observing Claude Code through hooks.
- The fallback tradeoff table is an honest assessment. The fallback is not a "better" path; it is a contingency with different tradeoffs. The primary path is preferred because it is simpler and leverages Claude Code's existing optimizations.
- The `stop_reason: end_turn` from the Messages API is NOT a completion signal. It means Claude finished its current reasoning/tool-use cycle. The Truth Engine still decides whether the attempt is complete. This is a critical distinction that must survive into implementation.
- The fallback's tool execution loop (PRAXIS executes tools) effectively removes the need for divergence detection, because PRAXIS is the one executing tools. The tool output is authoritative. However, EHC integrity (are all tool execution records present and hash-consistent?) remains critical.
- This document was written against `docs/decisions.md` as the canonical source. Any conflict with `architecture.md` or other documents is resolved in favor of `docs/decisions.md`.
- If the Day 0 Spike returns GO, this document becomes reference-only. It should NOT be deleted (it documents the contingency reasoning), but it should be marked as INACTIVE_PATH.
