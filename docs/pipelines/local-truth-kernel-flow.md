# Local Truth Kernel Flow

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1 (post-ADR-013 Plugin-First Pivot)
**Canonical decisions:** `docs/decisions.md`
**Authoritative ADR:** `docs/adr/ADR-013-plugin-first-pivot.md`

---

## Purpose

Define the design-only flow for the PRAXIS local Truth Kernel: from task.yaml and evidence input through gate evaluation to verdict and repair packet output.

> **Design-only:** This document describes the kernel's role and flow. Implementation is not authorized.

---

## Truth Kernel Role

The Truth Kernel is the **sole completion authority** in PRAXIS:

- **Reads `.praxis/task.yaml`** for acceptance criteria and evidence requirements
- **Collects evidence** from the workspace (diff, files, command logs, test output)
- **Evaluates three gates** in sequence: EvidenceGate → ExecGate → FinalGate
- **Produces PASS/HOLD/FAIL verdict** (no other component may decide completion)
- **Generates RepairPacket** for HOLD/FAIL outcomes
- **Generates audit report** for the final record

The kernel is agent-agnostic. It works with evidence from any coding agent, not just Claude Code.

---

## Flow Diagram

```
.praxis/task.yaml
       │
       ▼
┌──────────────────────────────────────────┐
│         Evidence Collection               │
│  git diff, changed files, command logs,   │
│  test output, optional hook captures      │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│           EvidenceGate                    │
│  Does evidence exist?                     │
│  - diff not empty?                        │
│  - required files changed?                │
│  - command logs present?                  │
│  - test output parseable?                 │
│                                           │
│  PASS / HOLD / FAIL                       │
└──────────────────┬───────────────────────┘
                   │ (if PASS or HOLD)
                   ▼
┌──────────────────────────────────────────┐
│             ExecGate                      │
│  Did commands/tests actually run?         │
│  - required commands executed?            │
│  - tests ran (count > 0)?                 │
│  - test exit code?                        │
│  - zero-test-ran detection?               │
│                                           │
│  PASS / HOLD / FAIL                       │
└──────────────────┬───────────────────────┘
                   │ (if PASS or HOLD)
                   ▼
┌──────────────────────────────────────────┐
│             FinalGate                     │
│  Do results meet acceptance criteria?     │
│  - human_approved check first             │
│  - evaluate each criterion                │
│  - apply completion_policy                │
│  - agent claims are evidence, not verdict │
│                                           │
│  PASS / HOLD / FAIL                       │
└──────────────────┬───────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
      PASS              HOLD / FAIL
        │                     │
        ▼                     ▼
   Report Gen           RepairPacket Gen
        │                     │
        ▼                     ▼
.praxis/reports/       stdout/file
  <run_id>.md          RepairPacket
```

---

## Evidence Collection

Before gates run, the kernel collects evidence from the workspace:

| Evidence Type | Source | Collection Method |
|---------------|--------|-------------------|
| git diff | git working tree | `git diff --stat` and `git diff` |
| Changed files | git status | `git diff --name-only` |
| Command logs | Shell history or captured output | Read from `.praxis/runs/<id>/commands.jsonl` or provided path |
| Test output | Test runner stdout/stderr | Read from `.praxis/runs/<id>/test-output.txt` or provided path |
| File contents | Workspace files | Read specified files for `file_exists` checks |
| Hook captures (future) | Claude Code hooks | Read from hook spool directory |

**v0.1 approach:** The operator provides evidence paths or the kernel auto-discovers from git and common log locations. No server-based evidence ingestion.

---

## EvidenceGate

### Purpose

Verify that evidence exists. Without evidence, completion cannot be evaluated.

### Checks

| Check | Method | Outcome on Failure |
|-------|--------|--------------------|
| Workspace is a git repo | `git status` | HOLD (cannot collect diff evidence) |
| Git diff is not empty | `git diff --stat` | HOLD if task requires changes |
| Required files exist | `stat` or `ls` | FAIL if acceptance criteria requires file_exists |
| Command logs exist | File check | HOLD (missing execution evidence) |
| Test output exists | File check | HOLD (missing test evidence) |

### Verdict Rules

- **PASS:** Sufficient evidence exists to evaluate all criteria.
- **HOLD:** Some evidence is missing but verification can proceed partially.
- **FAIL:** Critical evidence is missing or evidence contradicts agent claims.

---

## ExecGate

### Purpose

Verify that required commands and tests actually ran and produced meaningful results.

### Checks

