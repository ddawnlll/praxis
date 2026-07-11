# Verity 1.0 — Architecture, Threat Model, and Reliability SLOs

> **Issue:** #14 — Lock the Verity 1.0 authority model, eight-gate
> architecture, threat model, and measurable reliability objectives.
>
> This document is the canonical authority description. It is exercised
> by deterministic tests in `packages/verity-qual/test/architecture.spec.ts`.

## 1. Authority Model

There is **exactly one** completion authority and one signed-receipt
path. They are:

| Concept | Implementation |
|---------|----------------|
| Completion authority | `FinalReceiptGate` (`@praxis/verity-gates/finalReceipt`) |
| Signed receipt path | `VerificationReceipt` schema + Ed25519 signature |
| Signing algorithm | Ed25519 via Node's built-in `crypto` (no new deps) |
| Receipt verifier | Independent of the issuer; re-hashes canonical bytes and verifies |
| Single-use enforcement | `singleUseKeyId` + `consumedAt` on the receipt |

Any path that produces a `PASS` verdict without going through every
required gate in the eight-gate pipeline is **out of policy** and the
verifier must reject the resulting receipt. There is no "advisory PASS";
a `HOLD` is not a `PASS`.

## 2. Eight-Gate Pipeline

The authoritative runtime is a single pipeline with the following
ordered gates:

```
[admission] → [integrity] → [scope] → [architecture] → [effect]
          → [recovery]   → [hermeticExec] → [finalReceipt]
```

Each gate emits a `GateResult { gate, verdict, reasonCode, producedAt }`.
A `verdict` is one of `PASS | HOLD | FAIL`. The `FinalReceiptGate`
aggregates results and only emits a `VerificationReceipt` when **every
required** gate is `PASS`.

The `Hephaestus v0.6 policy pack` is the default effect policy.

## 3. Trust Roots

| Trust root | Source | Lifetime |
|------------|--------|----------|
| `praxis-protocol/v1` | Hard-coded in `@praxis/protocol` | Until v2 is published |
| Ed25519 issuer keys | `@praxis/protocol` trust store (`TrustStore`) | Bounded by `notBefore` / `notAfter` |
| Hephaestus v0.6 policy | `@praxis/verity-policy` `hepheastusV06()` factory | Pinned per `policyId` |
| OCI runner image digest | `attestation.runnerDigest` (set by #19/#24) | Bounded by `expiresAt` |

A `MISSING` or `UNTRUSTED` trust root always produces `FAIL`, never
`PASS`. There is no "default PASS" path.

## 4. Threat Model

| Threat | Surface | Mitigation |
|--------|---------|-----------|
| Tampering with evidence | On-disk ledger | Merkle root in header, `verifyIntegrity()` (#18) |
| Replay of a receipt | Promotion engine | `singleUseKeyId` + `consumedAt` (#28) |
| Stale base | Promotion engine | Compare-and-swap `baseHash` (#27) |
| Compromised worker | Admission | `TrustStore.resolve()` checks revoke + expiry (#17) |
| Crash mid-promotion | Daemon | Idempotency key + crash-replay state (#27) |
| Disk-full | Storage | Atomic write via staging + rename; failure surfaces as `FAIL` |
| Concurrent promotion | Race | Single-writer per `candidateId`; CAS on `baseHash` |
| Authority-bearing agent claim | Anywhere | Schemas reject `agent.authored` markers; `gateResults` must come from named gates |
| Cross-context signature reuse | Signing | Domain separation: `DOMAIN || canonical_bytes` (#17) |
| Symlink escape | File scope | `realpath` + `path.relative` containment (#22) |

## 5. Reliability SLOs

Numeric, machine-checkable thresholds. Every row below is enforced by
`@praxis/verity-qual`'s `evaluateReleaseGate()` (see
`scripts/verity-release-gate.ts`).

| SLO | Numeric target | Measurement |
|-----|----------------|-------------|
| False PASS rate | **0** in the locked sample plan | `reports/verity/release-gate.md` |
| Replay iterations | **300,000** adversarial false-PASS replays | `evaluateReleaseGate().replayArtifact` |
| Shadow period | **30-day** minimum | `evaluateReleaseGate().shadowArtifact` |
| Critical incidents in shadow | **0** | `evaluateReleaseGate().shadowArtifact` |
| Verdict determinism | byte-identical for repeated identical inputs | `packages/verity-qual/test/determinism.spec.ts` |
| Receipt verification | 100% — no mutable process state | `verifyReceipt()` in `@praxis/verity-gates/finalReceipt` |
| Receipt expiry | `expiresAt` enforced by verifier | `#28` |
| Single-use | second consumption is `FAIL` | `#28` |
| Cross-platform parity | Linux + macOS | `.github/workflows/verity-ci.yml` (W7 #34) |
| Recovery replay | 0 lost receipts across crash | `packages/verity-replay/test/recovery.spec.ts` (#32) |

## 6. State-of-Record Boundary

PRAXIS owns the **receipt state-of-record**: the canonical, signed
`VerificationReceipt` is the only artifact a downstream promotion engine
must trust. Hephaestus and the human operator are upstream
contributors; they do not own receipt state. Anything that wants to
"approve" or "promote" must present a current, valid, unconsumed
`VerificationReceipt` whose `baseHash` matches the active state and
whose `merkleRoot` is bound to the evidence.

## 7. What this document guarantees (AC cross-reference)

| AC | Tested by |
|----|-----------|
| AC-1: one completion authority + signed receipt path | `packages/verity-qual/test/architecture.spec.ts` ("there is exactly one signing path") |
| AC-2: threat model covers all 7 listed failure modes | `packages/verity-qual/test/architecture.spec.ts` ("threat matrix completeness") |
| AC-3: qualification thresholds numeric and machine-checkable | `scripts/verity-release-gate.ts` (fail-closed on threshold violation) |
