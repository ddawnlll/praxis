# PRAXIS v1.0

**Bitti mi gerçekten? — Verify whether the agent actually completed the task.**

PRAXIS is a **local Truth Kernel for agentic coding tools**. It verifies coding-agent outputs using human-approved acceptance criteria, local evidence, deterministic gates, and repair packets.

PRAXIS is **not a coding agent**. It does not write code, run its own agent loops, or compete with Claude Code, MiMo Code, or OpenCode. It sits above them and answers one question: *did the agent actually do what it claimed?*

---

## What's New in v1.0 — Verity

PRAXIS 1.0 introduces **Verity** — a cryptographic verification layer that makes agent output verification tamper-evident, hermetically isolated, and receipt-signed.

| Feature | Description |
|---------|-------------|
| **Protocol v1** | Canonical JSON envelope format with Ed25519 trust store and versioned migration |
| **8-Gate Pipeline** | Admission → Integrity → Scope → Architecture → Effect → Recovery → HermeticExec → FinalReceipt |
| **Signed Receipts** | Ed25519-signed VerificationReceipt with single-use consumption and expiry |
| **Merkle Evidence Ledger** | Append-only ledger with RFC-6962 Merkle tree for tamper-evident evidence chaining |
| **Hermetic Execution** | OCI runner abstraction with isolation policy (network, resource, process) and adapter contracts |
| **Golden Replay Harness** | 6 deterministic scenarios testing recovery, idempotency, effect gating, rollback, kill, and receipt expiry |
| **Fuzz + Fault Injection** | Property-based fuzzing, 6 fault kinds, and fail-closed release gate (300K replay requirement) |
| **Python SDK** | Canonical serialization, Ed25519 crypto, schema validation, and versioned client (28 tests) |
| **CI Workflows** | Test, replay, shadow heartbeat, and release gate jobs |

---

## Project Status

| Milestone | Version | Status | Tests |
|-----------|---------|--------|-------|
| Truth Kernel + CLI + Plugin | v0.1 | ✅ Complete | 167 |
| Control Plane (server, SSE, Circuit Breaker) | v0.2 | ✅ Complete | +12 |
| Desktop Mission Control + Governor | v0.3 | ✅ Complete | — |
| AST analysis, coverage, stable_16 | v0.4 | ✅ Complete | — |
| Daemon + MCP + Attestation (PEL-1) | v0.5 | ✅ Complete | 279 |
| **Verity 1.0 — Cryptographic Verification** | **v1.0** | ✅ **Latest** | **568 TS + 28 Python** |

---

## The Three Laws

```
LAW 1 — COMPLETION AUTHORITY
  Agent says done ≠ done.
  Truth Kernel FinalGate PASS = done.
  Nothing else counts.

LAW 2 — WRITE AUTHORITY
  No worker writes to shared integration files.
  The Deterministic Assembler is the only shared writer.

LAW 3 — VERIFICATION AUTHORITY
  FinalGate criteria come from human-authored TaskSpec only.
  An agent cannot define or verify its own completion criteria.
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  PSAG — PlanSpec Admission Gate                                      │
│  (schema, namespace collision, budget, deps, acceptance_criteria)    │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ ADMIT
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Verity Protocol Layer — Ed25519 trust, Merkle ledger, receipts     │
│  (protocol/v1 envelopes, canonical serialization, single-use)       │
└───────────────────────┬─────────────────────────────────────────────┘
                        │
┌───────────────────────┼─────────────────────────────────────────────┐
│  8-Gate Verification Pipeline                                       │
│  Admission → Integrity → Scope → Architecture →                     │
│  Effect → Recovery → HermeticExec → FinalReceipt                    │
└───────────────────────┬─────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Golden Replay + Qualification                                       │
│  6 scenarios, fuzz/fault injection, 300K replay, 30-day shadow     │
└───────────────────────┬─────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Worker Adapter Layer — Claude Code CLI/SDK, OpenCode, local models │
│  (normalizes all worker output → AttemptManifest)                   │
└───────────────────────┬─────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Truth Kernel — SchemaGate → LockGate → EvidenceGate →              │
│  WiringGate → ExecGate → FinalGate                                  │
│  PASS / HOLD / FAIL                                                 │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ HOLD
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RIM — Repair Intelligence Module                                   │
│  6 strategies across 7 attempts → ABORT                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Packages

| Package | Location | Tests | Description |
|---------|----------|-------|-------------|
| `@praxis/contracts` | `packages/contracts/` | 31 | Shared types, parsers, validators |
| `@praxis/kernel` | `packages/kernel/` | 212 | Truth Kernel (6 gates, evidence, daemon, attestation) |
| `@praxis/cli` | `packages/cli/` | 13 | CLI binary (13 commands) |
| `@praxis/claude-plugin` | `packages/claude-plugin/` | 20 | Claude Code plugin (9 slash commands + 3 hooks) |
| `@praxis/mcp-server` | `packages/mcp-server/` | 3 | MCP server for agent integration |
| `@praxis/protocol` | `packages/protocol/` | — | v1 schemas, canonical, Ed25519, trust store |
| `@praxis/ledger` | `packages/ledger/` | — | Merkle tree, append-only ledger, receipt storage |
| `@praxis/verity-gates` | `packages/verity-gates/` | 122 | 8 Verity gates + attestation + OCI + isolation |
| `@praxis/verity-policy` | `packages/verity-policy/` | — | EffectGate + Hephaestus v0.6 policy pack |
| `@praxis/verity-client` | `packages/verity-client/` | — | Versioned client with promotion binding |
| `@praxis/verity-replay` | `packages/verity-replay/` | — | Golden replay harness (6 scenarios) |
| `@praxis/verity-qual` | `packages/verity-qual/` | — | Fuzz, fault injection, release gate |
| `praxis-verity-client` | `packages/verity-client-python/` | 28 | Python SDK (canonical, crypto, schema, client) |
| **Total** | | **568 TS + 28 Py** | **ALL PASS** |

---

## Quick Start

```bash
# Install dependencies
bun install

