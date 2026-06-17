# ADR Index

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Resolve ADR numbering ambiguity and serve as the authoritative ADR index for the PRAXIS project.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

This document is the ADR (Architecture Decision Record) index for PRAXIS. It serves three goals:

1. **Resolve numbering ambiguity** -- earlier discussions used conflicting ADR numbers across `ai_summary.md`, `architecture.md`, and informal references. This index is the single source of truth for ADR numbering.
2. **Register all ADRs** -- every ADR, whether written yet or planned, is listed here with its status, topic, and canonical number.
3. **Prevent collisions** -- the `architecture_lock_readiness` audit flagged potential ADR numbering collisions. All new ADRs must be registered in this index before the ADR file is written.

---

## Scope

This index covers all ADRs for PRAXIS v2.0, from P-1 (decision lock) through P6 (production hardening). It does not cover the old `pi/` monorepo's ADRs; those are historical reference only.

---

## Non-Goals

- This index does **not** create individual ADR files. Each ADR file is a separate document (`docs/adr/ADR-NNN-title.md`). This index only catalogs them.
- This index does **not** duplicate the decision content from `docs/decisions.md`. It links to ADR files and cross-references decisions.md decision IDs.
- This index does **not** replace `docs/decisions.md` as the quick canonical decision summary.

---

## Authoritative Decisions Used

| Decision ID | Summary | Source |
|-------------|---------|--------|
| D-044 | P0 is Selective pi/ Reuse Foundation Port, not migration | `docs/decisions.md` |
| D-050 | Old runtime controller code coupled to DB/Kysely must not become PRAXIS kernel | `docs/decisions.md` |
| D-051 | Full pi/ migration is rejected | `docs/decisions.md` |
| D-052 | P-1 through P6 is the canonical phase model | `docs/decisions.md` |
| D-061 | Old Phase 0/1/2/3 labels must be mapped to canonical phases | `docs/decisions.md` |
| D-084 | Circuit Breaker is kernel-owned | `docs/decisions.md` |
| D-098 | Contract-first development is mandatory | `docs/decisions.md` |

---

## Relationship to `docs/decisions.md`

| Document | Role |
|----------|------|
| `docs/decisions.md` | Quick canonical decision summary. Referenced by agents before starting work. Contains all HARD_LOCK, SOFT_LOCK, OPEN, and REJECTED decisions. |
| `docs/adr/README.md` (this file) | ADR index. Lists every ADR by number, status, and topic. Resolves numbering. |
| `docs/adr/ADR-NNN-title.md` | Individual ADR. Provides detailed rationale, alternatives considered, consequences, and formal change record for a single decision. |

**Rule:** `docs/decisions.md` remains the quick canonical summary. ADR files provide the detailed rationale and formal change records that back decisions in `docs/decisions.md`. The ADR index links the two.

---

## Numbering Policy

- **Format:** `ADR-NNN` where `NNN` is a zero-padded sequential number (e.g., `ADR-001`, `ADR-002`, ..., `ADR-099`, `ADR-100`).
- **Assignment:** Numbers are assigned when an ADR is registered in this index. A number is reserved by adding a row to the index; it is considered "in use" once the ADR file exists and is marked Accepted.
- **No renumbering:** Once an ADR number is assigned, it is permanent. Do not renumber ADRs to close gaps. If an ADR is superseded, mark it `Superseded` and add a new ADR with the replacement.
- **No deletion:** ADR entries are never removed from this index. Their status changes (Proposed -> Accepted -> Superseded), but the entry remains.

---

## Reserved Number Ranges

| Range | Purpose | Status |
|-------|---------|--------|
| ADR-001 through ADR-010 | Early architecture decisions (P-1 / P0 era) | Some written, some planned |
| ADR-011 through ADR-030 | Available for future ADRs | Unused |
| ADR-031 through ADR-050 | Available for future ADRs | Unused |
| ADR-051 and above | Open for any ADR | Unused |

---

## Current Known Required ADRs

### Already recognized (from `ai_summary.md` and `architecture.md`)

| ADR | Title | Status | Cross-reference |
|-----|-------|--------|-----------------|
| ADR-001 | ACCP Always Async | Proposed (tentative) | D-037, D-038. ACCP artifacts must not block the execution critical path. |
| ADR-002 | Assembler Wave-Level | Proposed (tentative) | Law 2. Per-task assembly breaks parallelism; assembly is wave-level only. |
| ADR-003 | stable_16 Concurrency Ceiling | Proposed (tentative) | D-087. Unbounded concurrency is an accident, not a milestone. |
| ADR-004 | Human-Only Acceptance Criteria | Proposed (tentative) | D-035, D-036, Law 3. FinalGate criteria must come from human-authored TaskSpec only. |
| ADR-005 | Claude Code NO-GO Fallback | Proposed (tentative) | D-070, D-071, D-072. If hooks prove unreliable, fall back to Messages API. |

