# PRAXIS Hook Event Capture Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the hook event capture pipeline: how `praxis-hook` intercepts Claude Code tool events, normalizes them to JSON, delivers them to the runtime server, and provides spool-based fallback when the server is unavailable. The hook is a tiny, robust, transparent observer -- it captures raw events and does NOT decide truth, evaluate gate criteria, modify tool input/output, or perform any kernel-level function.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The `praxis-hook` binary is the PRAXIS kernel's eyes into a Claude Code session. Claude Code calls the hook on three event types -- PreToolUse, PostToolUse, and Stop -- and the hook captures exactly what happened, normalizes it to a JSON event, and delivers it to the PRAXIS runtime server. If the server is temporarily unavailable, the hook spools events to a local file for later ingestion.

The hook is intentionally minimal. It does one thing: capture and deliver events. It does not interpret, filter, modify, gate, or judge. The kernel owns interpretation. The Truth Engine owns judgment. The hook owns raw capture.

---

## Scope

- The hook event capture pipeline end-to-end: Claude emits event → hook intercepts → normalizes to JSON → POSTs to runtime → server ingests → EvidenceRecord → EHC chain
- The three hook event types: PreToolUse, PostToolUse, Stop
- The local spool fallback mechanism: when the runtime server is unreachable
- Server ingestion and Evidence Hash Chain integration
- EHC break classification (NOISE/SUSPECTED/CONFIRMED) and Circuit Breaker feed
- Hook design constraints: tiny, robust, transparent, fire-and-forget

---

## Non-Goals

- Claude Code adapter launch/configuration (see `docs/pipelines/claude-code-adapter.md`)
- Generic WorkerAdapter contract (see `docs/pipelines/worker-adapter.md`)
- Truth Engine gate logic (belongs in `kernel/truth-engine`)
- Evidence capture other than hook events (git diff, test output, filesystem snapshots belong in `kernel/evidence`)
- ACCP artifact generation
- How Claude Code's internal tool execution works
- Claude Code hook configuration format (defined by Claude Code; the adapter writes it; the hook reads environment variables)

---

## Authoritative Decisions Used

| Decision ID | Decision | How It Applies |
|-------------|----------|----------------|
| D-022 | Hooks capture external tool events | This document defines the full capture pipeline |
| D-031 | Hook never decides truth | The hook is a capture-and-deliver mechanism; zero evaluation logic |
| D-028 | Worker self-report is not completion (Law 1) | Hook events are raw evidence; Claude's claims are captured, not believed |
| D-034 | EvidenceRecord and EHC are required for trustworthy verification | Hook events feed into the Evidence Hash Chain |
| D-070 | Primary path: Claude Code headless + praxis-hook | This document defines the hook side of that primary path |
| D-109 | Circuit Breaker transitions must be tested | EHC CONFIRMED break opens Circuit Breaker; NOISE and SUSPECTED do not |
| LAW 1 | Agent says done is not done | Hook captures what Claude said and did; does not evaluate whether it means "done" |
| LAW 2 | No worker writes shared integration files | Hook writes only to runtime server endpoint or local spool; never to shared files |
| LAW 3 | FinalGate criteria from human-authored TaskSpec only | Hook does not read, evaluate, or reference acceptance criteria |
| D-076 | Claude local loop separate from PRAXIS supervisory loop | Hook is the observation bridge between the two loops; does not merge them |
| D-080 | PRAXIS supervisory loop admits, captures, verifies, repairs, controls safety | Hook events are the raw capture input to the supervisory loop |

---

## Conceptual Model

The `praxis-hook` binary is a passive observer. It sits between Claude Code's tool execution and PRAXIS's evidence pipeline. It sees everything but judges nothing.

