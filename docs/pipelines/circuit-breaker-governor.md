> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** Circuit Breaker and Governor are FUTURE scope for v0.1. v0.1 uses manual `/praxis:verify` with no automated admission loop or concurrency control. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# Circuit Breaker and Governor Pipeline

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the interaction between the Circuit Breaker (system-level safety authority) and the Governor (concurrency authority), including state machines, triggers, and how they protect PRAXIS from cascading failures.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

The Circuit Breaker and Governor are two separate kernel-owned safety components that protect PRAXIS at different levels. The Circuit Breaker is a system-wide safety switch — it stops all new work when the system is unsafe. The Governor manages concurrency — it determines how many workers can safely run. Together they prevent PRAXIS from amplifying failures through parallel execution.

## Scope

- Circuit Breaker state machine (CLOSED → OPEN → HALF_OPEN → CLOSED)
- Circuit Breaker triggers and reset conditions
- Governor concurrency tiers and promotion/demotion rules
- Governor state machine (GREEN/YELLOW/RED)
- How Governor RED feeds into Circuit Breaker OPEN
- UI visibility of both components
- Distinction from Truth Engine

## Non-Goals

- Truth Engine gate evaluation (see `docs/pipelines/evidence-to-truth-engine.md`)
- Evidence Hash Chain details (see `docs/contracts/evidence-record.contract.md`)
- Worker lifecycle management

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| D-084 | Circuit Breaker is kernel-owned |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN |
| D-086 | Circuit Breaker answers: is the system safe enough to admit work? |
| D-087 | Governor answers: how many workers can safely run? |
| D-088 | Truth Engine answers: is this attempt complete? |
| D-089 | Circuit Breaker implementation belongs in kernel/circuit-breaker |
| D-090 | Circuit Breaker should not be delayed to production hardening |

---

## Three Authorities — Distinct Questions

| Authority | Question It Answers | What It Controls | Kernel Module |
|-----------|--------------------|--------------------|---------------|
| **Truth Engine** | Is this attempt complete? | PASS/HOLD/FAIL per attempt | `kernel/truth-engine` |
| **Governor** | How many workers can safely run? | Concurrency tier (3-16 workers) | `kernel/governor` |
| **Circuit Breaker** | Is the whole system safe enough to admit work? | Admission of new attempts (YES/NO) | `kernel/circuit-breaker` |

Key insight: Truth Engine evaluates per-attempt. Governor manages capacity. Circuit Breaker protects the entire system. They answer different questions, live in different kernel modules, and must not be conflated.

---

## Circuit Breaker State Machine

```
                    ┌──────────┐
                    │  CLOSED  │ ◄── Normal operation
                    └────┬─────┘     Admit all work
                         │
                         │ TRIGGER:
                         │ • failure_rate > 30% in 10min
                         │ • governor_RED > 15min
                         │ • EHC CONFIRMED break
                         │
                         ▼
                    ┌──────────┐
                    │   OPEN   │ ◄── System unsafe
                    └────┬─────┘     Reject ALL new admissions
                         │           Running attempts may complete
                         │           No new repair attempts
                         │
                         │ COOLDOWN:
                         │ • Configurable period (suggest 5min)
                         │ • Metrics stabilize below threshold
                         │
                         ▼
                    ┌───────────┐
                    │ HALF_OPEN │ ◄── Probing recovery
                    └─────┬─────┘     Admit EXACTLY ONE probe attempt
                          │
                          │ PROBE RESULT:
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
         ┌──────────┐           ┌──────────┐
         │  CLOSED  │           │   OPEN   │
         │ (probe   │           │ (probe   │
         │  passed) │           │  failed) │
         └──────────┘           └──────────┘
```

### Trigger Details

**Trigger 1: failure_rate > 30% in 10-minute sliding window**
- Monitors: ratio of FAIL + HOLD to total verdicts in the last 10 minutes
- Threshold: > 30% failure rate
- Rationale: If more than 30% of attempts are failing, something is systemically wrong

**Trigger 2: governor_RED continuous > 15 minutes**
- Monitors: Governor state
- Threshold: RED state sustained for 15 minutes
- Rationale: Sustained RED means workers are consistently failing — system needs protection

**Trigger 3: EHC break classified as CONFIRMED**
- Monitors: Evidence Hash Chain break classifier
- Threshold: CONFIRMED (systematic pattern of hash chain breaks)
- Rationale: Confirmed evidence integrity failure means we cannot trust captured evidence

### HALF_OPEN Probe Rules

- Exactly ONE probe attempt is admitted
- The probe is a real task (not a synthetic test)
- If probe passes all gates → CLOSED (system recovered)
- If probe fails any gate → OPEN (system still unsafe)
- Probe failure increments a consecutive probe failure counter
- After N consecutive probe failures (suggest N=3), require human intervention

---

