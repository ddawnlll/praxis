# Day 0 Claude Code Spike

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the Day 0 Spike that gates real Claude Code adapter implementation. This spike must return GO or NO-GO before any Claude adapter, hook, or KernelOwnedTranscript code is written (D-072, D-077).

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document specifies the Day 0 Spike -- a focused engineering investigation that determines whether Claude Code headless + praxis-hook is a viable primary integration path for PRAXIS. The spike runs 8 targeted tests, collects evidence, and produces a GO/NO-GO verdict. The verdict gates all P4 (Real Worker Integration) implementation.

This is a spike specification, not an implementation plan. It defines what to test, how to test it, what evidence to collect, and what decision criteria to apply.

---

## Scope

- 8 concrete tests covering headless invocation, hook capture (PreToolUse, PostToolUse, Stop), divergence detection, concurrent session probing, rate limit symptom classification, and hook spool fallback
- GO/NO-GO criteria for the primary integration path (headless + praxis-hook)
- Evidence collection requirements for each test
- Decision compliance verification against `docs/decisions.md`
- Fallback trigger definition if NO-GO is returned

---

## Non-Goals

- Implementation of a real Claude adapter, hook binary, or KernelOwnedTranscript (those are P4, gated on spike GO)
- Testing stable_16 concurrency (stable_16 is an OPEN hypothesis; this spike probes 2/3/4 sessions only)
- Testing production load, long-run stability, or full integration pipelines
- Modifying `docs/decisions.md`
- Writing any kernel, server, or adapter code
- Evaluating OpenCode, local models, or any non-Claude worker

---

## Authoritative Decisions Used

Every test, criterion, and design choice in this spike specification is constrained by the following decisions from `docs/decisions.md`.

| Decision ID | Decision | How It Applies |
|-------------|----------|----------------|
| D-070 | Primary path: Claude Code headless + praxis-hook | This spike tests the viability of this exact path. |
| D-071 | Fallback path: Claude Messages API + PRAXIS-instrumented tools | Triggered if this spike returns NO-GO. |
| D-072 | Day 0 Spike must verify headless behavior, hooks, divergence capture, and rate limit ceiling | This document is the specification for that spike. HARD_LOCK -- spike must complete before P4. |
| D-073 | Claude adapter is an external worker bridge | Adapter role is mechanical: launch, configure, capture, normalize. Spike tests mechanical viability. |
| D-074 | Adapter starts processes, prepares env/config/prompts, normalizes results | Spike tests whether headless process launch and output capture are reliable. |
| D-075 | Claude adapter does not decide completion | No spike test gives the adapter completion authority. Hook events are evidence, not verdicts. |
| D-076 | Claude local loop is separate from PRAXIS supervisory loop | Spike tests hook observation from the outside; it does not modify Claude's internal loop. |
| D-077 | Claude Code implementation must not start before Day 0 Spike GO | HARD_LOCK -- this spike gates P4. |
| D-028 | Worker self-report is not completion | Worker "done" claims in spike tests are treated as evidence, not completion. |
| D-031 | Hook never decides truth | Hook events are raw evidence. Spike tests capture, not evaluation. |
| D-032 | Truth Engine owns PASS/HOLD/FAIL | No spike test produces a gate verdict. |
| D-021 | Adapters integrate external workers, normalize output, do not decide completion | Spike tests adapter-like normalization of rate limit and crash signals. |

---

## Hypotheses Under Test

These are the hypotheses that the spike must confirm or refute through empirical testing.

