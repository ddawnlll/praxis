# Evidence to Truth Engine Pipeline

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define how raw evidence flows through the three kernel-owned gates to produce a completion verdict, and how false-done attempts are detected.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This pipeline defines the complete evidence-to-verdict flow: from raw hook events and adapter output, through Evidence Hash Chain construction and validation, to EvidenceGate, ExecGate, and FinalGate evaluation. It is the mechanism that enforces Law 1 (Agent says done is not done; Truth Engine FinalGate PASS is done).

## Scope

- EvidenceRecord creation from hook events, adapter output, git diffs, filesystem observations
- Evidence Hash Chain (EHC) construction and validation
- EvidenceGate: evidence completeness check
- ExecGate: executable criteria check
- FinalGate: human-authored acceptance criteria check
- False-done detection: empty diff, zero tests, agent-only claims, namespace violations
- Gate verdict emission as RuntimeEvents
- Routing HOLD → RIM and FAIL → human review

## Non-Goals

- RIM repair logic (see `docs/pipelines/rim-repair-loop.md`)
- Hook event capture (see `docs/pipelines/praxis-hook-capture.md`)
- ACCP artifact generation (see `docs/pipelines/accp-artifact-pipeline.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| D-028 | Worker self-report is not completion |
| D-029 | UI never decides completion |
| D-030 | Adapter never decides completion |
| D-031 | Hook never decides truth |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL |
| D-033 | EvidenceGate, ExecGate, FinalGate are kernel-owned |
| D-034 | EvidenceRecord and EHC are required |
| D-035 | Agent-generated acceptance criteria are rejected |
| D-036 | Missing human-authored acceptance criteria blocks completion |
| D-105 | False-done tests are mandatory |
| D-106 | Empty diff must not complete |
| D-107 | Zero tests ran must not pass ExecGate |
| D-108 | Namespace violation must fail |

---

## Conceptual Model

```
┌──────────────────────────────────────────────────────────────────┐
│                        TRUTH ENGINE                               │
│                                                                   │
│  Evidence ──► EvidenceGate ──► ExecGate ──► FinalGate ──► VERDICT │
│               "is there        "did output     "did ALL human       │
│               evidence?"       pass tests?"    criteria pass?"     │
│                                                                   │
│  PASS ──► next gate         HOLD ──► RIM repair                   │
│  FAIL ──► terminal          HOLD ──► RIM repair                   │
└──────────────────────────────────────────────────────────────────┘
```

The Truth Engine is the sole completion authority. It receives normalized evidence (EvidenceRecords, EHC chain, adapter output, git diffs) and evaluates it through three sequential gates. No other component — not the adapter, not the UI, not the hook, not the worker itself — produces a completion verdict.

---

## Data Flow

```
Hook Events ──┐
Adapter Output ─┤
Git Diff ───────┼──► EvidenceRecord Creation ──► EHC Chain ──┐
File Changes ──┘                                             │
                                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ EVIDENCEGATE                                                     │
│                                                                  │
│ Checks:                                                          │
│  • Evidence records exist for this attempt                       │
│  • Transcript captured (hook events present)                     │
│  • Diff captured (git diff available)                            │
│  • Test output captured (if task_type includes tests)            │
│  • EHC chain is unbroken (no CONFIRMED break)                    │
│                                                                  │
│ MISSING evidence → HOLD (repair: re-run with expanded capture)   │
│ BROKEN EHC → FAIL (terminal, possible integrity issue)           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ PASS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ EXECGATE                                                         │
│                                                                  │
│ Checks:                                                          │
│  • Diff is non-empty (code task) or content present (docs task)  │
│  • Tests ran (test count > 0 if acceptance criteria require it)  │
│  • Test exit code indicates pass (if applicable)                 │
│  • No namespace violation (worker did not write outside allowed) │
│  • Exit code is reasonable (non-zero with evidence vs crash)     │
│                                                                  │
│ EMPTY diff → FAIL (false done)                                   │
│ ZERO tests ran → FAIL (false done)                               │
│ NAMESPACE violation → FAIL                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ PASS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ FINALGATE                                                        │
│                                                                  │
│ Checks:                                                          │
│  • ALL human-authored acceptance criteria evaluated against      │
│    evidence                                                      │
│  • Each criterion checked:                                       │
│    - file_exists: file actually present in diff                  │
│    - test_passes: test output shows pass                         │
│    - command_output: command stdout matches expected             │
│    - diff_contains: diff includes expected string                │
│    - no_diff_contains: diff does NOT include forbidden string    │
│  • criteria_source is 'human' (verified at PSAG, re-checked)    │
│                                                                  │
│ ALL required criteria PASS → FinalGate PASS → COMPLETE           │
│ ANY criterion FAIL → HOLD or FAIL                                │
│ MISSING acceptance criteria → FAIL                               │
│ GENERATED criteria present → FAIL                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Role | Must NOT |
|-----------|------|----------|
| **Hook** | Capture raw tool events, produce minimal JSON | Evaluate truth, filter events |
| **Adapter** | Normalize worker output into AttemptManifest | Produce gate verdict |
| **Evidence** | Create EvidenceRecords, maintain EHC chain | Decide which evidence is sufficient |
| **EvidenceGate** | Check evidence completeness and integrity | Evaluate test results |
| **ExecGate** | Check executable criteria (diff, tests, namespace) | Evaluate human-authored criteria |
| **FinalGate** | Evaluate ALL human acceptance criteria | Accept agent-generated criteria |
| **Truth Engine** | Orchestrate gates, emit final verdict | Delegate to adapter/UI/worker |

---

## MUST / MUST NOT Rules

### MUST

- EvidenceGate MUST check for evidence completeness before ExecGate runs
- ExecGate MUST reject empty diffs when the task required code changes
- ExecGate MUST reject zero tests ran when acceptance criteria include test expectations
- FinalGate MUST evaluate all required acceptance criteria
- FinalGate MUST fail if any required criterion cannot be verified
- Each gate MUST emit a GateVerdict event (PASS/HOLD/FAIL) to the event log
- Gate verdicts MUST reference the evidence records they evaluated

### MUST NOT

- Workers MUST NOT self-report completion (their exit code and claims are evidence, not verdict)
- Adapters MUST NOT produce gate verdicts
- Hooks MUST NOT evaluate truth of captured events
- UI MUST NOT override, reinterpret, or create gate verdicts
- FinalGate MUST NOT accept agent-generated acceptance criteria
- ExecGate MUST NOT pass an attempt with zero test executions when tests are required
- EHC break resolution MUST NOT skip without classification

---

## Failure Modes

| Failure | Detection | Verdict | Next Step |
|---------|-----------|---------|-----------|
| Empty diff (no changes made) | ExecGate: diff is empty | FAIL | RIM: context_expand or scope_narrow |
| Zero tests ran | ExecGate: test_count = 0 | FAIL | RIM: tool_restrict (force test run) |
| Agent claim without evidence | EvidenceGate: no transcript | HOLD | RIM: initial (re-run with capture) |
| Namespace violation (wrote outside allowed) | ExecGate: changed_files ∩ allowed_paths | FAIL | RIM: scope_narrow + tool_restrict |
| EHC single break | EvidenceGate: chain_hash mismatch | NOISE → PASS | Logged, attempt proceeds |
| EHC multiple breaks | EvidenceGate: pattern detected | SUSPECTED → HOLD | RIM + flag for review |
| EHC systematic break | EvidenceGate: CONFIRMED | FAIL + CB OPEN | Circuit Breaker triggered |
| Missing acceptance criteria | FinalGate: no criteria to evaluate | FAIL | PSAG should have rejected; human fix |
| Generated criteria present | FinalGate: criteria_source ≠ 'human' | FAIL | PSAG should have rejected; human fix |
| Verification detail mismatch | FinalGate: criterion not met | HOLD/FAIL | RIM: target specific criterion |

---

## Test/Gate Implications

- **False-done tests**: P3 must include tests for empty diff, zero tests, agent-only claims
- **Gate sequence tests**: EvidenceGate must pass before ExecGate; ExecGate before FinalGate
- **EHC break tests**: NOISE, SUSPECTED, CONFIRMED classifications with mock evidence
- **Namespace violation tests**: worker writes outside allowed_paths → caught
- **Acceptance criteria tests**: all 5 verification_types tested with success and failure cases
- **Circuit Breaker integration**: CONFIRMED EHC break → CB OPEN tested

---

## Decision Compliance Checklist

| Decision | Requirement | Compliant? |
|----------|-------------|------------|
| D-032 | Truth Engine owns PASS/HOLD/FAIL | Yes — all gates are kernel-owned |
| D-033 | Gates are kernel-owned | Yes — gates live in Truth Engine, not server/adapters |
| D-028 | Worker self-report not completion | Yes — worker output is evidence only |
| D-030 | Adapter never decides completion | Yes — adapter normalizes, does not evaluate |
| D-031 | Hook never decides truth | Yes — hook captures raw events |
| D-035 | Agent-generated criteria rejected | Yes — FinalGate and PSAG reject 'generated' |
| D-106 | Empty diff must not complete | Yes — ExecGate rejects empty diff |
| D-107 | Zero tests ran must not pass | Yes — ExecGate checks test count |
| D-108 | Namespace violation must fail | Yes — ExecGate checks namespace |

---

## Open Questions

- Exact test output format parsing (TestOutputParser regex patterns) — depends on test runner (vitest, jest, pytest)
- Threshold for EHC SUSPECTED vs CONFIRMED classification
- How many consecutive EHC breaks constitute CONFIRMED?
- Should FinalGate support partial criteria pass (some required, some optional) beyond required:boolean?

## Audit Notes

- This pipeline enforces Law 1 (Completion Authority) and Law 3 (Verification Authority)
- The three-gate design prevents single-point evaluation failures
- False-done detection is mandatory, not optional — PRAXIS must be skeptical of worker output
- All gate verdicts are immutable once emitted and appended to event log
