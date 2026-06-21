# Current State Map — What Exists and What Does Not

> This document maps the precise boundary between implemented (locked) and unimplemented (to design) PRAXIS MVP components. Verified against the repository at commit cd0acea.

## Locked/Implemented — Do NOT Redesign

### D3 — PlanSpec v0.1 Schema Pack (PASS_LOCKED)

| Artifact | Path | Status |
|----------|------|--------|
| Canonical schema | `schemas/planspec.v0.1.schema.yaml` | ✓ 1100 lines, 28 `$defs`, 27 `$refs` |
| Examples (5) | `examples/planspec/` | ✓ runtime_code, documentation, test_only, library_code, cli_command |
| Fixtures (10) | `fixtures/planspec/` | ✓ 4 PASS + 2 HOLD + 4 FAIL |
| Validation script | `scripts/validate-planspec-v0.1.py` | ✓ 338 lines, 38/38 checks |
| Lock report | `reports/accp/planspec-v0.1-schema-pack-lock.accp.yaml` | ✓ 9.2/10, 17/17 ACs |

**Schema `$defs` inventory (28):**
metadata, authority, workspace, execution, task, implementation, artifactPolicy, integrationContract, declaredUnit, integrationPoint, entrypoint, exportSurface, usageProof, runtimeProbe, runnerDiscovery, acceptanceCriterion, verification, commands, exactAllowedCommand, deniedCommand, validationEvidenceRules, evidence, evidenceType, gates, gateVerdict, repair, locking, reports

### P1 — @praxis/contracts (PASS_LOCKED)

| Module | Purpose | Status |
|--------|---------|--------|
| `parsePlanSpecYaml.ts` | YAML → PlanSpecV01 | ✓ |
| `validatePlanSpecSchema.ts` | JSON Schema validation | ✓ |
| `validatePlanSpecSemantics.ts` | Semantic cross-field checks | ✓ |
| `validatePlanSpec.ts` | Full pipeline (schema+semantics) | ✓ |
| `canonicalizePlanSpec.ts` | Normalize for hashing | ✓ |
| `hashPlanSpec.ts` | 7-field deterministic hashing | ✓ |
| `runPlanSpecFixtureSuite.ts` | Fixture runner | ✓ |
| `types.ts` | PlanSpecV01, PlanHashes, etc. | ✓ |
| **Tests** | 31/31 PASS | ✓ |
| **ACs** | 17/17 PASS | ✓ |

### P2 — @praxis/kernel (PASS_LOCKED)

| Component | Files | Status |
|-----------|-------|--------|
| SchemaGate | `src/gates/schemaGate.ts` | ✓ Delegates to @praxis/contracts |
| LockGate | `src/gates/lockGate.ts` | ✓ verify/create/refresh modes |
| Lock helpers | `src/lock/` (4 files) | ✓ create, read, write, verify |
| P2 Pipeline | `src/runP2Kernel.ts` | ✓ SchemaGate→LockGate→stop |
| Types | `src/types.ts` | ✓ GateVerdict, KernelContext, PlanLockV01 |
| Diagnostics | `src/diagnostics.ts` | ✓ Reason codes for SchemaGate+LockGate |
| **Tests** | 28/28 PASS | ✓ |
| **ACs** | 18/18 PASS | ✓ |

## Defined in Contracts (DRAFT_FOR_AUDIT) — To Implement

These contract documents exist but have no implementation:

| Contract | Path | What It Defines | Implementation Gap |
|----------|------|-----------------|--------------------|
| EvidenceRecord | `docs/contracts/evidence-record.contract.md` | EvidenceRecord shape, EHC chain, EHC break classification | No EvidenceLedger format, no EHC implementation |
| GateVerdict | `docs/contracts/gate-verdict.contract.md` | GateVerdict shape, reason codes, verdict ladder | Reason codes partially defined; some codes outdated vs schema `gateVerdict` `$def` |
| RepairPacket | `docs/contracts/repair-packet.contract.md` | RepairPacket fields, strategies, strategy context | No concrete format decision (YAML/JSON/markdown) |
| RepairPolicy | `docs/contracts/repair-policy.contract.md` | Schema repair section rules | Already encoded in schema — no separate implementation needed |
| WiringGate | `docs/contracts/wiring-gate.contract.md` | WiringGate purpose and scope | Very early draft — needs full redesign |
| PlanSpec | `docs/contracts/planspec-v0.1.contract.md` | PlanSpec v0.1 field documentation | Redundant with schema — can be derived |

