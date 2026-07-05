# PRAXIS Implementation Todo List

**Version:** 2.0
**Updated:** 2026-07-05
**Purpose:** Track PRAXIS implementation phases, gates, test counts, and completion.

---

## Progress Summary

| Area | Progress | Status |
|---:|---:|---|
| Architecture baseline | 100% | COMPLETE |
| PlanSpec v0.1 schema | 100% | **PASS_LOCKED** |
| @praxis/contracts (P1) | 100% | **PASS_LOCKED** 31/31 tests |
| @praxis/kernel SchemaGate + LockGate (P2) | 100% | **PASS_LOCKED** 28/28 tests |
| @praxis/kernel EvidenceGate (P3) | 100% | **PASS_LOCKED** 36/36 tests |
| @praxis/kernel WiringGate (P4) | 100% | **PASS_LOCKED** 14/14 tests |
| @praxis/kernel ExecGate (P5) | 100% | **PASS_LOCKED** 12/12 tests |
| @praxis/kernel FinalGate (P6) | 100% | **PASS_LOCKED** 18/18 tests |
| **Kernel sub-total (P2-P6)** | **100%** | **105/105 tests** |
| Report generator | 100% | **COMPLETE** (reportGenerator.ts) |
| Repair packet generator | 100% | **COMPLETE** (repairPacketGenerator.ts) |
| Root workspace monorepo | 100% | **COMPLETE** (root package.json) |
| @praxis/cli | 100% | **COMPLETE** (11 commands, 11 tests) |
| @praxis/claude-plugin | 100% | **COMPLETE** (hooks + slash commands + display, 20 tests) |
| **Total tests** | **167** | **ALL PASS** |

---

## Package Summary

| Package | Files | Tests | Status |
|---------|-------|-------|--------|
| `packages/contracts/` | 12 source files | 31/31 | ✅ PASS_LOCKED |
| `packages/kernel/` | 28 source files | 105/105 | ✅ PASS_LOCKED |
| `packages/cli/` | 1 source file | 11/11 | ✅ COMPLETE |
| `packages/claude-plugin/` | 7 source files | 20/20 | ✅ COMPLETE |

### @praxis/kernel — Gate Inventory

| Gate | File | Tests | Status |
|------|------|-------|--------|
| SchemaGate | `gates/schemaGate.ts` | ~10 tests | ✅ PASS_LOCKED |
| LockGate | `gates/lockGate.ts` | ~10 tests | ✅ PASS_LOCKED |
| EvidenceGate | `gates/evidenceGate.ts` | ~12 tests | ✅ PASS_LOCKED |
| WiringGate | `gates/wiringGate.ts` | ~14 tests | ✅ PASS_LOCKED |
| ExecGate | `gates/execGate.ts` | ~12 tests | ✅ PASS_LOCKED |
| FinalGate | `gates/finalGate.ts` | ~12 tests | ✅ PASS_LOCKED |

### @praxis/kernel — Supporting Modules

| Module | Purpose |
|--------|---------|
| `evidence/` | EvidenceLedger reader/writer/appender/validator, types |
| `wiring/` | Declared unit matcher, export checker, orphan detector, mode validator |
| `executor/` | Command runner (spawn, timeout, output), command validator |
| `final/` | Criterion evaluator (15 verification types), FinalGate types |
| `lock/` | PlanLock create/read/write/verify helpers |
| `report/` | Report generator (Markdown + JSON) |
| `repair/` | Repair packet generator |

### CLI Commands

| Command | Status |
|---------|--------|
| `praxis init` | ✅ Creates PlanSpec YAML template |
| `praxis plan validate` | ✅ Validates PlanSpec schema + semantics |
| `praxis plan lock` | ✅ Creates/verifies plan lock file |
| `praxis verify` | ✅ Runs 6-gate pipeline, persists results |
| `praxis status` | ✅ Shows current/previous run status |
| `praxis ledger show` | ✅ Displays evidence ledger records |
| `praxis report show` | ✅ Generates verification report |
| `praxis repair show` | ✅ Shows repair packet for failed runs |
| `praxis help` | ✅ Usage info |
| `praxis version` | ✅ Version string |

### Plugin Capabilities

| Feature | Status |
|---------|--------|
| Slash commands (9 commands) | ✅ Implemented |
| PreToolUse hook | ✅ Implemented |
| PostToolUse hook | ✅ Implemented |
| Stop handler | ✅ Implemented |
| Verdict display formatting | ✅ Implemented |
| Config reader (JSON/YAML) | ✅ Implemented |

---

## Pipeline Flow

```
PlanSpec YAML
    │
    ▼
SchemaGate (YAML parse → schema validate → semantic validate → hash)
    │ PASS
    ▼
LockGate (create lock → verify lock → hash match → criteria freeze)
    │ PASS
    ▼
EvidenceGate (read JSONL ledger → namespace check → required evidence → diff check)
    │ PASS
    ▼
WiringGate (declared unit match → export check → entrypoint → orphan detect)
    │ PASS
    ▼
ExecGate (validate commands → run → capture output → check results)
    │ PASS
    ▼
FinalGate (evaluate criteria → aggregate verdict → produce report)
    │
    ▼
PASS / HOLD / FAIL  ←  Repair packet generated on failure
```

---

## Future Work (v0.2+)

The following are explicitly deferred from v0.1:

- [ ] AST import graph analysis (TypeScript compiler integration)
- [ ] Server runtime (Hono + HTTP + SSE)
- [ ] Desktop Mission Control (Electron + React)
- [ ] PostgreSQL durable event store
- [ ] Circuit Breaker full automation
- [ ] Multi-worker orchestration
- [ ] Messages API fallback agent loop
- [ ] Network sandboxing per command
- [ ] Coverage tool integration (Istanbul/c8)

---

## Test Suite

| Package | Command | Test Count |
|---------|---------|-----------|
| contracts | `cd packages/contracts && bun test` | 31 |
| kernel | `cd packages/kernel && bun test` | 105 |
| cli | `cd packages/cli && bun test` | 11 |
| claude-plugin | `cd packages/claude-plugin && bun test` | 20 |
| **Total** | | **167** |

```bash
bun test                        # Run all tests
bun run typecheck               # TypeScript check all packages
```

---

## Forbidden Copy List

These must not be copied into PRAXIS implementation:
- `pi/packages/coding-agent`, `agent`, `brain`, `ai`, `db`
- `pi/packages/web-server`, `web-ui`, `tui`, `worker-adapters`, `execution-service`
- Old runtime controller code coupled to DB/Kysely