```
+------------------------------------------------------------------+
|                     PRAXIS RUNTIME SERVER                          |
|                                                                    |
|  POST /api/hook-events  ←── Hook events arrive here               |
|       │                                                           |
|       v                                                           |
|  server/control-plane/hook-events route                            |
|       │                                                           |
|       │ Validate event shape (Zod schema)                          |
|       │ Reject malformed events (400)                              |
|       │ Accept valid events → persist → emit SSE                   |
|       v                                                           |
|  server/storage (runtime_events table)                             |
|       │                                                           |
|       v                                                           |
|  kernel/evidence                                                  |
|       │                                                           |
|       │ Build EvidenceRecord from hook event                       |
|       │ Append to Evidence Hash Chain                              |
|       │ Classify EHC breaks (NOISE/SUSPECTED/CONFIRMED)            |
|       v                                                           |
|  kernel/circuit-breaker                                            |
|       │                                                           |
|       │ CONFIRMED EHC break → OPEN breaker                         |
|       │ NOISE/SUSPECTED → log, monitor, do NOT open breaker        |
|       v                                                           |
|  kernel/truth-engine                                               |
|       │                                                           |
|       │ KernelOwnedTranscript built from hook events               |
|       │ ExecGate: did commands run? did tests pass?                |
|       │ DivergenceDetector: hook events vs. worker claims          |
|       v                                                           |
+------------------------------------------------------------------+
        ▲
        │ HTTP POST (JSON hook event)
        │
+-------+----------------------------------------------------------+
|                                                                    |
|                  praxis-hook BINARY (hooks/praxis-hook)            |
|                                                                    |
|  +---------------+  +---------------+  +---------------+           |
|  | PreToolUse    |  | PostToolUse   |  | Stop          |           |
|  | handler       |  | handler       |  | handler       |           |
|  +-------+-------+  +-------+-------+  +-------+-------+           |
|          |                   |                   |                  |
|          v                   v                   v                  |
|  +--------------------------------------------------------+       |
|  |              Event Normalizer                           |       |
|  |                                                        |       |
|  |  Parse hook input (Claude passes event data)            |       |
|  |  Normalize to standardized JSON shape                   |       |
|  |  Attach PRAXIS metadata from environment variables      |       |
|  |  (attempt_id, task_run_id, worker_id, timestamp_ns)     |       |
|  +----------------------------+---------------------------+       |
|                               |                                   |
|                               v                                   |
|  +--------------------------------------------------------+       |
|  |              Delivery (runtime-client)                  |       |
|  |                                                        |       |
|  |  POST to PRAXIS_RUNTIME_URL/api/hook-events             |       |
|  |                                                        |       |
|  |  SUCCESS? → exit 0                                      |       |
|  |  FAILURE? → spool to local file → exit 0                |       |
|  |  (never fail the Claude session because of hook)         |       |
|  +--------------------------------------------------------+       |
|                                                                    |
+--------------------------------------------------------------------+
        ▲
        │ Claude Code invokes hook as external command
        │ on PreToolUse, PostToolUse, Stop events
        │
+-------+----------------------------------------------------------+
|                                                                    |
|                     CLAUDE CODE PROCESS                            |
|                                                                    |
|  Claude's internal loop:                                           |
|    Think → Decide tool → PreToolUse hook fires                     |
|      → Execute tool → PostToolUse hook fires                       |
|      → Observe output → Think again                                |
|    ... (repeat) ...                                                |
|    → Decide to stop → Stop hook fires                              |
|                                                                    |
+--------------------------------------------------------------------+
```

The hook is the thinnest possible layer. It receives event data from Claude, adds PRAXIS context, and sends it. That is its entire job.

---

## Data / Control Flow

### Normal Path (Runtime Server Available)