## Key Design Gaps Identified

### Gap 1: No EvidenceLedger Format

The EvidenceRecord contract exists but there is no concrete evidence ledger format. The `ai_summary.md` mentions `.praxis/runs/<id>/evidence.jsonl` as the proposed v0.1 path, but:
- No schema for the ledger format
- No decision on YAML vs JSONL vs both
- No reader implementation
- No clear record append rules

### Gap 2: EvidenceGate Semantics Undefined

The gate-verdict.contract.md lists reason codes (`EVIDENCE_EMPTY`, `DIFF_EMPTY`, `NAMESPACE_VIOLATION`, `FILES_CHANGED_MISMATCH`) but does not specify:
- What evidence sources are checked in which order
- What constitutes a namespace violation
- How diff-empty is determined for different artifact classes
- What HOLD vs FAIL means per evidence condition
- How advisory evidence interacts with EvidenceGate

### Gap 3: WiringGate Design is Too Ambitious for v0.1

The existing WiringGate contract draft tries to cover static analysis, import graph analysis, and runtime reachability. For v0.1 this must be narrowed to:
- Static declared-unit filesystem matching
- Export surface verification (no AST)
- Orphan module detection
- All advanced wiring (AST, import graph, runtime probes) deferred to v0.2+

### Gap 4: ExecGate Safety Model Not Designed

No existing contract defines:
- How commands are validated before execution
- How timeout enforcement works
- How command output is captured as evidence
- How forbidden commands are blocked
- How watch mode is prevented
- How command spoofing is detected

### Gap 5: FinalGate Aggregation Logic Not Specified

The gate-verdict.contract.md has a verdict ladder table but does not specify:
- How multiple acceptance criteria map to a single FinalGate verdict
- How advisory-only criteria affect the verdict
- What happens when some criteria pass and some fail
- How evidence from prior gates feeds FinalGate

### Gap 6: No Report Model

There is no design for:
- Runtime report format (beyond ACCP lock reports)
- How gate verdicts are serialized into reports
- What summary information is included
- How repair packets are referenced in reports

### Gap 7: No CLI Design

No design exists for:
- CLI command tree
- Flag definitions
- Configuration loading
- Output formatting
- Error handling

### Gap 8: No Plugin Bridge Design

No design exists for:
- Slash command definitions
- Plugin-to-CLI communication protocol
- Display format for verdicts
- Hook integration points
- Safety boundaries

## Design Scope Summary

| Phase | Component | Existing State | This Pack Provides |
|-------|-----------|---------------|--------------------|
| P3 | EvidenceLedger | Mentioned in ai_summary.md | Concrete JSONL format with schema |
| P3 | EvidenceGate | Reason codes in gate-verdict.contract.md | Full design: inputs, outputs, semantics, HOLD/FAIL/PASS rules |
| P4 | WiringGate | Early draft in wiring-gate.contract.md | v0.1-lite design with static matching only |
| P5 | ExecGate | No design exists | Full design: command safety, timeout, evidence capture |
| P6 | FinalGate | Verdict ladder in gate-verdict.contract.md | Full aggregation model with advisory evidence rules |
| P6 | RepairPacket | Draft in repair-packet.contract.md | Concrete JSON format with schema |
| P6 | Reports | No design exists | Dual YAML+summary model |
| P6 | CLI | No design exists | Command tree, flags, configuration |
| P6 | Plugin | No design exists | Slash commands, display protocol, safety boundaries |
| All | Phase Plan | No roadmap exists | P3→P4→P5→P6 with per-phase ACs |

## Files NOT Modified

The following implementation files were verified as UNCHANGED during this design pack:

```
packages/contracts/src/*          — 13 source files, 0 modified
packages/contracts/test/*         — 1 test file, 0 modified
packages/kernel/src/*             — 15 source files, 0 modified (including gates/ and lock/)
packages/kernel/test/*            — 3 test files, 0 modified
schemas/planspec.v0.1.schema.yaml — 0 modified
scripts/validate-planspec-v0.1.py — 0 modified
```

**Verification:** `git status --short` shows only `reports/accp/current-state-audit.accp.yaml` and `.DS_Store`/`.praxis/` as untracked. No tracked files were modified.
