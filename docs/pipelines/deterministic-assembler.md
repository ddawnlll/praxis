> **⚠ Future scope for v0.1 (ADR-013 Plugin-First Pivot):** Deterministic Assembler is FUTURE scope for v0.1. v0.1 does not include multi-worker orchestration or shared file assembly. See `docs/adr/ADR-013-plugin-first-pivot.md`.

# Deterministic Assembler Pipeline

**Status:** DRAFT_FOR_AUDIT (FUTURE for v0.1)
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the Deterministic Assembler — the only component that writes shared integration files, enforcing Law 2 through atomic, verifiable assembly of verified worker outputs.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

After all workers in a wave pass FinalGate, the Deterministic Assembler integrates their verified outputs. It is the only component authorized to write shared integration files (Law 2). It performs namespace rechecks, semantic checks, atomic patch application, and rollback on failure, producing a ConflictReport if integration fails.

## Scope

- Assembly trigger conditions (all wave tasks PASS)
- Assembly steps: namespace recheck → semantic check → atomic apply
- Rollback mechanism
- ConflictReport production
- RIM integration on conflict

## Non-Goals

- Worker execution (see `docs/pipelines/worker-adapter.md`)
- RIM repair (see `docs/pipelines/rim-repair-loop.md`)
- Namespace definition (see `docs/pipelines/namespace-ownership.md`)

## Authoritative Decisions Used

| Decision ID | Summary |
|-------------|---------|
| Law 2 | No worker writes shared integration files; Assembler is only shared writer |
| Law 2 | Assembler runs after verified worker outputs |
| Law 2 | Deterministic Assembler is the only shared writer |

---

## Conceptual Model

```
                    All workers in wave PASS FinalGate
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DETERMINISTIC ASSEMBLER                         │
│                                                                   │
│  Step 1: NAMESPACE RECHECK                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Verify no worker wrote outside namespace                 │    │
│  │ Verify no worker wrote shared integration files          │    │
│  │ Verify all changed_files are within allowed_paths         │    │
│  │                                                           │    │
│  │ FAIL → ConflictReport (namespace_overlap) → RIM          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │ PASS                                  │
│                           ▼                                       │
│  Step 2: SEMANTIC CHECK                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Extract signatures from each worker's output             │    │
│  │ Compare against PredictedInterfaces (if declared)        │    │
│  │ Scan call sites for cross-task symbol usage              │    │
│  │ Detect signature/callsite mismatches                     │    │
│  │                                                           │    │
│  │ FAIL → ConflictReport (signature/callsite) → RIM         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │ PASS                                  │
│                           ▼                                       │
│  Step 3: ATOMIC APPLY                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Create pre-assembly snapshot (for rollback)              │    │
│  │ Apply all worker patches atomically                      │    │
│  │ Apply shared integration file changes (assembler-only)   │    │
│  │ Verify apply succeeded                                   │    │
│  │                                                           │    │
│  │ FAIL → ROLLBACK → ConflictReport → RIM                   │    │
│  │ PASS → Wave complete, emit AssemblyComplete event        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Assembly Steps

### Step 1: Namespace Recheck

Even though CAPTURING checks namespace, the Assembler rechecks before applying patches. This is a defense-in-depth measure — if a namespace check was missed during CAPTURING, the Assembler catches it before integration begins.

### Step 2: Semantic Check

The Assembler performs lightweight semantic analysis:
- **Signature extraction**: For each worker output, extract exported symbols and their signatures
- **PredictedInterface validation**: If tasks declared PredictedInterfaces, verify actual exports match
- **Callsite scanning**: Scan changed files for imports from other wave tasks; verify the imported symbol exists and has the expected signature

### Step 3: Atomic Apply

- All worker patches are applied together as a single atomic operation
- Shared integration files are updated by the Assembler (e.g., `package.json` dependencies updated to reflect new package)
- If ANY patch fails to apply, ALL patches are rolled back
- Rollback restores the pre-assembly state from snapshot

---

## Rollback

On apply failure:
1. Restore workspace to pre-assembly snapshot
2. Produce ConflictReport describing what failed and why
3. Route ConflictReport to RIM for repair packet generation
4. Workers' original outputs are preserved (evidence is not lost)
5. New wave assembly attempt scheduled after repair

---

## MUST / MUST NOT Rules

### MUST
- Assembler MUST run only after ALL wave tasks PASS FinalGate
- Assembler MUST recheck namespaces before applying patches
- Assembler MUST apply all patches atomically (all or nothing)
- Assembler MUST rollback on any failure
- Assembler MUST produce a ConflictReport on failure
- Assembler MUST be the ONLY component that writes shared integration files

### MUST NOT
- Workers MUST NOT write shared integration files directly
- Assembler MUST NOT modify worker outputs (it integrates them, not rewrites them)
- Assembler MUST NOT apply partial patches (no worker-by-worker commit)
- Assembler MUST NOT skip semantic checks

---

## Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Namespace violation missed by CAPTURING | Assembler recheck | ConflictReport → RIM |
| PredictedInterface mismatch | Semantic check | ConflictReport → RIM |
| Callsite mismatch | Semantic check | ConflictReport → RIM |
| Patch apply fails (merge conflict) | Atomic apply | Rollback → ConflictReport → RIM |
| Rollback fails | Pre/post state comparison | Human escalation |

---

## Test/Gate Implications

- Test: Assembler runs only after all tasks PASS
- Test: Namespace violation caught on recheck
- Test: Signature mismatch produces ConflictReport
- Test: Atomic apply with 3 workers' patches
- Test: Rollback on patch failure restores previous state
- Test: Assembler writes shared integration files (workers cannot)
- Test: ConflictReport routed to RIM for next attempt

---

## Decision Compliance Checklist

| Decision | Compliant? |
|----------|------------|
| Law 2: Assembler is only shared writer | Yes |
| Law 2: Workers do not write shared files | Yes |
| Law 2: Assembler after verification | Yes |

---

## Open Questions

- How deep should semantic checking go (full AST vs signature-level)?
- Should assembler support partial wave assembly (only tasks that passed)?
- What is the performance cost of atomic apply for large waves?
- Should assembler cache semantic signatures across assembly attempts?

## Audit Notes

- The Deterministic Assembler is the physical enforcement of Law 2
- Atomic apply + rollback ensures the workspace is never in a partially-integrated state
- Semantic checking, while lightweight, prevents a major class of integration bugs where workers' outputs are individually correct but incompatible