```
1. Claude Code decides to use a tool
       │
2. Claude Code calls hook command:
   praxis-hook pre-tool
       │ (Claude passes event data to hook via stdin or argv)
       v
3. praxis-hook:
   a. Reads event data from stdin/argv
   b. Reads PRAXIS metadata from env: PRAXIS_ATTEMPT_ID, PRAXIS_TASK_RUN_ID, etc.
   c. Normalizes to JSON:
      {
        "event_type": "pre_tool",
        "attempt_id": "att_01J...",
        "task_run_id": "run_01J...",
        "worker_id": "w_01J...",
        "timestamp_ns": 1734567890123456789n,
        "tool_name": "Read",
        "tool_input": { "file_path": "..." },
        "raw_event": { ... }   // verbatim Claude event
      }
   d. POSTs JSON to PRAXIS_RUNTIME_URL/api/hook-events
       │
       ├─ HTTP 200/201 → SUCCESS
       │      │
       │      v
       │   exit 0 (hook is done)
       │
       └─ HTTP error / connection refused / timeout
              │
              v
           SPOOL PATH (see below)
```

### Spool Path (Runtime Server Unavailable)

```
4a. POST to runtime server FAILS
       │
       v
4b. APPEND event JSON to local spool file:
    <workspace>/.praxis/hook-spool.jsonl
       │
       v
4c. exit 0 (NEVER fail due to spool)
       │
       │ ... (later, when server is available again) ...
       v
5. Server ingests spool file on recovery:
   a. Read .praxis/hook-spool.jsonl line by line
   b. For each event: validate, persist, emit SSE
   c. On successful ingest of all events: delete or rename spool file
   d. On partial ingest: keep remaining events for next recovery cycle
```

**Key constraint:** The hook must never exit non-zero because it could not deliver an event. An undelivered event is a gap in evidence. A crashed Claude session because the hook failed is a system failure. The spool guarantees events are preserved even if the server is down.

### What the Hook Receives from Claude Code

Claude Code invokes the hook as a command and passes event data. The exact mechanism (stdin vs. argv) depends on Claude Code's hook interface, which must be determined during the Day 0 Spike. The hook handles both:

**Via stdin (structured JSON):**
```json
{
  "event": "PreToolUse",
  "tool_name": "Read",
  "tool_input": { "file_path": "/workspace/src/main.ts" },
  "session_id": "sess_abc123",
  "timestamp": "2026-06-18T10:30:00.000Z"
}
```

**Via argv (environment variables or command-line arguments):**
```
praxis-hook pre-tool --tool-name Read --tool-input '{"file_path":"/workspace/src/main.ts"}'
```

The hook normalizer abstracts over both input formats. The output is always the same JSON shape.

---

## Hook Event Types

### PreToolUse

Fires BEFORE Claude Code executes a tool. Captures what Claude INTENDS to do.

**Normalized JSON shape:**
```json
{
  "event_type": "pre_tool",
  "attempt_id": "att_01J...",
  "task_run_id": "run_01J...",
  "worker_id": "w_01J...",
  "timestamp_ns": 1734567890123456789,
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/workspace/src/login.ts",
    "content": "export function login..."
  },
  "raw_event": { /* verbatim Claude event */ }
}
```

**Downstream uses:**
- Builds the intended-action side of the KernelOwnedTranscript
- Compared against PostToolUse to detect divergence (did Claude execute what it said it would?)
- Compared against actual filesystem changes to detect tool-filesystem divergence

### PostToolUse

Fires AFTER Claude Code executes a tool. Captures what ACTUALLY happened.

**Normalized JSON shape:**
```json
{
  "event_type": "post_tool",
  "attempt_id": "att_01J...",
  "task_run_id": "run_01J...",
  "worker_id": "w_01J...",
  "timestamp_ns": 1734567891123456789,
  "tool_name": "Bash",
  "tool_input": {
    "command": "npx vitest run tests/auth/",
    "timeout": 60000
  },
  "tool_output": {
    "stdout": "✓ tests/auth/login.test.ts (3 tests) ...",
    "stderr": "",
    "exit_code": 0
  },
  "raw_event": { /* verbatim Claude event */ }
}
```

**Downstream uses:**
- Builds the executed-action side of the KernelOwnedTranscript
- Test output is parsed by TestOutputParser for ExecGate
- Compared against Claude's self-reported output to detect divergence
- Exit codes are evaluated by ExecGate

### Stop