| Check | Method | Outcome on Failure |
|-------|--------|--------------------|
| Required commands executed | Parse command log | FAIL if required command not found |
| Tests ran (count > 0) | Parse test output | FAIL (zero tests ran — false-done signal) |
| Test exit code | Parse test output | FAIL if exit code indicates test failure |
| Command exit codes | Parse command log | FAIL if required command exited with error |

### Zero-Test-Ran Detection

ExecGate must detect when:
- Test runner was invoked but found no tests (e.g., "No tests found")
- All tests were skipped (e.g., "3 skipped, 0 passed")
- Test file was empty or had no test functions

Any of these → HOLD or FAIL. Running zero tests is not evidence of passing tests.

### TestOutputParser

The kernel includes a TestOutputParser that handles common test runner formats:

| Runner | Format Example |
|--------|---------------|
| Vitest | `✓ 12 tests passed`, `❌ 2 tests failed` |
| Jest | `Tests: 12 passed, 2 failed, 14 total` |
| Pytest | `12 passed, 2 failed in 1.23s` |
| Go test | `--- PASS: TestHealth (0.00s)`, `FAIL` |

### Verdict Rules

- **PASS:** All required commands executed successfully. Tests ran and passed.
- **HOLD:** Some required commands not executed, or test results ambiguous.
- **FAIL:** Tests failed, commands errored, or zero tests ran.

---

## FinalGate

### Purpose

Evaluate human-authored acceptance criteria against collected evidence.

### Flow

1. Read `.praxis/task.yaml`
2. Check `human_approved` flag. If `false` → FAIL immediately.
3. For each acceptance criterion:
   a. Skip if `human_approved: false` (log warning)
   b. Collect `required_evidence` for this criterion
   c. Execute `verification_method` against evidence
   d. Record criterion verdict (PASS/HOLD/FAIL) with evidence
4. Apply `completion_policy` (`all_criteria` / `any_criteria`)
5. Produce FinalGate verdict

### Agent Claims Are Evidence, Not Verdicts

- Agent self-report ("I completed the task") is treated as evidence input, not as a verdict.
- Agent-generated status messages are recorded but do not influence FinalGate.
- Divergence between agent claims and actual evidence is flagged in the report.

### Verdict Rules

- **PASS:** All required criteria met, evidence supports each claim.
- **HOLD:** Some criteria unverified, or evidence insufficient to confirm.
- **FAIL:** Criteria not met, evidence contradicts claims, or task not human-approved.

---

## Overall Verdict

| EvidenceGate | ExecGate | FinalGate | Overall |
|-------------|----------|-----------|---------|
| PASS | PASS | PASS | **PASS** |
| HOLD | PASS | PASS | HOLD |
| PASS | HOLD | PASS | HOLD |
| PASS | PASS | HOLD | HOLD |
| * | * | FAIL | **FAIL** |
| FAIL | * | * | **FAIL** |
| * | FAIL | * | **FAIL** |

Rule: Any FAIL gate → overall FAIL. Any HOLD without FAIL → overall HOLD. All PASS → overall PASS.

---

## RepairPacket Generation

When overall verdict is HOLD or FAIL, `praxis repair` generates a RepairPacket:

1. Read the last `verdict.json`
2. For each failed criterion, extract ID, description, evidence, and generate suggested fix
3. Assemble RepairPacket with failed criteria, evidence summary, suggested fix order

**RepairPacket MUST NOT:** modify acceptance criteria, change `human_approved` status, add/remove criteria, claim work is done, or override kernel verdict.

---

## Report Generation

`praxis report` generates a Markdown audit report containing: task summary, verdict, criterion-by-criterion results, evidence summary, and repair suggestions.

---

## No Model Authority

The Truth Kernel does not use AI models to decide completion. Gates are deterministic checks: file existence (`stat`/`ls`), test results (parse output), diff contents (`git diff`), command output (execute and compare), grep patterns (text search).

AI models are used by the **agent** to do the work. They are NOT used by the **kernel** to verify the work.

---

## Decision Compliance Checklist

- [x] Kernel reads task.yaml as input (D-139)
- [x] EvidenceGate checks evidence existence
- [x] ExecGate checks command/test execution
- [x] FinalGate checks human-authored criteria
- [x] PASS/HOLD/FAIL produced by kernel only (Law 1)
- [x] RepairPacket generated for HOLD/FAIL
- [x] RepairPacket cannot modify acceptance criteria
- [x] Agent claims are evidence, not verdicts (Law 1)
- [x] Human-authored acceptance criteria required (Law 3)
- [x] No model authority in kernel
- [x] Plugin does not own truth (D-130)
- [x] No implementation authorized