### Required but not yet proposed

| ADR | Title | Rationale | Cross-reference |
|-----|-------|-----------|-----------------|
| ADR-006 | pi/ Reuse Policy | Defines exactly which old `pi/` packages are ported, adapted, referenced, or forbidden. This ADR backs D-044 through D-051. | D-044, D-045, D-046, D-047, D-048, D-049, D-050, D-051 |
| ADR-007 | Desktop Mission Control MVP Scope | Formalizes D-002 through D-015: Desktop is primary operator interface, Electron shell is MVP, CLI-only is rejected. | D-002, D-003, D-004, D-015 |
| ADR-008 | Circuit Breaker Kernel Ownership | Formalizes D-084 through D-090: Circuit Breaker lives in kernel, not server/adapters/interface. | D-084, D-085, D-086, D-089, D-090 |

---

## Collision Warning

The `architecture_lock_readiness` audit identified that `ai_summary.md` lists ADRs 001-005 with specific topics (ACCP async, Assembler wave-level, stable_16 ceiling, human-only criteria, Claude Code NO-GO fallback), while `architecture.md` section 31 lists ADR-001 through ADR-010 with different topics (Runtime Server naming, HTTP+SSE vs WebSocket, PostgreSQL primary DB, Kysely vs Alembic, Adapters as top-level boundary, Claude Code adapter separation, Electron vs Tauri, No root src, Event log as UI source of truth, Circuit Breaker kernel ownership).

**Resolution:** This index reconciles both sets. The tentative canonical numbers from `ai_summary.md` (ADR-001 through ADR-005) are preserved as the most recent assignment. The topics from `architecture.md` section 31 are mapped into the ADR numbering below, resolving collisions. All new ADRs must be registered in this index before a file is created.

| Canonical ADR | Topic | Source File | Resolution |
|---------------|-------|-------------|------------|
| ADR-001 | ACCP Always Async | `ai_summary.md` | Preserved |
| ADR-002 | Assembler Wave-Level | `ai_summary.md` | Preserved |
| ADR-003 | stable_16 Concurrency Ceiling | `ai_summary.md` | Preserved |
| ADR-004 | Human-Only Acceptance Criteria | `ai_summary.md` | Preserved |
| ADR-005 | Claude Code NO-GO Fallback | `ai_summary.md` | Preserved |
| ADR-006 | pi/ Reuse Policy | New | Required; not yet written |
| ADR-007 | Desktop Mission Control MVP Scope | New | Required; not yet written |
| ADR-008 | Circuit Breaker Kernel Ownership | New; absorbs `architecture.md` ADR-010 | Required; not yet written |
| -- | Runtime Server Naming (daemon removed) | `architecture.md` ADR-001 | Absorbed into architecture.md Section 1; no separate ADR needed |
| -- | HTTP + SSE instead of WebSocket MVP | `architecture.md` ADR-002 | Backed by D-025; ADR deferred until implementation spike confirms |
| -- | PostgreSQL primary DB, no SQLite MVP | `architecture.md` ADR-003 | Backed by D-092; SOFT_LOCK; ADR file deferred |
| -- | Kysely + raw SQL migrations | `architecture.md` ADR-004 | Backed by D-093; SOFT_LOCK; ADR file deferred |
| -- | Adapters as top-level boundary | `architecture.md` ADR-005 | Backed by D-021, D-022; HARD_LOCK in decisions.md; ADR file deferred |
| -- | Claude Code adapter and praxis-hook separation | `architecture.md` ADR-006 | Backed by D-073, D-074; HARD_LOCK in decisions.md; ADR file deferred |
| -- | Electron instead of Tauri | `architecture.md` ADR-007 | Backed by D-064; SOFT_LOCK; ADR file deferred |
| -- | No root src directory | `architecture.md` ADR-008 | Backed by D-018; HARD_LOCK in decisions.md; ADR file deferred |
| -- | Event log as UI source of truth | `architecture.md` ADR-009 | Backed by D-026, D-096; HARD_LOCK in decisions.md; ADR file deferred |

---

## Complete ADR Registry

| ADR | Title | Status | Written | Date | Cross-reference |
|-----|-------|--------|---------|------|-----------------|
| ADR-001 | ACCP Always Async | Proposed | No | -- | D-037, D-038 |
| ADR-002 | Assembler Wave-Level | Proposed | No | -- | Law 2 |
| ADR-003 | stable_16 Concurrency Ceiling | Proposed | No | -- | D-087 |
| ADR-004 | Human-Only Acceptance Criteria | Proposed | No | -- | D-035, D-036, Law 3 |
| ADR-005 | Claude Code NO-GO Fallback | Proposed | No | -- | D-070, D-071, D-072 |
| ADR-006 | pi/ Reuse Policy | Required | No | -- | D-044 through D-051 |
| ADR-007 | Desktop Mission Control MVP Scope | Required | No | -- | D-002 through D-015 |
| ADR-008 | Circuit Breaker Kernel Ownership | Required | No | -- | D-084 through D-090 |