Fires when Claude Code decides to stop (complete, abort, or error).

**Normalized JSON shape:**
```json
{
  "event_type": "stop",
  "attempt_id": "att_01J...",
  "task_run_id": "run_01J...",
  "worker_id": "w_01J...",
  "timestamp_ns": 1734567892123456789,
  "stop_reason": "completed" | "aborted" | "error" | "max_turns",
  "stop_message": "Task completed successfully. All tests pass.",
  "raw_event": { /* verbatim Claude event */ }
}
```

**Downstream uses:**
- Marks the end of the KernelOwnedTranscript for this attempt
- `stop_message` is one source for `worker_reported_status`
- `stop_reason` provides context for the Truth Engine (did Claude think it completed? did it hit a limit?)
- Divergence detection: compare Stop message with actual evidence

---

## Environment Variables

The hook reads the following environment variables, set by the Claude Code adapter before launching Claude:

| Variable | Required | Purpose |
|----------|----------|---------|
| `PRAXIS_ATTEMPT_ID` | Yes | The attempt identifier. Attached to every hook event. |
| `PRAXIS_TASK_RUN_ID` | Yes | The parent TaskRun identifier. |
| `PRAXIS_WORKER_ID` | Yes | The worker slot identifier. |
| `PRAXIS_RUNTIME_URL` | Yes | Base URL of the PRAXIS runtime server (e.g., `http://127.0.0.1:9876`). Hook POSTs to `{URL}/api/hook-events`. |
| `PRAXIS_RUNTIME_TOKEN` | Yes | Auth token for the runtime server. Sent as `Authorization: Bearer <token>`. |
| `PRAXIS_WORKSPACE_PATH` | Yes | Absolute path to the isolated workspace. Spool file written here. |
| `PRAXIS_HOOK_TIMEOUT_MS` | No | Max time (ms) the hook spends trying to POST before falling back to spool. Default: 2000ms. |
| `PRAXIS_SPOOL_PATH` | No | Override for the spool file path. Default: `{PRAXIS_WORKSPACE_PATH}/.praxis/hook-spool.jsonl`. |

