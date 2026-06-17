# Evidence Record Contract

**Status:** DRAFT_FOR_AUDIT
**Version:** v0.1
**Canonical decisions:** `docs/decisions.md`
**Purpose:** Define the EvidenceRecord contract -- the shape, hash chain integrity rules, and EHC break classification for every piece of evidence captured during a worker attempt. EvidenceRecords form a tamper-evident chain that feeds gate verdicts and Circuit Breaker safety decisions.

> This document must not override `docs/decisions.md`. If there is a conflict, `docs/decisions.md` wins.

---

## Purpose

Every worker action inside PRAXIS produces evidence. The EvidenceRecord is the atomic unit of that evidence. Each record is chained via SHA-256 hashes, forming an Evidence Hash Chain (EHC) that is tamper-evident, auditable, and replayable. The chain allows the Truth Engine to verify that evidence was not fabricated, altered, or omitted, and allows the Circuit Breaker to detect systematic integrity failures.

---

## Scope

- Defines the EvidenceRecord shape and all fields
- Defines the Evidence Hash Chain (EHC) construction rules
- Defines the `source` enum and `kind` enum values
- Defines EHC break classification: NOISE, SUSPECTED, CONFIRMED
- Defines which evidence feeds which gate
- Defines how EHC breaks propagate to Circuit Breaker

---

## Non-Goals

- How evidence is stored in PostgreSQL (delegated to `server/storage`)
- How the Truth Engine evaluates evidence (delegated to `gate-verdict.contract.md`)
- How hooks capture raw events (delegated to hook implementation)
- How divergence detection works internally (delegated to architecture.md Section 11.3)
- Token/token-cost tracking (Governor territory)

---

## Authoritative Decisions Used

| Decision ID | Decision | How Applied |
|-------------|----------|-------------|
| D-031 | Hook never decides truth | All hook events are raw evidence; hooks do not classify or evaluate |
| D-032 | Truth Engine owns attempt-level PASS/HOLD/FAIL | Evidence feeds gates; gates produce verdicts |
| D-034 | EvidenceRecord and EHC required for trustworthy verification | EHC is mandatory for every attempt |
| D-084 | Circuit Breaker is kernel-owned | EHC CONFIRMED feeds Circuit Breaker OPEN trigger |
| D-085 | Circuit Breaker states: CLOSED, OPEN, HALF_OPEN | EHC break classification is one trigger |
| D-104 | Agent claims are not completion evidence | EvidenceRecord captures what happened, not what agent claims |

---

## Conceptual Model

