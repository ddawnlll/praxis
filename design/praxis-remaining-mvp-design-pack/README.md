# PRAXIS Remaining MVP Architecture Design Pack

**Generated:** 2026-06-20  
**Generator:** Claude Fable 5 (GLM 5.2) — ACCP-PRAXIS-REMAINING-DESIGN-PACK-GLM52-MAX  
**Mode:** Design only — no implementation, no code mutation  
**Purpose:** Complete remaining MVP architecture from P3 onward  

## Documents

| # | Document | Purpose |
|---|----------|---------|
| 00 | [Executive Summary](00-executive-summary.md) | High-level verdict, current state, remaining architecture, recommended path |
| 01 | [Current State Map](01-current-state-map.md) | What is already locked/implemented and what is not |
| 02 | [Truth Kernel Pipeline](02-truth-kernel-pipeline.md) | Complete pipeline design: SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate |
| 03 | [EvidenceGate Design](03-evidencegate-design.md) | EvidenceGate v0.1 design, inputs, outputs, HOLD/FAIL/PASS semantics |
| 04 | [EvidenceLedger v0.1 Contract](04-evidenceledger-v0.1.contract.yaml) | Proposed EvidenceLedger v0.1 contract/schema in YAML |
| 05 | [WiringGate Design](05-wiringgate-design.md) | WiringGate v0.1 design and future advanced split |
| 06 | [ExecGate Design](06-execgate-design.md) | ExecGate command runner, safety, validation, timeout, evidence capture |
| 07 | [FinalGate Design](07-finalgate-design.md) | FinalGate aggregation model and final verdict policy |
| 08 | [RepairPacket v0.1 Contract](08-repairpacket-v0.1.contract.yaml) | RepairPacket v0.1 contract/schema in YAML |
| 09 | [Report Model](09-report-model.md) | ACCP report and runtime report model |
| 10 | [CLI Workflow](10-cli-workflow.md) | CLI commands and user workflow design, without implementation |
| 11 | [Claude Plugin Bridge](11-claude-plugin-bridge.md) | Claude Code plugin bridge design, commands, boundaries, safety |
| 12 | [MVP Phase Roadmap](12-mvp-phase-roadmap.md) | P3 onward implementation roadmap with acceptance criteria per phase |
| 13 | [Risk Register](13-risk-register.md) | Risks, false PASS/false HOLD risks, overengineering risks, mitigation |
| 14 | [Design Scorecard](14-design-scorecard.accp.yaml) | ACCP-style scorecard for the proposed remaining design |

## Key Design Decisions

1. **EvidenceLedger is JSONL, not YAML** — append-only streaming format matches evidence capture semantics
2. **EvidenceGate verifies namespace compliance, not task correctness** — boundary integrity before semantic checks
3. **WiringGate is v0.1-lite** — static declared-unit matching only; full AST/import-graph deferred to v0.2+
4. **ExecGate uses PlanSpec commands exclusively** — no free-form shell; command safety via exactAllowedCommands
5. **FinalGate aggregates deterministic evidence only** — advisory/LLM evidence cannot produce PASS
6. **RepairPacket is JSON output** — machine-first, no markdown parsing needed
7. **ACCP reports are YAML with embedded summaries** — YAML for machine, summary.md for humans
8. **CLI is a thin orchestrator** — delegates to kernel library, no gate logic
9. **Plugin bridge is read-only display + slash command dispatch** — plugin never decides truth
10. **Phase roadmap has 4 implementation phases (P3-P6)** — each with explicit acceptance criteria

## Hard Constraints Enforced

- PlanSpec remains YAML with `kind: ImplementationPlan`
- Canonical schema: `schemas/planspec.v0.1.schema.yaml` — unchanged
- @praxis/contracts is the parser/validator boundary — unchanged
- SchemaGate + LockGate are locked — not redesigned
- No implementation code written
- No existing source files modified

## Status

- **Design pack directory:** `design/praxis-remaining-mvp-design-pack/`
- **Zip archive:** `design/praxis-remaining-mvp-design-pack.zip`
- **ACCP report:** `reports/accp/remaining-mvp-design-pack.accp.yaml`
- **Current phase:** Design complete — ready for P3 implementation
