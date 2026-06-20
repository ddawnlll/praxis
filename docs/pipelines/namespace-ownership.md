> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** Namespace ownership and multi-worker isolation are FUTURE scope for v0.1. v0.1 is single-session manual verification. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# Namespace Ownership Pipeline

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define namespace ownership rules, file write constraints, and violation detection that enforce Law 2 (no worker writes shared integration files).

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

Every file in a PRAXIS workspace has exactly one owner per wave — the task that may write to it. Namespace ownership prevents workers from conflicting on shared files and enforces that only the Deterministic Assembler may write integration files.

## Scope

- Namespace ownership rules per wave
- Allowed vs forbidden path categories
- Shared integration file handling
- PredictedInterface for cross-task contracts
- Namespace violation detection
- PSAG namespace checks

## Non-Goals

- Assembler merge logic (see `docs/pipelines/deterministic-assembler.md`)
- Workspace setup (see `docs/pipelines/taskrun-lifecycle.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| Law 2 | No worker writes shared integration files; Assembler is only shared writer |
| D-108 | Namespace violation must fail |
| D-019 | lib/contracts is shared foundation, no business logic |

---

## Conceptual Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    NAMESPACE PARTITION (per wave)                 │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │    Task A        │  │    Task B        │  │    Task C     │  │
│  │                  │  │                  │  │               │  │
│  │  Owns:           │  │  Owns:           │  │  Owns:        │  │
│  │  src/auth/*      │  │  src/db/*        │  │  tests/auth/* │  │
│  │  tests/auth/*    │  │  tests/db/*      │  │               │  │
│  │                  │  │                  │  │               │  │
│  │  May WRITE:      │  │  May WRITE:      │  │  May WRITE:   │  │
│  │  src/auth/*      │  │  src/db/*        │  │  tests/auth/* │  │
│  │  tests/auth/*    │  │  tests/db/*      │  │               │  │
│  │                  │  │                  │  │               │  │
│  │  May READ:       │  │  May READ:       │  │  May READ:    │  │
│  │  src/auth/*      │  │  src/db/*        │  │  tests/auth/* │  │
│  │  src/db/* (read) │  │  src/auth/* (rd) │  │  src/auth/*   │  │
│  │  lib/contracts   │  │  lib/contracts   │  │  lib/contracts │  │
│  └──────────────────┘  └──────────────────┘  └───────────────┘  │
│                                                                   │
│  ╔═══════════════════════════════════════════════════════════════╗ │
│  ║  SHARED INTEGRATION FILES (e.g., package.json, tsconfig)    ║ │
│  ║  Workers: READ only                                          ║ │
│  ║  Assembler: WRITE only (after all worker gates PASS)         ║ │
│  ╚═══════════════════════════════════════════════════════════════╝ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Path Categories

| Category | Description | Worker May Write | Worker May Read | Assembler May Write |
|----------|-------------|-----------------|-----------------|---------------------|
| **Owned paths** | Files in task's namespace | Yes | Yes | No (already written) |
| **Other owned** | Files in other task's namespace | No | Yes (if allowed) | No |
| **Shared integration** | package.json, tsconfig, lockfiles, etc. | No | Yes | Yes |
| **lib/contracts** | Shared type contracts | No | Yes | No (immutable) |
| **System paths** | kernel/, server/, adapters/, hooks/ source | No | No | No (immutable) |

---

## Namespace Violation Detection

During CAPTURING, the evidence layer checks:
1. `changed_files` ⊆ `allowed_paths` (all writes within namespace)
2. No shared integration files in `changed_files`
3. No writes to other tasks' namespaces

Violation → ExecGate returns FAIL with `failed_criteria_ids: ['namespace_violation']`

---

## PredictedInterface

For `task_type: 'shared_package'`, tasks declare PredictedInterfaces:

| Field | Description |
|-------|-------------|
| `interface_task_id` | The task that will provide this interface |
| `exported_symbols` | Symbol names and expected signatures |
| `consuming_task_ids` | Tasks that depend on these exports |

PredictedInterfaces are used during assembly to detect signature mismatches. If a worker's actual exports differ from predicted, the Assembler produces a ConflictReport.

---

## MUST / MUST NOT Rules

### MUST
- Each file MUST have exactly ONE writer per wave
- Namespace partitions MUST be checked for overlaps at PSAG admission
- Workers MUST only write within their `allowed_paths`
- Shared integration files MUST be writable only by the Assembler
- Namespace violations MUST produce FAIL verdict at ExecGate

### MUST NOT
- Workers MUST NOT write outside their assigned namespace
- Workers MUST NOT write shared integration files under any circumstance
- Workers MUST NOT read or write other tasks' workspace files (unless explicitly allowed as read-only)
- Namespace overlaps MUST NOT pass PSAG admission

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Worker writes outside namespace | CAPTURING: changed_files check | ExecGate FAIL |
| Two tasks claim same file | PSAG: namespace overlap check | Reject PlanSpec |
| Worker writes shared integration file | CAPTURING: shared file check | ExecGate FAIL |
| PredictedInterface mismatch | Assembler: signature check | ConflictReport |

---

## Test/Gate Implications

- Test: PSAG rejects overlapping namespaces
- Test: ExecGate FAIL on namespace violation (worker writes outside allowed)
- Test: ExecGate FAIL on shared file write
- Test: Assembler detects PredictedInterface mismatch
- Test: Worker can READ other namespace files but cannot WRITE

---

## Decision Compliance Checklist

| Decision | Compliant? |
|----------|------------|
| Law 2: Assembler is only shared writer | Yes |
| D-108: Namespace violation must fail | Yes |
| D-019: lib/contracts is shared foundation | Yes |

---

## Open Questions

- Should read-only access to other namespaces be default or opt-in?
- How fine-grained should namespace paths be (directory-level vs file-level)?
- Should predicted_interfaces be required or optional for shared_package tasks?

## Audit Notes

- Namespace ownership is the mechanism that makes Law 2 enforceable
- Without namespace isolation, parallel workers would inevitably conflict on shared files
- The Assembler is the only component that may cross namespace boundaries during integration