```
Worker Action (tool call, file write, command run)
        │
        ▼
┌───────────────────────────────────────────┐
│              EvidenceRecord                │
│                                           │
│  evidence_id       (unique id)            │
│  attempt_id        (which attempt)        │
│  worker_id         (which worker)         │
│  timestamp         (when captured)        │
│  source            (who captured it)      │
│  kind              (what kind of event)   │
│  content_ref       (where content lives)  │
│  content_hash      (sha256 of content)    │
│  previous_hash     (prior record hash)    │
│  chain_hash        (sha256 of chain)      │
│                                           │
│  chain_hash = sha256(prev_chain_hash      │
│                       + content_hash)     │
└───────────────┬───────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────┐
│       Evidence Hash Chain (EHC)           │
│                                           │
│  Record 1 → Record 2 → Record 3 → ...    │
│  hash 1     hash 2     hash 3            │
│                                           │
│  Each chain_hash links current record     │
│  to entire prior chain. Break in chain    │
│  = tamper evidence or integrity loss.     │
└───────────────┬───────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────┐
│         EHC Break Classifier              │
│                                           │
│  NOISE:      single mismatch              │
│  SUSPECTED:  multiple mismatches          │
│  CONFIRMED:  systematic pattern           │
│              → feeds Circuit Breaker OPEN │
└───────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `hooks/praxis-hook` | Captures raw tool events; emits as EvidenceRecord with `source='kernel_hook'` |
| `kernel/evidence/ehc/` | Constructs hash chain; verifies chain integrity; classifies breaks |
| `kernel/evidence/capture/` | Captures git diff, file changes, transcripts as EvidenceRecords |
| `kernel/evidence/divergence/` | Produces EvidenceRecords with `source='divergence_detector'` when hook output != worker claim |
| `kernel/truth-engine/gates/` | Reads EvidenceRecords as input to EvidenceGate, ExecGate, FinalGate |
| `kernel/circuit-breaker/` | Consumes CONFIRMED EHC break classification as OPEN trigger |
| `server/storage/` | Persists EvidenceRecords and chain hashes for audit |

---

## Field Definitions

### EvidenceRecord

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `evidence_id` | string | Yes | Unique identifier for this record | Non-empty, kebab-case or prefix_id format |
| `attempt_id` | string | Yes | The attempt this evidence belongs to | Must reference a valid attempt |
| `worker_id` | string | Yes | The worker that produced this action | Must reference a valid worker |
| `timestamp` | ISO 8601 string | Yes | When the evidence was captured | Monotonically non-decreasing within chain |
| `source` | SourceEnum | Yes | Who/what captured this evidence | Must be valid enum value |
| `kind` | KindEnum | Yes | What type of event this represents | Must be valid enum value |
| `content_ref` | string | Yes | Reference to where full content is stored | Non-empty; may be storage key or file path |
| `content_hash` | string (hex) | Yes | SHA-256 hash of the raw content | Must be 64 hex characters |
| `previous_hash` | string (hex) \| null | Yes | Content hash of previous record in chain | Null only for first record in chain |
| `chain_hash` | string (hex) | Yes | SHA-256 hash linking to entire prior chain | Must match `sha256(prev_chain_hash + content_hash)` |

### `source` Enum

| Value | Meaning | Produced By |
|-------|---------|-------------|
| `kernel_hook` | Captured by PRAXIS hook from external tool event | `hooks/praxis-hook` |
| `git` | Captured from git operations (diff, status) | `kernel/evidence/capture/git-diff-capture` |
| `filesystem` | Captured from filesystem snapshots | `kernel/evidence/capture/filesystem-snapshot` |
| `divergence_detector` | Captured by divergence detection comparing hook output vs worker claims | `kernel/evidence/divergence/divergence-detector` |

### `kind` Enum

| Value | Meaning | Example Content |
|-------|---------|----------------|
| `pre_tool` | Event before a tool is executed | Tool name, inputs, timestamp before execution |
| `post_tool` | Event after a tool completes | Tool output, exit code, duration |
| `diff` | Git diff of changes made | Unified diff output |
| `file_change` | File was created, modified, or deleted | File path, change type, before/after hashes |
| `divergence` | Mismatch between hook-captured output and worker-reported output | Divergence details, mismatched fields |

---

## EHC Break Classification

The Evidence Hash Chain verifier computes chain integrity by recalculating `chain_hash` for each record and comparing against the stored value.

### Classification Table

| Classification | Condition | Severity | Action |
|----------------|-----------|----------|--------|
| **NOISE** | Single record mismatch; all surrounding records intact | Low | Log warning; do NOT open Circuit Breaker |
| **SUSPECTED** | Multiple (2+) mismatches within same attempt chain | Medium | Flag for human review; do NOT automatically open Circuit Breaker |
| **CONFIRMED** | Systematic pattern across attempts: recurrence in same source/kind, pattern of missing records, or >3 mismatches in a single attempt | High | **Feed Circuit Breaker OPEN trigger**; emit `ehc_break.confirmed` runtime event |

### Break Detection Algorithm (Conceptual)

```
For each EvidenceRecord in chain (ordered by timestamp):
  1. Compute expected_chain_hash = sha256(prev.chain_hash || record.content_hash)
  2. If expected_chain_hash != record.chain_hash:
       - Increment mismatch counter for this attempt
       - Record mismatch kind and source
  3. After chain traversal:
       - 0 mismatches: chain is CLEAN
       - 1 mismatch:  classify as NOISE
       - 2-3 mismatches: classify as SUSPECTED
       - >3 mismatches OR pattern detected: classify as CONFIRMED
