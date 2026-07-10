# Changelog

All notable changes to PRAXIS are documented here.

## v0.5.1 (unreleased)

### Fixed

- **mcp-server workspace**: Added missing `package.json` and `tsconfig.json` for `@praxis/mcp-server`; included in root workspace so `bun install` works on a fresh clone.
- **Flaky daemon-e2e test**: Increased timeouts for ExecGate subprocess tests (240s full pipeline, 120s cache test) — ExecGate runs real `bun test` + `curl` commands that exceed the default 5s limit.
- **Attestation wiring (PEL-1)**: `signEvidenceRecord()` is now called from `appendEvidenceRecordJsonl()` when a `signingKey` is provided. `readEvidenceLedgerJsonl()` detects DSSE envelopes and verifies signatures. `EvidenceGate` checks attestation failures and returns `ATTESTATION_FAILED` when a secret is configured.
- **.gitignore**: Added `.mimocode/`, `bun.lock`, and `**/bun.lock` to keep the working tree clean.

### Changed

- **README.md**: Updated test count (259→279), clarified attestation is now runtime-wired into appendEvidenceRecordJsonl and EvidenceGate.
- **EvidenceGateInput**: Added optional `attestationSecret` field for PEL-1 verification.
- **diagnostics.ts**: Added `ATTESTATION_FAILED` reason code for evidence gate.
