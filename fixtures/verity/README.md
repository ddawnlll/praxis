# Verity 1.0 Conformance Fixtures (#20)

This directory holds the golden protocol fixtures for praxis-protocol/v1.
Every contract has positive, negative, and boundary fixtures. The fixture
tests in `packages/protocol/test/schemas.spec.ts` verify every fixture.

## Fixture inventory

| Contract | Positive | Negative | Boundary |
|----------|----------|----------|----------|
| ProtocolEnvelope | 1 | 4 | 0 |
| VerificationPolicy | 1 | 3 | 0 |
| CandidateManifest | 1 | 3 | 0 |
| EvidenceBundle | 1 | 2 | 0 |
| VerificationReceipt | 1 | 4 | 0 |

Negative fixtures cover: missing required fields, wrong protocol version,
additional properties, bad hash format, bad signature value.

## Cross-runtime canonicalization

The TypeScript canonical serializer (`@praxis/protocol`) produces byte-
identical output for equivalent objects. When a Python SDK is added, the
cross-runtime test must verify that Python and TypeScript produce the
same canonical bytes for the same logical input.
