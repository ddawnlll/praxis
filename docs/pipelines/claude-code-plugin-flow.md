# Claude Code Plugin Flow

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Canonical decisions:** `docs/decisions.md`
**Authoritative ADR:** `docs/adr/ADR-013-plugin-first-pivot.md`

---

## Purpose

Define the design-only flow for the Claude Code plugin as the first PRAXIS UX/integration layer. The plugin exposes slash commands that call the praxis CLI. It is a bridge, not the product core.

> **Design-only:** This document describes the plugin's role and flow. Implementation is not authorized.

---

## Claude Code Plugin Role

The Claude Code plugin is a **thin presentation layer** between the Claude Code user and the local PRAXIS Truth Kernel:

- **Exposes slash commands** that Claude Code users can invoke
- **Calls the praxis CLI** with appropriate arguments
- **Displays CLI output** to the user (verdicts, repair packets, reports)
- **Does NOT own truth logic** — all decisions are made by the kernel
- **Does NOT decide completion** — the kernel produces PASS/HOLD/FAIL
- **Does NOT modify evidence** — it passes evidence paths to the kernel

---

## Flow Diagram

```
Claude Code Session
├─ /praxis:init        → praxis init
├─ /praxis:spec        → praxis spec
├─ /praxis:verify      → praxis verify --task .praxis/task.yaml --workspace .
├─ /praxis:repair      → praxis repair --last-run
├─ /praxis:status      → praxis status
└─ /praxis:report      → praxis report
        │
        ▼
   praxis CLI
        │
        ▼
  local Truth Kernel
  (.praxis/task.yaml + evidence → gates → verdict)
```

---

## Slash Commands

### /praxis:init

**Purpose:** Initialize the PRAXIS workspace.

**Calls:** `praxis init`

**Creates:** `.praxis/` directory, `task.yaml` skeleton, `runs/`, `reports/`.

**Plugin behavior:** Execute `praxis init`, display output, confirm structure created.

### /praxis:spec

**Purpose:** Help draft a task specification. Agent can suggest criteria, but human must approve.

**Calls:** `praxis spec` with options: `--description`, `--workspace`, `--namespace`, `--commands`.

**Plugin behavior:** Execute `praxis spec`, display drafted task.yaml summary, warn that human approval is required. Must NOT set `human_approved: true` automatically.

### /praxis:verify

**Purpose:** Run the Truth Kernel gates against the current workspace evidence.

**Calls:** `praxis verify --task .praxis/task.yaml --workspace .`

**Plugin behavior:** Execute `praxis verify`, display verdict (PASS=green, HOLD=yellow, FAIL=red), show gate-by-gate results, list failed criteria, suggest `/praxis:repair` if HOLD/FAIL.

### /praxis:repair

**Purpose:** Generate a constrained repair packet from failed criteria.

**Calls:** `praxis repair --last-run`

**Plugin behavior:** Execute `praxis repair`, display RepairPacket with failed criteria and suggested fixes, remind user that RepairPacket does not modify acceptance criteria.

### /praxis:status

**Purpose:** Show current task state at a glance.

**Calls:** `praxis status`

**Plugin behavior:** Execute `praxis status`, display task ID, title, last verdict, evidence count, failed criteria, next action.

### /praxis:report

**Purpose:** Generate a final audit report.

**Calls:** `praxis report`

**Plugin behavior:** Execute `praxis report`, display report path, optionally show summary inline.

---

## Manual v0.1 Flow

```
┌─────────────────────────────────────────────────┐
│ 1. Operator: /praxis:init                        │
│    → .praxis/ workspace created                  │
├─────────────────────────────────────────────────┤
│ 2. Operator: /praxis:spec                        │
│    → Agent drafts task.yaml                      │
│    → Human reviews and approves                  │
├─────────────────────────────────────────────────┤
│ 3. Agent does work (Claude Code independently)   │
│    → Writes code, runs tests                     │
│    → PRAXIS NOT involved in this step (v0.1)     │
├─────────────────────────────────────────────────┤
│ 4. Operator: /praxis:verify                      │
│    → CLI collects evidence                       │
│    → Kernel runs gates                           │
│    → Verdict: PASS / HOLD / FAIL                 │
├─────────────────────────────────────────────────┤
│ 5a. If PASS: /praxis:report                      │
│     → Audit report generated                     │
├─────────────────────────────────────────────────┤
│ 5b. If HOLD/FAIL: /praxis:repair                 │
│     → RepairPacket generated                     │
│     → Operator gives repair packet to agent       │
│     → Agent fixes issues (step 3 again)          │
│     → Operator: /praxis:verify (step 4 again)    │
└─────────────────────────────────────────────────┘
```

---

## Hook Capture (Optional / Future)

In v0.2+, the plugin may optionally capture evidence via Claude Code hooks:

- **PreToolUse hook:** Capture tool name and input before execution
- **PostToolUse hook:** Capture tool output after execution
- **Stop hook:** Capture session end and agent-reported completion status

**v0.1 position:** Hooks are NOT required. Manual evidence collection (git diff, command logs, test output files) is sufficient. Hook integration is a future enhancement.

---

## v0.2 / v0.3 Future Automation

- Automatic Stop hook verification after Claude Code finishes
- Automatic repair dispatch on HOLD/FAIL
- Evidence capture via PreToolUse/PostToolUse hooks
- Real-time gate feed as evidence arrives
- Multi-session evidence accumulation

These are future hypotheses, not v0.1 guarantees (D-147, D-148: OPEN).

---

## Plugin Does NOT Own Truth

The Claude Code plugin is explicitly prohibited from:

- Deciding PASS/HOLD/FAIL (kernel owns this)
- Modifying evidence before passing to kernel
- Filtering or interpreting gate results
- Setting `human_approved` on acceptance criteria
- Overriding kernel verdicts
- Claiming completion on behalf of the agent

The plugin displays what the kernel produces. It is a view, not an authority.

---

## Failure Modes

| Failure | Plugin Behavior |
|---------|-----------------|
| praxis CLI not installed | Display error: "praxis CLI not found. Install PRAXIS first." |
| `.praxis/task.yaml` missing | Display error on verify/repair: "No task spec. Run /praxis:init and /praxis:spec first." |
| task.yaml not human-approved | Display warning on verify: "Task not human-approved. FinalGate will fail." |
| Evidence directory empty | EvidenceGate returns HOLD; plugin displays "No evidence found." |
| CLI returns non-zero exit | Display CLI stderr; suggest checking `.praxis/` structure |

---

## Decision Compliance Checklist

- [x] Plugin exposes six slash commands (D-141)
- [x] Plugin calls praxis CLI (D-129)
- [x] Plugin does not own truth logic (D-130)
- [x] Plugin is a bridge, not the product core (D-129, D-130)
- [x] Manual verify/repair first (D-132, D-133)
- [x] Automatic hooks are future (D-147, D-148)
- [x] No implementation authorized
- [x] PRAXIS is not described as "only a Claude Code plugin"