## Governor Concurrency Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        GOVERNOR TIERS                            │
│                                                                   │
│  stable_16  │  ████████████████  │ Aspirational ceiling            │
│             │                    │ (hypothesis; only stable_3 is   │
│             │                    │  proven for MVP)                │
│  stable_12  │  ████████████      │ stable_6 + 48h clean           │
│  stable_8   │  ████████          │ stable_3 + 48h clean           │
│  stable_6   │  ██████            │ stable_3 + 48h clean           │
│  stable_3   │  ███               │ Initial tier (48h clean)       │
│             │                    │                                 │
│  DEMOTED    │  ▼  Immediate on instability                       │
└─────────────────────────────────────────────────────────────────┘
```

### Governor States

| State | Meaning | Action |
|-------|---------|--------|
| **GREEN** | Healthy | Normal operation; tier promotion eligible after 48h clean |
| **YELLOW** | Warning | Elevated failure rate or rate limit signals; monitor closely; no promotion |
| **RED** | Danger | High failure rate; may trigger Circuit Breaker if sustained > 15min; no promotion; consider demotion |

### Promotion Rules

- 48 hours of consecutive clean operation at current tier
- "Clean" = no FAIL verdicts, no rate limit signals, no worker crashes
- After stable_12 → stable_16 requires architecture review (human approval). Note: stable_16 is an OPEN hypothesis; only stable_3 is proven for MVP.

### Demotion Rules

- Immediate on: sustained RED, multiple worker crashes in window, rate limit storms
- Demotion drops to next lower tier (not to stable_3)
- Demoted tier must re-earn 48h clean operation to promote again

---

## Interaction: Governor RED → Circuit Breaker OPEN

```
Governor GREEN ──────────────────────────────────────────► Normal
    │
    │ Failure rate rises, rate limits increase
    ▼
Governor YELLOW ─────────────────────────────────────────► Warning
    │
    │ Sustained failure, no recovery
    ▼
Governor RED ────────────────────────────────────────────► Danger
    │
    │ 15 minutes continuous RED
    ▼
Circuit Breaker OPEN ────────────────────────────────────► System locked
    │
    │ Cooldown + metrics recover
    ▼
Circuit Breaker HALF_OPEN ───────────────────────────────► Probe
    │
    │ Probe passes
    ▼
Circuit Breaker CLOSED ──────────────────────────────────► Recovery
Governor GREEN
```

This cascading protection ensures that per-worker issues (Governor RED) escalate to system-wide protection (Circuit Breaker OPEN) if they persist.

---

## UI Visibility

Both Circuit Breaker and Governor state must be visible in Desktop Mission Control:

| Component | What UI Shows |
|-----------|---------------|
| Circuit Breaker | Current state (CLOSED/OPEN/HALF_OPEN), trigger reason, time in current state, failure rate window, probe status |
| Governor | Current tier, active workers, state (GREEN/YELLOW/RED), clean operation hours, last promotion/demotion, failure rate |

---

## MUST / MUST NOT Rules

### MUST

- Circuit Breaker MUST be kernel-owned (not server, not UI)
- Circuit Breaker OPEN MUST reject ALL new task admissions
- Circuit Breaker HALF_OPEN MUST permit exactly ONE probe attempt
- Governor MUST control concurrency independently of Truth Engine
- Governor RED sustained > 15 minutes MUST trigger Circuit Breaker
- Both CB and Governor state MUST be visible in Mission Control
- Circuit Breaker MUST be implemented in P3 (kernel safety core), not deferred to P6

### MUST NOT

- Circuit Breaker MUST NOT decide attempt completion (Truth Engine does)
- Governor MUST NOT decide attempt completion (Truth Engine does)
- UI MUST NOT override Circuit Breaker state without human action
- Governor MUST NOT control truth
- Circuit Breaker OPEN MUST NOT abort already-running attempts (those complete naturally)

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| CB stuck OPEN | No recovery after cooldown + probe attempts | Human escalation |
| CB false OPEN | Trigger fires on transient spike | HALF_OPEN probe detects; returns to CLOSED if probe passes |
| Governor false RED | Brief spike triggers RED | 15min sustained requirement prevents false trigger |
| Governor stuck at low tier | No promotion despite clean operation | Human investigation; possible metrics bug |
| CB trigger race condition | Multiple triggers fire simultaneously | First trigger wins; subsequent triggers are redundant |

---

## Test/Gate Implications

- Test: CB CLOSED → OPEN on failure_rate > 30%
- Test: CB OPEN → HALF_OPEN after cooldown
- Test: CB HALF_OPEN → CLOSED on probe pass
- Test: CB HALF_OPEN → OPEN on probe fail
- Test: Governor promotion after 48h clean (time-accelerated in test)
- Test: Governor RED → CB OPEN after 15min (time-accelerated)
- Test: CB OPEN rejects PSAG admission
- Test: CB HALF_OPEN admits exactly 1 attempt, blocks 2nd
- Test: Governor demotion on sustained failure

---

## Decision Compliance Checklist

| Decision | Requirement | Compliant? |
|----------|-------------|------------|
| D-084 | CB is kernel-owned | Yes — lives in kernel/circuit-breaker |
| D-085 | CB states: CLOSED, OPEN, HALF_OPEN | Yes |
| D-086 | CB answers: is system safe? | Yes — system-level admission control |
| D-087 | Governor answers: how many workers? | Yes — concurrency tier management |
| D-088 | Truth Engine answers: is attempt complete? | Yes — distinct from CB and Governor |
| D-089 | Implementation in kernel/circuit-breaker | Yes |
| D-090 | CB not delayed to P6 | Yes — implemented in P3 |

---

## Open Questions

- Exact cooldown duration (suggest 5 minutes, but may need tuning)
- Consecutive probe failure threshold for human escalation
- Should CB track per-worker-type metrics (Claude vs OpenCode vs local)?
- Should Governor tier limits differ by worker type?
- How to handle CB state persistence across server restart?

## Audit Notes

- The three-authority distinction (Truth Engine / Governor / Circuit Breaker) is critical to prevent conflation
- Circuit Breaker is a system-level safety component — it must not be treated as a UI feature or deferred to production hardening
- Governor tier model with 48h clean operation windows is conservative by design — PRAXIS should be cautious about parallelism
