# Autonomous Loop Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the two-layer autonomous execution model where Claude's local loop runs independently and PRAXIS's supervisory loop controls admission, verification, repair, and safety.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

PRAXIS uses a two-layer autonomous model. This document defines the separation between the Claude local loop (agent self-directed tool use) and the PRAXIS supervisory loop (attempt lifecycle, evidence, gates, repair, safety). The layers are independent — PRAXIS does not intercept Claude's internal decision-making; it supervises from the outside via hooks and evidence capture.

## Scope

- Two-layer model architecture
- Claude local loop: what it does, what PRAXIS does not control
- PRAXIS supervisory loop: admission, execution, evidence, gates, repair, assembly
- RIM retry loop within the supervisory loop
- Circuit Breaker admission control loop
- Governor concurrency adjustment loop
- Human action loop for escalation
- Loop interaction points

## Non-Goals

- Claude Code internals (Claude's tool-use loop is Claude's responsibility)
- Detailed gate logic (see `docs/pipelines/evidence-to-truth-engine.md`)
- RIM strategy details (see `docs/pipelines/rim-repair-loop.md`)
- Hook implementation (see `docs/pipelines/praxis-hook-capture.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| D-076 | Claude local loop is separate from PRAXIS supervisory loop |
| D-078 | Use two-layer autonomous model |
| D-079 | Claude local loop uses tools, edits files, runs commands, stops |
| D-080 | PRAXIS supervisory loop admits, captures evidence, runs gates, dispatches repair, controls safety |
| D-081 | RIM starts only after HOLD/FAIL gate outcomes |
| D-082 | Circuit Breaker can stop new admissions |
| D-083 | Governor controls concurrency, not truth |
| D-086 | Circuit Breaker answers: is system safe enough to admit work? |
| D-087 | Governor answers: how many workers can safely run? |
| D-088 | Truth Engine answers: is this attempt complete? |

---

## Conceptual Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     TWO-LAYER AUTONOMOUS MODEL                    │
│                                                                   │
│  ╔═════════════════════════════════════════════════════════════╗ │
│  ║  LAYER 1: CLAUDE LOCAL LOOP (independent)                  ║ │
│  ║                                                             ║ │
│  ║  Receive prompt → Think → Use tool → Get result → Think    ║ │
│  ║  → Edit file → Run command → Check output → Think          ║ │
│  ║  → Report done → STOP                                       ║ │
│  ║                                                             ║ │
│  ║  PRAXIS does NOT intercept this loop.                      ║ │
│  ║  PRAXIS OBSERVES via hooks (PreToolUse/PostToolUse/Stop).  ║ │
│  ╚═════════════════════════════════════╤═══════════════════════╝ │
│                                        │                          │
│                    Hook events + process output                   │
│                                        │                          │
│  ╔═════════════════════════════════════╧═══════════════════════╗ │
│  ║  LAYER 2: PRAXIS SUPERVISORY LOOP                          ║ │
│  ║                                                             ║ │
│  ║  ┌──────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐ ║ │
│  ║  │ADMIT ├──►│ EXECUTE  ├──►│ CAPTURE  ├──►│  VERIFY     │ ║ │
│  ║  │PSAG  │   │Workspace │   │Evidence  │   │Truth Engine │ ║ │
│  ║  └──────┘   │+Adapter  │   │+EHC      │   │3 Gates      │ ║ │
│  ║             └──────────┘   └──────────┘   └──┬───┬───┬──┘ ║ │
│  ║                                               │   │   │    ║ │
│  ║              ┌────────────────────────────────┘   │   │    ║ │
│  ║              │ PASS                    ┌──────────┘   │    ║ │
│  ║              ▼                         │ HOLD     ┌───┘    ║ │
│  ║     ┌──────────────┐          ┌───────┴──────┐   │ FAIL   ║ │
│  ║     │  ASSEMBLER   │          │     RIM      │   ▼        ║ │
│  ║     │  (after wave)│          │ Repair Loop  │ HUMAN      ║ │
│  ║     └──────────────┘          │ (max 7 retry)│ REVIEW     ║ │
│  ║                               └──────────────┘            ║ │
│  ║                                                             ║ │
│  ║  ┌─────────────────────────────────────────────────────┐   ║ │
│  ║  │ SAFETY OVERLAYS (run continuously)                  │   ║ │
│  ║  │  • Circuit Breaker: CLOSED/OPEN/HALF_OPEN          │   ║ │
│  ║  │  • Governor: stable_3/6/8/12/16, GREEN/YELLOW/RED  │   ║ │
│  ║  │  • Human Action Queue: escalated decisions          │   ║ │
│  ║  └─────────────────────────────────────────────────────┘   ║ │
│  ╚═════════════════════════════════════════════════════════════╝ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Claude Local Loop

The Claude local loop is Claude Code's internal tool-use cycle. PRAXIS has no visibility into Claude's internal reasoning or decision-making.

**What Claude does:**
- Receives the prompt prepared by the adapter
- Uses tools (Read, Write, Edit, Bash, etc.) within the workspace
- Edits files within allowed namespace
- Runs commands (tests, linters, builds)
- Checks output, iterates
- Reports completion status (exit code, final message)

**What PRAXIS does NOT control:**
- Which tools Claude calls and in what order
- Claude's internal reasoning about whether work is complete
- Claude's self-assessment of success

**What PRAXIS observes (via hooks):**
- PreToolUse events: tool name, input arguments
- PostToolUse events: tool output, result
- Stop event: session ending
- Process output: stdout, stderr, exit code
- Git diff: files changed in workspace

Claude's self-reported "done" is treated as a claim (evidence), not a verdict.

---

## Layer 2: PRAXIS Supervisory Loop

### Admission (PSAG)

PSAG validates the PlanSpec before any work starts:
- Schema validation
- Namespace collision detection
- Budget validation
- Dependency graph integrity
- acceptance_criteria source = 'human' (REJECT if 'generated')
- At least one required acceptance criterion per task

### Execution (Workspace + Adapter)

- Workspace is initialized with isolated directory
- Adapter launches worker (Claude Code, mock, etc.) with prepared config
- Worker runs within namespace constraints
- Adapter captures output regardless of worker outcome

### Capture (Evidence)

- Hook events are normalized into EvidenceRecords
- Git diff is captured
- Process output (stdout/stderr) is captured
- EHC chain is built (sha256 chaining)
- EHC break classification runs (NOISE/SUSPECTED/CONFIRMED)

### Verify (Truth Engine)

- EvidenceGate: is evidence complete and intact?
- ExecGate: did executable output meet criteria?
- FinalGate: did ALL human-authored acceptance criteria pass?

Verdict routing:
- **PASS**: TaskRun → COMPLETE; if all wave tasks pass → Assembler
- **HOLD**: TaskRun → REPAIR; RIM generates RepairPacket; new attempt queued
- **FAIL**: TaskRun → FAILED; human review required

### RIM Retry Loop

Triggered by HOLD/FAIL, runs within the supervisory loop:
- Extract FailureSignature from GateVerdict
- Generate RepairPacket with appropriate strategy
- Create new attempt with strategy context
- Max 7 attempts per task; attempt 7 → ABORT
- See `docs/pipelines/rim-repair-loop.md`

### Circuit Breaker Admission Control

Circuit Breaker runs continuously alongside the supervisory loop:
- **CLOSED**: Normal operation, admit new attempts
- **OPEN**: Reject ALL new admissions (running attempts may complete)
- **HALF_OPEN**: Admit exactly ONE probe attempt

OPEN triggers:
- failure_rate > 30% in 10-minute sliding window
- Governor RED state sustained > 15 minutes
- EHC break classified as CONFIRMED

See `docs/pipelines/circuit-breaker-governor.md`

### Governor Concurrency Loop

Governor adjusts worker concurrency based on stability metrics:
- Monitors failure rate, rate limit signals, clean operation hours
- Promotes tier after 48h clean operation
- Demotes immediately on sustained issues
- GREEN → YELLOW → RED → Circuit Breaker OPEN

### Human Action Loop

Certain outcomes create human_action items visible in Desktop Mission Control:
- FAIL verdicts (terminal — needs human decision)
- ABORTED task runs (max repair attempts exhausted)
- Circuit Breaker OPEN (needs human investigation)
- Conflict Reports from Assembler (needs human resolution strategy)

---

## Loop Interaction Points

```
Claude Local Loop (internal)         PRAXIS Supervisory Loop
─────────────────────────            ─────────────────────────
                                     │
Tool call initiated ──► hook ──────► EvidenceRecord created
                                     │
Tool result received ◄── (no intercept)
                                     │
Claude reports "done" ──► Stop hook ► worker_reported_status (claim)
                                     │
                                     ▼
                              Truth Engine evaluates
                              (ignores Claude's "done" claim)
                                     │
                                     ▼
                              PASS / HOLD / FAIL
```

Key principle: Claude's self-report and the hook output arrive in PRAXIS as evidence. PRAXIS independently evaluates whether the work is actually complete through the gate pipeline.

---

## MUST / MUST NOT Rules

### MUST

- PRAXIS supervisory loop MUST run admission through PSAG before any worker starts
- Hooks MUST capture all tool events without filtering or interpreting
- Evidence MUST be captured independently of worker self-report
- Truth Engine MUST evaluate all three gates in sequence for every attempt
- Circuit Breaker MUST prevent new admissions when OPEN
- Governor MUST enforce concurrency limits

### MUST NOT

- PRAXIS MUST NOT intercept or modify Claude's internal tool-use loop
- Claude's "done" message MUST NOT bypass Truth Engine gates
- Adapter MUST NOT skip evidence capture when worker reports success
- Supervisor MUST NOT treat worker exit code 0 as completion
- RIM MUST NOT start on PASS outcomes

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Worker self-reports done, no evidence | EvidenceGate: empty records | HOLD → RIM |
| Worker produces output but all gates FAIL | FinalGate: criteria not met | FAIL → human review |
| Repeated HOLDs on same task | Attempt counter > threshold | Escalate strategy, then ABORT |
| Circuit Breaker OPEN during run | Admission check | Running attempts continue; no new ones |
| Governor RED sustained | Governor state tracking | After 15min → CB OPEN |
| Human action queue overflow | Queue monitoring | Alert in desktop; prioritize |

---

## Test/Gate Implications

- Mock two-layer model with mock worker in P2
- Test: worker self-reports done, but diff is empty → HOLD/FAIL (not COMPLETE)
- Test: valid output passes all gates → COMPLETE
- Test: CB OPEN rejects new admission; running tasks complete
- Test: RIM retry loop reaches max attempts → ABORT
- Test: Human action created on FAIL verdict

---

## Decision Compliance Checklist

| Decision | Requirement | Compliant? |
|----------|-------------|------------|
| D-076 | Claude local loop separate from PRAXIS supervisory loop | Yes |
| D-078 | Two-layer autonomous model | Yes |
| D-080 | Supervisory loop admits, captures, verifies, repairs, controls safety | Yes |
| D-081 | RIM starts only after HOLD/FAIL | Yes |
| D-082 | CB can stop new admissions | Yes |
| D-083 | Governor controls concurrency, not truth | Yes |
| D-029 | UI never decides completion | Yes — UI observes supervisory loop |

---

## Open Questions

- What is the optimal cooldown period before HALF_OPEN probe?
- Should human be able to force CB CLOSED (override OPEN)?
- How to handle wave-in-progress when CB opens mid-wave?
- Should RIM strategies adapt based on failure patterns across tasks?

## Audit Notes

- The two-layer model is the foundation of PRAXIS safety: Claude operates freely, PRAXIS verifies independently
- No single component bridges both layers — the boundary is the hook/adapter interface
- This design prevents PRAXIS from becoming a Claude wrapper; it is a supervisor