| # | Hypothesis | What Would Prove It | What Would Refute It |
|---|-----------|---------------------|----------------------|
| H1 | Claude Code can be invoked headlessly without TTY, producing deterministic, capturable output. | `claude --headless --print "hello"` exits 0 with stdout "hello" on multiple runs in a non-TTY environment. | Requires TTY, hangs without terminal, produces inconsistent or uncapturable output. |
| H2 | PreToolUse and PostToolUse hooks fire reliably and produce structured, parseable events. | Every tool call by Claude produces a PreToolUse event before execution and a PostToolUse event after execution. No missed events across 20+ tool calls. | Events are missed, arrive out of order, contain unparseable data, or fail silently. |
| H3 | Tool outputs captured by hooks match the actual tool results that Claude acts upon. | The stdout/stderr in PostToolUse hook payload matches the actual command output on disk. | Hook output is truncated, stale, mismatched, or missing fields. |
| H4 | Claude's Stop event fires with the correct reason and timing when a task completes or fails. | Claude finishes a task, Stop event fires once with reason matching the actual outcome. | Stop event does not fire, fires multiple times, fires with wrong reason, or fires before tool execution finishes. |
| H5 | Worker claims and observed evidence can diverge, and that divergence is detectable and recordable. | A worker claims a file was written but no Write tool call appears in hook events. Divergence flag is raised. | Divergence cannot be detected because hooks miss events, or false positives are too frequent. |
| H6 | Multiple concurrent headless Claude sessions can run without catastrophic resource contention or event collision. | 2, 3, and 4 concurrent sessions all complete their tasks. Session outputs are distinguishable and not interleaved. | Sessions crash, hang, produce interleaved output, or exhaust system resources below 4 concurrent sessions. |
| H7 | Rate limit responses from Claude's API can be classified as external signals (RateLimitSignal), not as task completion or task failure. | Rapid requests trigger a rate limit; the adapter-like normalization layer detects and classifies it as RateLimitSignal. | Rate limits crash Claude, produce unparseable output, or are indistinguishable from task errors. |
| H8 | If the PRAXIS runtime is unavailable, hook events can be spooled locally to disk (JSONL) and replayed on recovery. | Kill runtime, trigger a hook event, verify JSONL file written to spool directory with correct event data. Restart runtime, verify events are replayed. | Events are lost, spool file is corrupted, replay duplicates or skips events, or hook crashes without runtime. |

---

## Test Matrix

### DAY0-T001: Claude Code Headless Launch Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T001 |
| **Name** | Claude Code Headless Launch Test |
| **Hypothesis** | H1 -- Claude can be invoked non-interactively in an isolated workspace |
| **What It Proves** | Claude Code can run without TTY, produce capturable stdout, and exit cleanly with expected exit codes. This is the prerequisite for all other tests. |
| **Procedure** | 1. Create an isolated workspace directory with no existing Claude state. 2. Set environment: `CLAUDE_CODE_HEADLESS=1`, ensure no TTY is attached (run via script, not interactive terminal). 3. Invoke: `claude --headless --print "hello"`. 4. Capture stdout, stderr, exit code. 5. Repeat 10 times to verify consistency. 6. Verify output is deterministic (stdout contains or equals "hello"). 7. Verify exit code is 0 on every run. 8. Record time-to-first-byte and total execution time for all 10 runs. |
| **Success Criteria** | All 10 invocations exit 0 with stdout containing "hello". No TTY errors in stderr. Execution time variance < 50% of median. No invocation hangs or requires interactive input. |
| **Failure Modes** | Hangs waiting for TTY input. Exits non-zero. Produces empty or unparseable stdout. Crashes on missing environment. Output varies unpredictably between runs. |

---

### DAY0-T002: PreToolUse Hook Capture Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T002 |
| **Name** | PreToolUse Hook Capture Test |
| **Hypothesis** | H2 -- PreToolUse hooks fire before tool execution and produce structured events |
| **What It Proves** | PRAXIS hook can observe tool-call intent before the tool executes. This is the observation mechanism for the supervisory loop. |
| **Procedure** | 1. Configure a PreToolUse hook that writes structured JSON events to a known path (simulating the praxis-hook contract). 2. Invoke Claude with a task that requires tool use: "Create a file named test.txt containing the string 'hello world'". 3. The hook must capture: tool_name, tool_input (full parameters), timestamp, session_id. 4. Verify that for every tool call Claude makes, a PreToolUse event is written before the tool executes. 5. Run 3 distinct tasks that use different tools (Write, Bash, Read) and verify hook coverage for all tool types. 6. Verify event ordering: PreToolUse event timestamp must precede the tool's actual execution. |
| **Success Criteria** | Every tool call produces exactly one PreToolUse event. No events arrive after tool execution begins. All required fields (tool_name, tool_input, timestamp, session_id) are present and well-formed. Coverage is 100% across Write, Bash, and Read tool types. |
| **Failure Modes** | Some tool calls produce no PreToolUse event. Events arrive after tool execution. Event JSON is malformed. Hook crashes and takes Claude down with it. Hook blocks tool execution (synchronous failure). |

