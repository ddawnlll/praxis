# Changelog

All notable changes to PRAXIS are documented here.

## v1.0.0 — Verity (2026-07-12)

**PRAXIS 1.0 introduces Verity** — a cryptographic verification layer that makes agent output verification tamper-evident, hermetically isolated, and receipt-signed. 20 of 22 milestone issues completed; 2 deferred (real OCI + Linux namespaces require CI infrastructure).

### Added

**Protocol & Cryptography:**
- `@praxis/protocol` — Protocol v1 JSON schemas, canonical serialization, Ed25519 key generation/signing/verification, trust store, v0.1→v1 migration policy (#15, #17)
- `@praxis/ledger` — RFC-6962 Merkle tree, append-only evidence ledger, immutable receipt storage with content-addressed dedup (#18)

**8-Gate Verification Pipeline:**
- `AdmissionGate` — Protocol version, capability, identity, manifest schema, baseHash format, idempotency, policy binding (#21)
- `IntegrityGate` — Merkle root consistency, runner digest format, optional Ed25519 signature verification (#21)
- `ScopeGate` — Path containment (realpath), symlink escape prevention, allowed/forbidden glob matching (#22)
- `ArchitectureGate` — Declared unit existence, required entrypoints, orphan module detection, export verification (#22)
- `EffectGate` — Hephaestus v0.6 effect class policy (reversible/compensable/irreversible) (#30)
- `RecoveryGate` — Compare-and-swap base, idempotency, rollback pointer, crash/replay state (#27)
- `HermeticExecGate` — OCI runner abstraction, adapter contracts, isolation policy validation (#24, #26)
- `FinalReceiptGate` — Aggregates all gates, Ed25519-signed VerificationReceipt, single-use consumption, expiry enforcement (#28)

**Hermetic Execution Infrastructure:**
- `OciRunner` interface + `DockerOciRunner` + `MockOciRunner` — container runner abstraction (#24)
- `IsolationPolicy` — Network deny/allow, resource limits (CPU/memory/pids/output), process isolation (#25)
- `AdapterContract` — Compile/parse abstraction for build/test/lint/typecheck/coverage adapters (#26)
- `TestAdapter` — Reference adapter implementation for tests (#26)

**Attestation:**
- `captureAttestation` — Runner image digest, toolchain detection, dependency lock hashing, environment fingerprinting with secret denylist (#19)

**Golden Replay Harness:**
- `@praxis/verity-replay` — 6 deterministic scenarios: stale-base, crash-mid-promotion, irreversible-AFK, postcondition-rollback, dual-surface-kill, receipt-expiry-replay (#32)

**Qualification Infrastructure:**
- `@praxis/verity-qual` — Property-based fuzzing (seeded PRNG, determinism check, false-PASS detection), fault injection (6 kinds), fail-closed release gate (#34, #35)
- `scripts/verity-release-gate.ts` — CLI entry point for release gate evaluation
- `scripts/replay-harness.ts` — 300K iteration replay harness
- `scripts/shadow-heartbeat.ts` — 30-day shadow SLO heartbeat

**Client & SDKs:**
- `@praxis/verity-client` — Versioned client with capability handshake, promotion binding, receipt verification (#31)
- `praxis-verity-client` (Python) — Canonical serialization, Ed25519 crypto, schema validation, versioned client (28 tests) (#33)

**Conformance:**
- 16 JSON conformance fixtures for all 5 protocol types (positive/negative/boundary) (#20)
- Cross-runtime conformance harness validating schema validation + gate evaluation (#20)
- Parity tests: deterministic verdicts across all 8 gates (#29)

**CI:**
- `.github/workflows/verity-ci.yml` — test, replay, shadow, release-gate jobs (#34)

### Fixed

- `DockerOciRunner.checkImage` now handles missing binary gracefully (added error handler)
- Parity tests fixed: `EffectGate` import corrected from `../src` to `@praxis/verity-policy`

### Changed

- Test suite: 279 → 568 TypeScript tests, 0 new failures
- Python SDK: 28 pytest tests, all passing
- `ai_summary.md` updated with Verity 1.0 status across all waves

---

## v0.5.1 (unreleased → superseded by v1.0)

### Fixed

- **mcp-server workspace**: Added missing `package.json` and `tsconfig.json` for `@praxis/mcp-server`.
- **Flaky daemon-e2e test**: Increased timeouts for ExecGate subprocess tests.
- **Attestation wiring (PEL-1)**: `signEvidenceRecord()` called from `appendEvidenceRecordJsonl()` when `signingKey` is provided.
- **.gitignore**: Added `.mimocode/`, `bun.lock`, `**/bun.lock`.

### Changed

- **README.md**: Updated test count, clarified attestation wiring.
- **EvidenceGateInput**: Added optional `attestationSecret` field for P1-1 verification.

---

## v0.5.0 — Daemon + MCP + Attestation

- Daemon mode (warm state, incremental evidence index, gate result cache)
- MCP server (stdio JSON-RPC, Content-Length framing)
- Evidence attestation (PEL-1, HMAC-SHA256 DSSE envelopes)
- Lock GC, CLI bun build, 279 tests

---

## v0.1–v0.4 — Foundation

See `git log --oneline` for detailed history of Truth Kernel, Control Plane, Desktop Mission Control, and Intelligence phases.