---

## Change Process

1. **New ADR needed:** Propose the ADR topic and request a number. Add an entry to this index with status `Proposed`.
2. **Write ADR file:** Create `docs/adr/ADR-NNN-title.md` using the ADR format (Status, Context, Decision, Consequences, Alternatives Considered). Update the index entry status to `Accepted`.
3. **Link to decisions.md:** If the ADR creates or changes a HARD_LOCK decision, add or update the corresponding decision in `docs/decisions.md` and link back to the ADR.
4. **Superseding an ADR:** Mark the old ADR `Superseded` in this index. Write a new ADR that references the old one and explains the change. Do not renumber.
5. **No silent changes:** Any change to an Accepted ADR requires a new ADR or a formal addendum. Do not edit an Accepted ADR silently.

---

## MUST / MUST NOT Rules

### MUST

- MUST register every new ADR in this index before writing the ADR file.
- MUST use sequential zero-padded numbers (ADR-001, ADR-002, ...).
- MUST cross-reference the relevant decision IDs from `docs/decisions.md`.
- MUST update this index when an ADR status changes (Proposed -> Accepted -> Superseded).
- MUST include the ADR index reference in `docs/decisions.md` when a HARD_LOCK is affected.

### MUST NOT

- MUST NOT create individual ADR files without a registered entry in this index.
- MUST NOT renumber ADRs after assignment.
- MUST NOT delete ADR entries from this index.
- MUST NOT use ADR numbers from `architecture.md` section 31 that collide with the canonical set (ADR-001 through ADR-005).
- MUST NOT write ADR files that contradict `docs/decisions.md` HARD_LOCK decisions.

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| ADR written without index registration | Number collision, untracked decision | Gate: ADR PR must include index update |
| Index entry exists but ADR file does not | Agents see a planned ADR as authoritative | Status column distinguishes `Required` from `Accepted` |
| Two agents assign the same ADR number simultaneously | Numbering collision | Pre-claim numbers by adding `Required` entries to the index as the first step |
| Old architecture.md ADR numbers assumed authoritative | Agents use wrong ADR numbers in code/docs | Collision Warning section above provides the canonical mapping |
| Index gets out of sync with actual ADR files | Confusion about which ADRs exist | Audit: every Accepted ADR must have a file; every file must have an index entry |

---

## Test / Gate Implications

- **P-1 Gate:** This ADR index must exist and resolve the numbering collision before P-1 is considered complete.
- **ADR Gate:** Every new ADR PR must include an update to this index.
- **Collision Check:** Before writing an ADR file, the agent must consult this index for the next available number.

---

## Decision Compliance Checklist

- [x] P-1 through P6 is canonical phase model (D-052)
- [x] P0 is "Selective pi/ Reuse Foundation Port", not migration (D-044)
- [x] Full pi/ migration is REJECTED (D-051)
- [x] Circuit Breaker is kernel-owned (D-084)
- [x] Contract-first development is mandatory (D-098)
- [x] ADR index does not create individual ADR files (per scope)
- [x] ADR numbering collision is explicitly resolved (Collision Warning section)
- [x] Change process links back to decisions.md

---

## Open Questions

1. **Should ADR-009 and beyond be assigned for the remaining architecture.md topics?** Answer: Defer until those decisions need formal ADR rationale. Many are already HARD_LOCK in decisions.md and may not need separate ADR files.
2. **Should ADR-001 through ADR-005 be written retroactively?** Answer: Yes. They capture decisions already made during architecture design. Write them when P-1 documentation is completed.
3. **What is the ADR file format?** Answer: See `architecture.md` section 31 for the suggested format. Individual ADR files follow: Title, Status (Proposed/Accepted/Rejected/Superseded), Context, Decision, Consequences, Alternatives Considered.

---

## Audit Notes

- The collision between `ai_summary.md` ADRs (001-005) and `architecture.md` ADRs (001-010) is resolved by this index. The `ai_summary.md` numbering is preserved as canonical; `architecture.md` topics are either absorbed into this index with new numbers or deferred.
- At the time of writing, no ADR files exist in `docs/adr/`. All entries are `Proposed` or `Required`. This is expected during P-1 planning.
- Agents must consult this index before creating any ADR file. The next available number after ADR-008 is ADR-009.