```

---

## MUST Rules

1. **MUST** compute `chain_hash` as `sha256(previous_record.chain_hash + this_record.content_hash)` for every record after the first.
2. **MUST** set `chain_hash` = `content_hash` for the first record in an attempt chain (where `previous_hash` is null).
3. **MUST** verify the full EHC before any gate evaluation for a given attempt.
4. **MUST** classify EHC breaks as NOISE, SUSPECTED, or CONFIRMED.
5. **MUST** feed CONFIRMED classification to Circuit Breaker as an OPEN trigger.
6. **MUST** persist every EvidenceRecord before the corresponding gate evaluation begins.
7. **MUST** use cryptographic SHA-256 (not MD5, not SHA-1) for all hashes.
8. **MUST** produce at least one EvidenceRecord per attempt (empty evidence is itself evidence).
9. **MUST** include timestamps that are monotonically non-decreasing within a single attempt's chain.
10. **MUST** reference content via `content_ref` rather than embedding large content directly in the record.

## MUST NOT Rules

1. **MUST NOT** make hook-side truth decisions. Hooks capture raw events; the Truth Engine interprets them.
2. **MUST NOT** allow evidence to skip the EHC chain. Every piece of evidence enters the chain.
3. **MUST NOT** modify or delete a persisted EvidenceRecord (append-only).
4. **MUST NOT** trust worker self-reported evidence without hook-side corroboration.
5. **MUST NOT** evaluate gate criteria inside the evidence capture layer.
6. **MUST NOT** classify EHC breaks outside `kernel/evidence/ehc/ehc-break-classifier`.
7. **MUST NOT** open Circuit Breaker on NOISE or SUSPECTED EHC breaks (only CONFIRMED).
8. **MUST NOT** allow `content_hash` to be computed from anything other than the raw captured content.
9. **MUST NOT** accept an EvidenceRecord with a `source` not in the defined enum.
10. **MUST NOT** accept an EvidenceRecord with a `kind` not in the defined enum.

---

## Forbidden Authority Fields

The following fields or behaviors are explicitly forbidden in an EvidenceRecord:

| Forbidden | Reason |
|-----------|--------|
| `verdict` field | Evidence does not judge itself. Only gates produce verdicts. |
| `truth_score` field | Evidence is raw fact, not scored truth. |
| `is_trusted` field | Trust is determined by chain integrity, not a flag. |
| `worker_claim` as sole content | Worker claims without hook corroboration are not standalone evidence. |
| `source='worker_self_report'` | Worker self-report is not a valid evidence source. |
| Modification of existing records | Evidence is append-only and immutable. |
| Skipping the hash chain | Every record MUST be chained. |

---

## Failure Modes

| Failure | Detection | Consequence |
|---------|-----------|-------------|
| Missing evidence record (gap in chain) | EHC verifier detects discontinuity in chain_hash linking | Chain classified as SUSPECTED or CONFIRMED |
| Tampered content (hash mismatch) | content_hash != sha256(actual_content) | Chain classified based on severity |
| Out-of-order timestamps | Timestamp not >= previous record timestamp | Chain classified as SUSPECTED |
| Missing hook events (worker ran but no pre/post captured) | Expected hook events absent from chain | EvidenceGate may produce HOLD |
| Divergence between hook and worker claim | divergence_detector produces EvidenceRecord with kind='divergence' | ExecGate may produce FAIL |
| Duplicate evidence_id | Uniqueness constraint violation in storage | Record rejected; attempt may be HOLD |

---

## Test / Gate Implications

### Tests Required

- EHC chain_hash computation matches expected values for known inputs
- Single-record chain (first record) has chain_hash == content_hash
- EHC verifier detects a single hash mismatch and classifies as NOISE
- EHC verifier detects multiple mismatches and classifies as SUSPECTED
- EHC verifier detects systematic pattern and classifies as CONFIRMED
- CONFIRMED EHC break feeds Circuit Breaker OPEN trigger
- NOISE EHC break does NOT feed Circuit Breaker OPEN trigger
- SUSPECTED EHC break does NOT automatically open Circuit Breaker
- Timestamp monotonicity violation is detected
- Missing record (gap) is detected
- EvidenceRecord with forbidden fields (verdict, truth_score) is rejected

### Gate Implications

- **EvidenceGate**: Reads evidence chain to verify real file changes occurred inside namespace. Broken chain = evidence cannot be trusted = HOLD or FAIL.
- **ExecGate**: Reads transcript/capture evidence from chain. Divergence evidence = FAIL.
- **FinalGate**: Reads evidence chain to verify acceptance criteria. Incomplete chain = cannot verify = HOLD.
- **Circuit Breaker**: CONFIRMED EHC break = OPEN trigger.

---

## Decision Compliance Checklist

- [ ] D-031: Hook events are raw evidence; no truth decisions in hook layer
- [ ] D-032: Evidence feeds gates; gates produce verdicts (no verdict in evidence)
- [ ] D-034: Every attempt produces an EvidenceRecord chain with SHA-256 hashes
- [ ] D-084: Circuit Breaker receives CONFIRMED classification
- [ ] D-085: EHC break is one of three Circuit Breaker triggers
- [ ] D-104: Agent claims are not trusted as standalone evidence
- [ ] D-108: EvidenceGate checks namespace compliance via evidence records

---

## Open Questions

1. What is the maximum practical chain length before performance becomes a concern? Should chain checkpointing (intermediate anchor hashes) be introduced?
2. Should `content_ref` support multiple storage backends (PostgreSQL large objects vs filesystem paths)?
3. How is partial chain recovery handled if the runtime crashes mid-attempt and restarts?

---

## Audit Notes

- This contract is DRAFT_FOR_AUDIT. Field names, enum values, and classification thresholds may change during implementation.
- The EHC break classification thresholds (1=mismatch=NOISE, 2-3=SUSPECTED, >3=CONFIRMED) should be validated against real-world data during P3 kernel safety core testing.
- The divergence detector's integration with EHC needs particular scrutiny -- divergence evidence is a special kind that spans two sources (hook vs worker).
- Ensure that `previous_hash` references are validated against actual stored content, not just checked for non-null.