All environment variables are set by the adapter. The hook does not set defaults for required variables -- if any required variable is missing, the hook logs an error to stderr and exits 0 (never fail Claude's session), but the event will be missing critical metadata.

---

## Hook Design Principles

### 1. TINY

The hook binary must be as small and fast as possible. It is called on EVERY tool use in EVERY Claude Code session. If the hook takes 500ms to run and Claude uses 50 tools per session, the hook adds 25 seconds of overhead.

**Performance targets:**
- Cold start (binary not cached): < 50ms
- Warm start (binary cached, same session): < 10ms
- POST to localhost server: < 5ms (typical for 127.0.0.1)
- Total hook execution time (99th percentile): < 100ms

**Implementation constraints:**
- Single binary, no runtime dependency (compile to native or use Bun standalone binary)
- No heavy imports or frameworks
- No database connections
- No file watching or polling
- No external network calls (only POST to localhost)

### 2. ROBUST (Spool Fallback)

The hook must never lose an event. If the runtime server is unreachable, the hook spools the event to a local file. The server ingests the spool on recovery.

**Spool file format:** JSONL (one JSON object per line, each line is a complete hook event). This format is append-friendly (no seeking required) and recoverable (each line is self-contained).

**Spool file path:** `{PRAXIS_WORKSPACE_PATH}/.praxis/hook-spool.jsonl`

**Spool write behavior:**
- Append-only. Never modify or delete existing lines.
- Write each event as a single line. Use newline as delimiter.
- Flush after every write (fsync) to ensure events survive a process crash.
- If the spool file grows beyond a configurable max size (default: 100MB), log warning and continue. Do not drop events.

**Server spool ingestion:**
- On server startup, scan known workspace directories for `.praxis/hook-spool.jsonl` files
- For each spool file: read line by line, validate, persist each event, emit SSE
- Track last-ingested line number per spool file in server state
- On successful full ingest: rename spool file to `.praxis/hook-spool.jsonl.ingested.{timestamp}`
- On partial ingest (crash during recovery): resume from last-ingested line on next startup
- Server must handle duplicate events idempotently (same event delivered twice = stored once)

### 3. TRANSPARENT

The hook must never modify the tool input or output. It observes; it does not interfere.

**Never:**
- Modify tool_input before Claude executes the tool
- Modify tool_output before Claude sees it
- Filter or suppress any event
- Add latency to Claude's tool execution beyond the hook's own execution time
- Fail or block a tool call because the hook encountered an error
- Log warnings or errors to stdout (only stderr, to avoid contaminating Claude's transcript)

**Always:**
- Capture the raw event verbatim in `raw_event` field
- Exit 0 regardless of delivery success or failure
- Write errors only to stderr (never stdout)
- Complete execution in under 100ms (99th percentile)

### 4. FIRE-AND-FORGET

The hook does not wait for the server to acknowledge the event before returning. It POSTs and exits. The server processes asynchronously. If the POST times out, the hook spools and exits. The hook never retries a POST.

This constraint is critical: if the hook waited for server acknowledgment, every tool call would add server-processing latency to Claude's execution. "Fire-and-forget" keeps the hook fast and keeps Claude unblocked.

---

## Server Ingestion → EvidenceRecord → EHC Chain

Once the hook event reaches the runtime server (via POST or spool ingestion), it enters the evidence pipeline:

```
1. Server receives hook event (POST /api/hook-events)
       │
       v
2. Validate event shape (Zod schema):
   - event_type is valid enum (pre_tool | post_tool | stop)
   - attempt_id, task_run_id, worker_id are present
   - timestamp_ns is valid
   - Reject malformed events (HTTP 400)
       │
       v
3. Persist raw event:
   - INSERT INTO runtime_events (type, aggregate_type, aggregate_id, payload)
   - SSE emit: evidence.hook_event with event payload
       │
       v
4. kernel/evidence processes the event:
   a. Build EvidenceRecord from hook event
   b. Compute content_hash = sha256(canonical JSON of event)
   c. Compute chain_hash = sha256(prev_chain_hash + content_hash)
   d. Append to Evidence Hash Chain for this attempt
       │
       v
5. EHC Break Classifier evaluates chain integrity:
   - NOISE: isolated missing record, chain otherwise intact
   - SUSPECTED: pattern of missing records or hash mismatches
   - CONFIRMED: chain integrity broken + divergence detected
       │
       v
6. Circuit Breaker receives EHC classification:
   - CONFIRMED → OPEN Circuit Breaker (system-wide safety response)
   - SUSPECTED → log, monitor, do NOT open breaker
   - NOISE → log, monitor, do NOT open breaker
       │
       v
7. Truth Engine consumes hook events:
   - Builds KernelOwnedTranscript (full tool-use trace)
   - ExecGate evaluates: did commands run? did tests pass?
   - DivergenceDetector compares hook events vs. worker claims
```

### EvidenceRecord Shape (for hook events)

```typescript
interface EvidenceRecord {
  id: string;                // ev_01J...
  attempt_id: string;
  worker_id: string;
  timestamp_ns: bigint;
  source: 'kernel_hook';     // All hook events have this source
  kind: 'pre_tool' | 'post_tool' | 'stop';
  content: string;           // Canonical JSON of the hook event
  content_hash: string;      // sha256(content)
  chain_hash: string;        // sha256(prev_chain_hash + content_hash)
}
```

### EHC Break Classification Rules

| Classification | Criteria | Circuit Breaker Response |
|----------------|----------|-------------------------|
| **NOISE** | Single missing record in chain; chain hash otherwise consistent; no divergence detected | Log. Monitor. Do NOT open Circuit Breaker. |
| **SUSPECTED** | Multiple missing records; or hash mismatch pattern across records; or chain has gaps but no confirmed divergence | Log. Monitor. Flag for operator review. Do NOT open Circuit Breaker. |
| **CONFIRMED** | Chain integrity broken (hash mismatch with verifiable evidence) AND divergence detected (hook events contradict worker claims) | OPEN Circuit Breaker. Emit circuit_breaker.opened. Include diagnostic snapshot. |

**Important:** The hook does NOT classify EHC breaks. The hook delivers raw events. The EHC Break Classifier in `kernel/evidence` classifies breaks. The Circuit Breaker in `kernel/circuit-breaker` responds to CONFIRMED breaks. The hook's job ends at step 1 (deliver event to server).

---

## MUST / MUST NOT Rules

### Hook MUST

- Capture every event Claude Code emits (PreToolUse, PostToolUse, Stop)
- Normalize events to the standard JSON shape with all required fields
- Read PRAXIS metadata from environment variables and attach to every event
- POST events to `{PRAXIS_RUNTIME_URL}/api/hook-events` with auth token
- Spool events to local file when server POST fails (connection refused, timeout, non-2xx)
- Exit 0 in all cases (never fail the Claude Code session)
- Write errors and diagnostics only to stderr (never stdout)
- Complete execution in under 100ms (99th percentile)
- Include the raw verbatim Claude event in `raw_event` field
- Use monotonic timestamps (never decreasing) for `timestamp_ns`

### Hook MUST NOT

- Decide truth or evaluate correctness of tool input/output (D-031)
- Modify tool input before Claude executes the tool
- Modify tool output before Claude sees it
- Filter, suppress, or drop any event
- Evaluate gate criteria or acceptance criteria
- Assign PASS/HOLD/FAIL verdicts
- Retry failed POSTs (spool and exit instead)
- Wait for server acknowledgment before returning (fire-and-forget)
- Access the filesystem beyond reading the spool file and writing to it
- Import from `kernel/*`, `interface/*`, or `server/*` packages
- Make network calls to any host other than `PRAXIS_RUNTIME_URL`
- Block or delay Claude's tool execution beyond the hook's own execution time
- Log to stdout (would contaminate Claude's transcript)

---

## Failure Modes

| Failure | Detection | Hook Response | Server Response | Impact |
|---------|-----------|---------------|-----------------|--------|
| Server unreachable (connection refused) | HTTP POST fails | Spool event to local file; exit 0 | Ingest spool on recovery | Event delayed but not lost. Evidence gap until recovery. |
| Server returns 5xx | HTTP POST returns 500+ | Spool event; exit 0 | Server may have partially stored event; dedup on spool ingest | Potential duplicate event; server must handle idempotently. |
| Server returns 4xx (validation error) | HTTP POST returns 400 | Spool event; exit 0 | Event may be malformed; spool ingest will also reject | Event lost if permanently malformed. Logged as evidence gap. |
| Spool file not writable | File append fails | Log error to stderr; exit 0 | Event lost | Evidence gap. Kernel detects gap via EHC chain hash discontinuity. |
| Spool file exceeds max size | File size check | Log warning; continue appending | May ingest large spool on recovery | Disk pressure on workspace. Monitor and alert. |
| Hook binary not found | Claude Code cannot invoke hook | Claude logs error; continues without hooks | No hook events received | ExecGate detects missing KernelOwnedTranscript → HOLD. Divergence detection unavailable. |
| Hook crashes (SIGSEGV, uncaught exception) | Claude Code detects non-zero exit or signal | N/A (process dead) | No event delivered or spooled | Evidence gap. Claude Code behavior on hook crash must be verified during Day 0 Spike (S2). |
| Hook exceeds time budget (hooks take > 2 sec) | Timer in hook process | Kill self after PRAXIS_HOOK_TIMEOUT_MS; spool partial event if possible | May receive truncated event | Degraded evidence. EHC gap. |
| PRAXIS_RUNTIME_URL environment variable missing | Hook startup | Log error to stderr; exit 0 | No event delivered or spooled | Evidence gap. Adapter misconfiguration. |
| PRAXIS_RUNTIME_TOKEN missing or invalid | Server returns 401 | Spool event (server rejected); exit 0 | Server rejects; operator must fix token | Events spooled until token is corrected. |
| Spool file corrupted (partial write from crash) | Server spool ingest | N/A | Skip corrupted lines; log; continue with remaining lines | Partial event loss for corrupted lines. |
| Network partition between hook and server | HTTP POST timeout | Spool event after PRAXIS_HOOK_TIMEOUT_MS; exit 0 | Server never received event | Spool covers the gap. Ingested on recovery. |
| Duplicate event (hook ran twice for same tool call) | Server dedup check | N/A | Dedup by attempt_id + timestamp_ns + event_type + tool_name | Same event stored once. EHC chain hash unchanged. |

---

## Test / Gate Implications

### Unit Tests (hooks/praxis-hook)

- PreToolUse handler: parses input correctly, normalizes to standard JSON
- PostToolUse handler: parses input correctly, normalizes to standard JSON
- Stop handler: parses input correctly, normalizes to standard JSON
- Event normalizer: all required fields present; raw_event preserved verbatim
- Environment variable reader: reads all required vars; handles missing vars gracefully (logs, exits 0)
- Runtime client: POSTs to correct URL with correct auth header
- Runtime client: handles HTTP 200 (success path)
- Runtime client: handles connection refused (spool path)
- Runtime client: handles HTTP timeout (spool path)
- Runtime client: handles HTTP 400/500 (spool path)
- Spool writer: appends JSONL to correct file path
- Spool writer: flushes after each write
- Spool writer: handles disk full gracefully
- Hook exits 0 in all cases (success, spool, error)
- Hook execution time under 100ms for all paths (performance assertion)

### Integration Tests (P4)

- Full end-to-end: Claude Code uses tool → hook fires → event arrives at server
- Spool ingestion: server startup ingests existing spool file; all events persisted
- Spool dedup: duplicate events in spool are stored once
- Spool partial ingestion: server crash mid-ingest → resume from last line on restart
- Hook does not block Claude: measure Claude tool execution time with and without hook; overhead < 100ms
- Hook does not crash Claude: hook returns non-zero exit code (simulated failure); Claude continues normally

### Server Ingestion Tests (P3)

- Hook event validation: malformed events rejected with 400
- Hook event persistence: valid events stored in runtime_events table
- Hook event SSE emission: each stored event emits SSE event
- EvidenceRecord construction from hook event
- EHC chain hash computation: prev_chain_hash + content_hash → new chain_hash
- EHC break classification:
  - Single missing record → NOISE
  - Pattern of hash mismatches → SUSPECTED
  - Chain broken + divergence → CONFIRMED

### Circuit Breaker Integration Tests (P3)

- EHC CONFIRMED → Circuit Breaker OPEN
- EHC NOISE → Circuit Breaker state unchanged
- EHC SUSPECTED → Circuit Breaker state unchanged

### False-Done Tests (P3)

- Claude claims "done" but hook transcript shows no test command ran → ExecGate HOLD
- Claude claims "done" but hook transcript shows tests failed → ExecGate HOLD
- Claude claims "done" but hook-captured tool output differs from Claude's reported output → divergence detected

---

## Decision Compliance Checklist

| Check | Status |
|-------|--------|
| Hook does not decide truth (D-031) | [ ] |
| Hook does not evaluate gate criteria | [ ] |
| Hook does not modify tool input or output | [ ] |
| Hook captures raw events verbatim (raw_event field) | [ ] |
| Hook spools on delivery failure; never loses events | [ ] |
| Hook exits 0 in all cases; never crashes Claude session | [ ] |
| Hook execution time under 100ms (99th percentile) | [ ] |
| Hook writes errors only to stderr; never to stdout | [ ] |
| Hook does not import from kernel/* (D-027) | [ ] |
| Hook does not import from interface/* (D-027) | [ ] |
| Hook does not import from server/* (D-027) | [ ] |
| Server validates hook event shape before persistence | [ ] |
| Server deduplicates events idempotently | [ ] |
| Server ingests spool files on recovery | [ ] |
| EvidenceRecord built from hook events with correct chain_hash | [ ] |
| EHC break classifier: NOISE / SUSPECTED do NOT open Circuit Breaker | [ ] |
| EHC break classifier: CONFIRMED DOES open Circuit Breaker (D-109) | [ ] |
| KernelOwnedTranscript built from hook events (not from Claude's self-report) | [ ] |

---

## Open Questions

| ID | Question | Owner | Notes |
|----|----------|-------|-------|
| HC-001 | What is the exact mechanism Claude Code uses to pass event data to the hook? stdin JSON? argv? Both? | Day 0 Spike (S2) | The hook must support whatever mechanism Claude Code uses. The Spike must determine this. |
| HC-002 | What happens when a hook command exits non-zero? Does Claude Code abort the tool call, abort the session, or continue? | Day 0 Spike (S2) | The hook intentionally exits 0, but the Spike must verify Claude Code's behavior for non-zero exit anyway (edge case). |
| HC-003 | Does Claude Code invoke hooks synchronously (blocking the tool call) or asynchronously (fire-and-forget like the hook itself)? | Day 0 Spike (S2) | If synchronous, hook execution time directly impacts Claude's performance. The hook's <100ms target assumes synchronous invocation. |
| HC-004 | What is the exact format of the Claude Code Stop event? Does it include a structured stop reason or just a message string? | Day 0 Spike (S2) | The Stop event shape determines how the normalizer maps stop_reason. |
| HC-005 | Should the spool file be per-attempt or per-workspace? | Architecture | Per-workspace is simpler (one file per workspace directory). Per-attempt is cleaner (each attempt has its own spool). Decision TBD based on workspace lifecycle design. |
| HC-006 | At what point is a spool file safe to delete? After full ingest? After ACCP FVR generation? Never (archive forever)? | Server/storage design | Must be coordinated with evidence retention policy. |
| HC-007 | How does the server discover spool files? Scan on startup? Registry of known workspaces? Adapter notifies server of spool path? | Server design (P2/P3) | Startup scan of known workspaces is simplest; adapter notification is more reliable. |
| HC-008 | What is the hook implementation language? Bun standalone binary? Go? Rust? | Implementation | Must be a single binary with no runtime dependency. Bun standalone, Go, or Rust are all viable. Decision TBD during P4 implementation planning. |

---

## Audit Notes

- This document is DRAFT_FOR_AUDIT v0.1. The Day 0 Spike (specifically S2: Hook Reliability Verification) will provide real data on hook invocation mechanics, latency, and Claude Code's behavior when hooks fail. The Spike results may necessitate revisions.
- The hook's four design principles (TINY, ROBUST, TRANSPARENT, FIRE-AND-FORGET) are architectural constraints, not implementation suggestions. Any hook implementation that violates these principles is incorrect.
- The hook's "never exit non-zero" constraint is critical for system reliability. A hook that crashes the Claude Code session because the server was temporarily unreachable would defeat the purpose of the spool fallback.
- The hook's "never modify tool input/output" constraint is critical for evidence integrity. If the hook modifies Claude's tool calls, the KernelOwnedTranscript is no longer a faithful record of what Claude did, and the Truth Engine's verification is compromised.
- The spool format (JSONL) is chosen for simplicity and recoverability. Each line is a self-contained JSON object. Corruption of one line does not prevent ingestion of subsequent lines. JSONL is also trivially parseable by any language.
- The hook's `raw_event` field preserves the verbatim Claude event. This is essential for debugging, audit, and defending against accusations that PRAXIS modified evidence. The normalized fields are convenience; the raw field is truth.
- This document was written against `docs/decisions.md` as the canonical source. Any conflict with `architecture.md` or other documents is resolved in favor of `docs/decisions.md`.