# Run all tests
bun test

# Type-check all packages
bun run typecheck

# Initialize PRAXIS in a project
praxis init

# Validate and lock a plan
praxis plan validate --plan .praxis/plan.yaml
praxis plan lock --plan .praxis/plan.yaml

# Run verification (cold path)
praxis verify --plan .praxis/plan.yaml

# Start daemon for fast re-verification
praxis daemon
praxis verify --daemon --plan .praxis/plan.yaml

# Generate report
praxis report show
```

### Python SDK

```python
from praxis_verity_client import VersionedPraxisClient, ClientOptions, validate

# Validate a manifest
result = validate("candidate-manifest-v1", manifest_dict)
assert result.ok

# Create a client and build handshake
client = VersionedPraxisClient(ClientOptions(
    identity_id="my-agent",
    praxis_public_key_hex="...",
    capabilities=["verify.cold"],
))
envelope = client.handshake()
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `praxis init` | Initialize PlanSpec YAML template |
| `praxis plan validate` | Validate PlanSpec schema + semantics |
| `praxis plan lock` | Create/verify plan lock file |
| `praxis plan gc` | Garbage collect old lock files |
| `praxis verify` | Run 6-gate pipeline, persist results |
| `praxis verify --daemon` | Connect to warm daemon |
| `praxis verify --gates` | Gate filter |
| `praxis daemon` | Start persistent daemon server |
| `praxis status` | Show current/previous run status |
| `praxis ledger show` | Display evidence ledger records |
| `praxis report show` | Generate verification report |
| `praxis repair show` | Show repair packet for failed runs |
| `praxis help` | Usage information |
| `praxis version` | Version string |

---

## Manual Verify/Repair Loop

```
1. praxis init                  ← Initialize .praxis/ workspace
2. Define .praxis/task.yaml     ← Human-approved acceptance criteria
3. Let the agent do the work    ← Agent runs independently
4. praxis verify                ← Kernel checks evidence → PASS / HOLD / FAIL
5. If HOLD/FAIL: praxis repair  ← Generate repair packet for failed criteria
6. Let agent fix failures       ← Agent addresses specific criteria
7. praxis verify                ← Re-verify
8. PASS → praxis report         ← Generate audit report
```

---

## Key Design Decisions

| ADR | Decision |
|-----|----------|
| 001 | ACCP is always async — prevents execution deadlock |
| 002 | Assembler is wave-level only — per-task assembly breaks parallelism |
| 003 | stable_16 is the concurrency ceiling |
| 004 | acceptance_criteria is human-authored only — prevents echo chamber (LAW 3) |
| 005 | Claude Code NO-GO → Messages API fallback |
| 013 | Plugin-First Pivot — local Truth Kernel, not desktop orchestrator |

---

## Roadmap

| Version | Focus | Status |
|---------|-------|--------|
| v0.1 | Truth Kernel + CLI + Plugin | ✅ Complete |
| v0.2 | Control Plane (server, SSE, Circuit Breaker) | ✅ Complete |
| v0.3 | Desktop Mission Control + Governor + Assembler | ✅ Complete |
| v0.4 | AST analysis, coverage gates, stable_16 | ✅ Complete |
| v0.5 | Daemon, MCP server, Evidence Attestation (PEL-1) | ✅ Complete |
| **v1.0** | **Verity — 8 gates, signed receipts, hermetic exec, replay, qual** | ✅ **Latest** |
| v1.1 | Real OCI runner in CI, import-graph scope, cross-process replay | 🔜 Future |
| v2.0 | Cloud dashboard, postgres persistence, multi-agent orchestration | 🔜 Future |

---

## What PRAXIS Is Not

- ❌ A coding agent (does not write code, does not run its own agent loop)
- ❌ A Claude Code clone or competitor
- ❌ An OpenCode / MiMo clone
- ❌ "Just a Claude Code plugin" — the kernel is independent; the plugin is a bridge

---

## References

- `architecture.md` — Full architecture baseline
- `docs/decisions.md` — Canonical decision register
- `docs/adr/` — Architecture Decision Records
- `docs/pipelines/` — Pipeline specifications
- `docs/contracts/` — Contract specifications
- `ai_summary.md` — Agent-maintained project state
- `CHANGELOG.md` — Release history