---

### DAY0-T003: PostToolUse Hook Capture Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T003 |
| **Name** | PostToolUse Hook Capture Test |
| **Hypothesis** | H2, H3 -- PostToolUse hooks fire after tool execution and capture actual results |
| **What It Proves** | PRAXIS hook can observe tool-call results/output after execution. The captured output can be correlated back to the PreToolUse event for the same call. |
| **Procedure** | 1. Configure a PostToolUse hook (paired with the PreToolUse hook from DAY0-T002). 2. Use the same tasks as DAY0-T002. 3. Hook must capture: tool_name, tool_output (stdout + stderr), exit_code (if applicable), timestamp, session_id, and a correlation_id matching the PreToolUse event. 4. For a Bash tool call (`echo "verify_me"`), verify that PostToolUse.tool_output.stdout contains "verify_me". 5. For a Write tool call, verify that PostToolUse.tool_output confirms the file was written. 6. Verify correlation: every PreToolUse event has a corresponding PostToolUse event with matching correlation_id. |
| **Success Criteria** | Every tool call produces exactly one PostToolUse event with correct output. stdout/stderr content matches actual tool output verified independently. All PostToolUse events can be paired with their PreToolUse events via correlation_id. |
| **Failure Modes** | PostToolUse events are missing for some tool calls. Output is truncated or stale. correlation_id is absent or mismatched. Hook captures empty output when real output exists. Hook output differs from actual tool output. |

---

### DAY0-T004: Stop Hook Capture Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T004 |
| **Name** | Stop Hook Capture Test |
| **Hypothesis** | H4 -- Stop event fires with correct reason and timing |
| **What It Proves** | PRAXIS can detect when the worker claims it has stopped/completed, and can observe the claimed reason. This is the "worker self-report" event that feeds into EvidenceGate (as evidence, not as completion). |
| **Procedure** | 1. Configure a Stop hook that writes a structured JSON event. 2. Run 3 Claude tasks: (a) a simple task that completes successfully, (b) a task designed to fail (e.g., "run a command that doesn't exist"), (c) a task that is interrupted (kill the Claude process). 3. For each, capture: stop_reason, timestamp, session_id, any exit_code. 4. Verify Stop event fires exactly once per session. 5. Verify stop_reason matches the observable outcome (success task → reason indicates completion, fail task → reason indicates error, killed process → reason indicates interrupt or no Stop event). |
| **Success Criteria** | Stop event fires once per session for tasks (a) and (b) with correct reason. Task (c) either produces a Stop event with interrupt reason OR produces no Stop event (both are acceptable; document which occurs). Stop event timestamp is after all PostToolUse events. |
| **Failure Modes** | Stop event does not fire for completed tasks. Stop event fires multiple times. stop_reason is always "success" regardless of actual outcome. Stop event fires before tool execution finishes. |

---

### DAY0-T005: Divergence Capture Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T005 |
| **Name** | Divergence Capture Test |
| **Hypothesis** | H5 -- Worker claims and observed evidence can diverge, and divergence is recordable |
| **What It Proves** | PRAXIS can detect when the worker's self-report differs from the evidence captured by hooks. This is the foundation for false-done detection and divergence flagging. |
| **Procedure** | 1. Create a task where Claude would naturally claim completion: "Write a file named output.txt containing 'done' and report completion." 2. Use a hook that intercepts Write calls but does NOT block them. 3. Artificially create divergence by removing the Write event from the collected evidence set (simulating a missed hook event) OR by having the worker claim a file was written but the hook shows no Write call for that path. 4. Compare worker_claimed_actions (from Stop event or worker transcript) against evidence_observed_actions (from hook events). 5. Record the divergence: claim vs. evidence, missing events, contradictory events. 6. Test both scenarios: (a) worker claims file written, evidence shows it was; (b) worker claims file written, evidence shows no Write call for that path. |
| **Success Criteria** | Divergence detection algorithm can flag scenario (b) as a divergence. Divergence record includes: what the worker claimed, what evidence shows (or doesn't show), timestamp, and confidence level. No false divergence flags for scenario (a). |
| **Failure Modes** | Cannot detect divergence because hook events are incomplete. Too many false positives (legitimate matches flagged as divergence). Divergence record is not structured enough for downstream gate consumption. |

---

### DAY0-T006: Concurrent Session Smoke Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T006 |
| **Name** | Concurrent Session Smoke Test |
| **Hypothesis** | H6 -- Multiple concurrent headless Claude sessions can run without catastrophic failure |
| **What It Proves** | Practical concurrency limits for Claude Code headless sessions. Informs the Governor's starting tier (stable_3) by providing real evidence about resource behavior at 2, 3, and 4 concurrent workers. |
| **Procedure** | 1. Create 4 isolated workspace directories with distinct tasks. 2. Launch 2 concurrent headless Claude sessions, each in its own workspace. All sessions write hook events to distinct output paths. 3. Wait for all 2 to complete. Measure: completion status, execution time, event count per session, resource usage (CPU, memory, disk I/O). 4. Repeat with 3 concurrent sessions. 5. Repeat with 4 concurrent sessions. 6. For each tier, verify: all sessions complete without hanging, hook events are not interleaved between sessions, workspace isolation is maintained. 7. Record minimum, maximum, and median completion times per tier. |
| **Success Criteria** | All sessions complete at 2 and 3 concurrent. At 4 concurrent, at least 3 of 4 complete (resource contention may cause one to be slower but not crash). No cross-session event leakage. Workspace files remain isolated. Resource usage is measured and documented for each tier. |
| **Failure Modes** | Any session hangs or crashes at 2 concurrent. Sessions produce interleaved output in shared directories. Resource exhaustion (OOM, disk full) at 3 or fewer sessions. Hook events from one session appear in another session's output. |

---

### DAY0-T007: Rate Limit Symptom Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T007 |
| **Name** | Rate Limit Symptom Test |
| **Hypothesis** | H7 -- Rate limit responses can be classified as external signals, not task outcomes |
| **What It Proves** | The adapter/runtime can recognize rate limit symptoms and normalize them as RateLimitSignal rather than treating them as task failures or completion. This protects the Truth Engine from evaluating rate-limited runs as failed attempts. |
| **Procedure** | 1. Prepare a task that makes multiple API calls in rapid succession to trigger a rate limit. 2. Run Claude headless with hook capture enabled. 3. Observe Claude's behavior when rate limited: does it retry? Does it exit? What exit code? What does stdout/stderr contain? 4. If rate limits cannot be triggered naturally, simulate the response pattern: feed Claude output that matches known rate-limit signatures. 5. Write a classifier that inspects Claude output and hook events to detect: rate limit HTTP 429 patterns, "rate limit" strings in stderr, retry-after headers, exponential backoff behavior. 6. Verify the classifier produces a structured RateLimitSignal with: detection_method, confidence, raw_evidence. 7. Verify the classifier does NOT classify rate limits as CrashSignal, TimeoutSignal, or successful completion. |
| **Success Criteria** | Rate limit symptoms are detectable from Claude output and/or hook events. The classifier correctly distinguishes RateLimitSignal from other signal types. Rate limit does not cause Claude to exit with a misleading success code. |
| **Failure Modes** | Rate limits cannot be triggered or simulated. Rate limit causes Claude to crash with unparseable output. Classifier misclassifies rate limits as task failure or success. Rate limit output is indistinguishable from genuine tool errors. |

---

### DAY0-T008: Hook Spool Fallback Test

| Field | Value |
|-------|-------|
| **ID** | DAY0-T008 |
| **Name** | Hook Spool Fallback Test |
| **Hypothesis** | H8 -- Hooks can spool events locally when runtime is unavailable and replay on recovery |
| **What It Proves** | The hook layer is resilient to runtime unavailability. Events are never silently lost. This is critical for evidence integrity: if the runtime is down, evidence must still be captured and eventually delivered. |
| **Procedure** | 1. Configure the hook to POST events to a local runtime endpoint (can be a mock HTTP server for this test). 2. Start Claude with the hook configured. 3. While Claude is running, kill the mock runtime server. 4. Trigger a tool call in Claude (e.g., Claude uses Write or Bash). 5. Verify the hook detects the POST failure and writes the event to a spool directory as a JSONL file. 6. Verify the spool file contains: the full event payload, a timestamp, a sequence number, and a session_id. 7. Restart the mock runtime server. 8. Verify the hook (or a separate replay utility) replays the spooled events to the runtime. 9. Verify events are replayed in order and exactly once (no duplicates, no gaps). |
| **Success Criteria** | Hook writes events to spool directory when runtime POST fails. Spool file is valid JSONL with one event per line. All fields match the hook's normal POST payload. Replay delivers events to runtime in correct order. No events are lost. No duplicate events on replay. |
| **Failure Modes** | Hook crashes without spooling events. Spool file is malformed or empty. Replay skips events or delivers duplicates. Hook does not detect POST failure and silently drops events. Spool directory fills disk with no backpressure. |

---

## GO/NO-GO Criteria

### GO Criteria (All Must Pass)

The primary path (Claude Code headless + praxis-hook) is viable if ALL of the following are true after spike completion:

| # | Criterion | Verified By |
|---|-----------|-------------|
| G1 | Headless invocation works reliably. No TTY dependency. Deterministic output. | DAY0-T001 |
| G2 | PostToolUse events are captured for every tool call. | DAY0-T003 |
| G3 | Stop events are captured with correct reason and timing. | DAY0-T004 |
| G4 | Tool outputs can be correlated to attempt_id and worker_id. | DAY0-T002, DAY0-T003 |
| G5 | Divergence between worker claim and observed evidence can be recorded. | DAY0-T005 |
| G6 | Rate limit symptoms are observable and classifiable as signals (not task outcomes). | DAY0-T007 |
| G7 | No hook path gives completion authority to the hook or adapter. | All tests (design verification, not runtime test) |
| G8 | Hook failures do not cause silent event loss (spool fallback works). | DAY0-T008 |

### NO-GO Criteria (Any One Triggers NO-GO)

The primary path is NOT viable and fallback MUST be used if ANY of the following are true:

| # | Criterion | Detected By |
|---|-----------|-------------|
| N1 | Claude cannot run headlessly enough for automation (requires TTY, hangs, non-deterministic output). | DAY0-T001 |
| N2 | Hooks cannot capture enough events for evidence (missed events, unparseable output, missing critical fields). | DAY0-T002, DAY0-T003, DAY0-T004 |
| N3 | Stop/completion claims cannot be observed (Stop event missing, unreliable, or wrong). | DAY0-T004 |
| N4 | Tool outputs cannot be correlated to specific attempts (no correlation_id, cross-session leakage). | DAY0-T002, DAY0-T003, DAY0-T006 |
| N5 | Hook failures are silent and unrecoverable (spool fallback does not work). | DAY0-T008 |

---

## Fallback Trigger

If the spike returns NO-GO (any one NO-GO criterion is met), the fallback path is automatically activated:

**Fallback:** Claude Messages API + PRAXIS-instrumented tools (D-071).

### What the Fallback Changes

| Aspect | Primary Path (Headless + Hook) | Fallback Path (Messages API) |
|--------|-------------------------------|------------------------------|
| Worker execution mechanics | Claude runs its own internal loop; PRAXIS observes from outside via hooks | PRAXIS runs the tool execution loop via Messages API; Claude responds to API calls |
| Tool execution ownership | Claude owns tool execution; PRAXIS observes | PRAXIS owns tool execution; Claude is the reasoning engine |
| Hook layer | Required (PreToolUse, PostToolUse, Stop hooks in Claude Code) | Not required (PRAXIS directly instruments every tool call) |
| Adapter implementation | Launches Claude process, configures hooks, collects events | Manages Messages API session, dispatches tool calls, collects responses |
| Rate limit handling | Observed externally via hooks; classified as RateLimitSignal | Handled in the API loop; retry logic is PRAXIS-owned |

### What the Fallback Must NOT Change

These are HARD_LOCK and must remain identical regardless of integration path:

- **Truth Engine authority** (D-032): Truth Engine is the sole completion authority. Neither path gives completion authority to Claude or the adapter.
- **The Three Laws**: Law 1 (Completion Authority), Law 2 (Write Authority), Law 3 (Verification Authority) are unchanged.
- **Evidence model**: EvidenceRecord, Evidence Hash Chain, divergence detection -- all apply identically.
- **Gate pipeline**: EvidenceGate, ExecGate, FinalGate remain kernel-owned and unchanged.
- **Circuit Breaker / Governor**: Safety systems are integration-path-agnostic.
- **Namespace isolation**: Workers operate in isolated workspaces regardless of integration path.
- **Assembler**: Deterministic Assembler remains the sole shared writer.

---

## Evidence Required

For each test, collect and preserve the following evidence. All evidence must be stored in a structured directory and referenced in the spike report.

| Test | Evidence to Collect |
|------|---------------------|
| DAY0-T001 | Raw stdout/stderr for all 10 runs. Exit codes. Timing data (CSV: run_id, ttfb_ms, total_ms, exit_code). Environment configuration used. |
| DAY0-T002 | All PreToolUse hook event files (JSON). Task descriptions used. Count of tool calls per task. Coverage report: tool_calls_expected vs. hook_events_captured. |
| DAY0-T003 | All PostToolUse hook event files (JSON). Correlation report: PreToolUse/PostToolUse pairs matched vs. unmatched. Independent verification of tool outputs (actual file contents, command outputs). |
| DAY0-T004 | All Stop hook event files (JSON) for all three task types. Task descriptions. Correlation between Stop reason and actual task outcome. |
| DAY0-T005 | Divergence detection log. Worker claim record (from Stop event). Evidence record (from hook events). Divergence report: claim, evidence, flag, confidence. |
| DAY0-T006 | Per-session completion status and timing. Resource metrics snapshot (CPU, memory per session). Event count per session. Cross-contamination report (any events in wrong session?). |
| DAY0-T007 | Claude output when rate limited (full stdout/stderr). Classifier output: signal type, confidence, raw evidence. Classification accuracy report. |
| DAY0-T008 | Spool directory contents (JSONL files). Mock runtime logs before/after kill/restart. Replay verification report: events_spooled vs. events_replayed, duplicates, gaps. |

**Evidence storage format:**

```
spike-results/
├── t001-headless/
│   ├── run-01.stdout
│   ├── run-01.stderr
│   ├── ...
│   ├── run-10.stdout
│   ├── timing.csv
│   └── report.md
├── t002-pretool-hook/
│   ├── task-01/
│   │   ├── events.jsonl
│   │   └── coverage.json
│   ├── task-02/
│   └── task-03/
├── t003-posttool-hook/
├── t004-stop-hook/
├── t005-divergence/
├── t006-concurrent/
├── t007-rate-limit/
├── t008-spool-fallback/
└── GO-NOGO-REPORT.md
```

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Claude Code headless mode changes or is removed between now and spike execution | HIGH | Verify headless mode availability at spike start. If changed, document current behavior and test against current version. |
| Hooks are not yet implemented in Claude Code at the time of spike execution | CRITICAL | Verify hook availability at spike start. If hooks are not yet available, this is an automatic NO-GO and fallback is activated. |
| Rate limits prevent completion of spike tests | MEDIUM | Budget API tokens for spike. Run tests during off-peak hours. If rate limits block spike completion, document ceiling and trigger NO-GO. |
| Concurrent session testing exceeds available system resources | LOW | Run on a machine with at least 16GB RAM and 4+ CPU cores. Document hardware specifications. |
| Claude Code behavior differs between development and production environments | MEDIUM | Run spike on the target OS (Linux) with production-like constraints. Document environment exactly. |
| Spike scope creep -- testers try to answer questions beyond the 8 tests | MEDIUM | Strict scope enforcement. Additional experiments are noted as Open Questions but do not block GO/NO-GO. |

---

## Decision Compliance Checklist

| Decision ID | Requirement | Verified By |
|-------------|------------|-------------|
| D-072 | Spike verifies headless behavior, hooks, divergence capture, rate limit ceiling | All 8 tests collectively |
| D-077 | No Claude Code implementation before spike GO | This document is a spike spec, not implementation |
| D-075, D-030 | Adapter does not decide completion | G7 -- no test gives completion authority to hook/adapter |
| D-031 | Hook never decides truth | All tests -- hook events are captured as evidence only |
| D-028 | Worker self-report is not completion | DAY0-T004 tests Stop event as evidence, not verdict |
| D-076 | Claude local loop separate from PRAXIS supervisory loop | DAY0-T002, T003, T004 -- PRAXIS observes from outside |
| D-073 | Claude adapter is an external worker bridge | Test design treats adapter as mechanical launcher/capturer |
| D-070 | Primary path is headless + praxis-hook | Entire spike tests this path |
| D-071 | Fallback is Messages API if NO-GO | Fallback Trigger section defines activation |
| D-032 | Truth Engine owns PASS/HOLD/FAIL | No test produces a gate verdict |

---

## Open Questions

1. **Claude Code hook maturity:** At the time of spike execution, what version of Claude Code supports PreToolUse, PostToolUse, and Stop hooks? The spike must document the exact version tested.
2. **Hook performance overhead:** Does hook execution add measurable latency to tool calls? Not a GO/NO-GO criterion, but should be measured and documented for Governor design.
3. **Headless output format:** Is `--print` output structured (JSON) or plain text? If plain text, does it contain enough structure for reliable parsing?
4. **Concurrent session resource model:** What is the per-session memory overhead? This informs the Governor's tier calculations.
5. **Rate limit ceiling for production:** What is the sustainable request rate before rate limits trigger? This informs the Governor's concurrency limits.
6. **Spool replay ordering guarantees:** Does JSONL spool + replay maintain exact event order across sessions? Or is per-session ordering sufficient?
7. **Stop event on crash:** When Claude crashes (SIGKILL, OOM), does a Stop event fire? Or is the absence of a Stop event the only signal?
8. **Hook configuration lifecycle:** Can hooks be configured per-session or only globally? Per-session configuration is required for multi-worker isolation.

---

## Audit Notes

- This spike specification was created as part of the P-1 documentation phase (2026-06-18). It is DRAFT_FOR_AUDIT v0.1.
- The spike itself has NOT been executed. This document is the specification for what must be tested, not a report of results.
- All GO/NO-GO criteria are derived from `docs/decisions.md` decisions D-070 through D-077 and the Three Laws.
- The 8 tests are designed to answer the 4 open decisions O-001 and O-002 from `docs/decisions.md` Section 21.
- `stable_16` is explicitly NOT tested in this spike. DAY0-T006 probes 2/3/4 concurrent sessions. stable_16 is an OPEN hypothesis (ai_summary.md, MVP-C targets stable_3).
- If any test produces ambiguous results (neither clearly pass nor clearly fail), the ambiguity defaults to NO-GO. The burden of proof is on the primary path to demonstrate viability.
- The spike executor must produce a `GO-NOGO-REPORT.md` summarizing all 8 test results, the GO/NO-GO verdict, and the evidence archive location.
