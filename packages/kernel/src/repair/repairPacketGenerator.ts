// @praxis/kernel — Repair Packet Generator
// Generates structured repair packets from FinalGate or gate pipeline failures.
// Repair packets are consumed by agents (machine-readable JSON) and formatted for human review.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type {
  GateVerdictValue,
  AnyGateResult,
  PlanLockV01,
} from '../types';
import type { CriterionResult } from '../final/types';
import { now } from '../diagnostics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepairPacket {
  packetVersion: 'praxis-repair/v0.1';
  attemptId: string;
  planId: string;
  createdAt: string;

  /** Overall verdict that triggered repair. */
  triggerVerdict: GateVerdictValue;

  /** Gates that produced non-PASS verdicts. */
  failedGates: RepairGateEntry[];

  /** Failed acceptance criteria. */
  failedCriteria: RepairCriterionEntry[];

  /** HINT or INFO criteria (advisory, not blocking). */
  advisoryCriteria: RepairCriterionEntry[];

  /** Suggested repair strategies in priority order. */
  strategies: RepairStrategy[];

  /** Files that may need changes (from namespace violations or failed criteria). */
  affectedFiles: string[];

  /** Human-readable summary. */
  summary: string;

  /** Raw diagnostics from the gate pipeline. */
  diagnostics: Diagnostic[];
}

export interface RepairGateEntry {
  gateName: string;
  verdict: GateVerdictValue;
  reasonCodes: string[];
  repairHint?: string;
}

export interface RepairCriterionEntry {
  criterionId: string;
  taskId: string;
  verdict: string;
  detail: string;
  reasonCodes: string[];
}

export type RepairStrategyKind =
  | 'initial'
  | 'context_expand'
  | 'tool_restrict'
  | 'scope_narrow'
  | 'knowledge_inject'
  | 'hint_inject';

export interface RepairStrategy {
  kind: RepairStrategyKind;
  description: string;
  actions: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the best repair strategy kind based on which gates failed.
 */
function suggestStrategies(
  failedGates: RepairGateEntry[],
  failedCriteria: RepairCriterionEntry[],
): RepairStrategy[] {
  const strategies: RepairStrategy[] = [];
  const gateNames = new Set(failedGates.map(g => g.gateName));

  // Start with initial strategy
  strategies.push({
    kind: 'initial',
    description: 'Standard repair — fix the specific failures identified below.',
    actions: [
      'Review each failed criterion and its evidence.',
      'Make targeted code changes to address the failures.',
      'Re-run verification after changes.',
    ],
  });

  // SchemaGate failures — broad context
  if (gateNames.has('SchemaGate')) {
    strategies.push({
      kind: 'context_expand',
      description: 'Schema validation failed. Review the plan specification.',
      actions: [
        'Check plan YAML syntax and schema compliance.',
        'Ensure all required fields are present.',
        'Validate against the PlanSpec schema.',
      ],
    });
  }

  // EvidenceGate failures — context expansion
  if (gateNames.has('EvidenceGate')) {
    strategies.push({
      kind: 'tool_restrict',
      description: 'Evidence collection may be incomplete.',
      actions: [
        'Ensure diff evidence is generated for code changes.',
        'Run tests to produce test_output evidence.',
        'Check that file changes stay within allowed namespaces.',
        'Avoid modifying forbidden files.',
      ],
    });
  }

  // ExecGate failures — tool use restrictions
  if (gateNames.has('ExecGate')) {
    strategies.push({
      kind: 'tool_restrict',
      description: 'Command execution had issues.',
      actions: [
        'Only run commands listed in plan.commands.exactAllowedCommands.',
        'Avoid watch-mode or long-running commands.',
        'Ensure commands complete within their configured timeout.',
        'Do not use forbidden/denied commands.',
      ],
    });
  }

  // WiringGate failures
  if (gateNames.has('WiringGate')) {
    strategies.push({
      kind: 'scope_narrow',
      description: 'Wiring/structural issues detected.',
      actions: [
        'Ensure all declared units exist on the filesystem.',
        'Create missing export surfaces and entrypoints.',
        'Remove or register orphan modules.',
        'Verify mode consistency with declarations.',
      ],
    });
  }

  // Failed criteria — scope_narrow
  if (failedCriteria.length > 0) {
    strategies.push({
      kind: 'scope_narrow',
      description: `${failedCriteria.length} criteria failed. Focus on each one.`,
      actions: failedCriteria.map(fc =>
        `Fix criterion ${fc.criterionId}: ${fc.detail}`
      ),
    });
  }

  // Add hint_inject as final strategy
  strategies.push({
    kind: 'hint_inject',
    description: 'General guidance for re-verification.',
    actions: [
      'Run "praxis verify" after making changes to confirm fixes.',
      'Check that all acceptance criteria are addressed.',
      'Ensure human approval flag is set where needed.',
    ],
  });

  return strategies;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate a repair packet from a kernel pipeline result.
 * Returns undefined if repair is not needed (all gates PASS).
 */
export function generateRepairPacket(
  plan: PlanSpecV01 | undefined,
  planHashes: PlanHashes | undefined,
  attemptId: string,
  gateVerdicts: AnyGateResult[],
  criterionResults: CriterionResult[] | undefined,
  diagnostics: Diagnostic[],
): RepairPacket | undefined {
  const failedGates: RepairGateEntry[] = [];
  for (const gv of gateVerdicts) {
    if (gv.verdict !== 'PASS') {
      failedGates.push({
        gateName: gv.gateName,
        verdict: gv.verdict,
        reasonCodes: gv.reasonCodes,
        repairHint: 'repairHint' in gv ? (gv as any).repairHint as string | undefined : undefined,
      });
    }
  }

  // If all gates PASS, no repair needed
  if (failedGates.length === 0) return undefined;

  const failedCriteria: RepairCriterionEntry[] = [];
  const advisoryCriteria: RepairCriterionEntry[] = [];
  const affectedFilesSet = new Set<string>();

  if (criterionResults) {
    for (const cr of criterionResults) {
      const entry: RepairCriterionEntry = {
        criterionId: cr.criterionId,
        taskId: cr.taskId,
        verdict: cr.verdict,
        detail: cr.detail,
        reasonCodes: cr.reasonCodes,
      };
      if (cr.advisory || cr.verdict === 'INFO') {
        advisoryCriteria.push(entry);
      } else if (cr.verdict !== 'PASS') {
        failedCriteria.push(entry);
      }
    }
  }

  // Collect affected files from any namespace violations in evidence gate
  for (const gv of gateVerdicts) {
    if (gv.gateName === 'EvidenceGate') {
      const eg = gv as any;
      if (eg.namespaceViolations) {
        for (const f of eg.namespaceViolations as string[]) affectedFilesSet.add(f);
      }
      if (eg.forbiddenFilesTouched) {
        for (const f of eg.forbiddenFilesTouched as string[]) affectedFilesSet.add(f);
      }
    }
  }

  const triggerVerdict: GateVerdictValue =
    failedGates.some(g => g.verdict === 'FAIL') ? 'FAIL' :
    failedGates.some(g => g.verdict === 'HOLD') ? 'HOLD' :
    'FAIL';

  const strategies = suggestStrategies(failedGates, failedCriteria);

  return {
    packetVersion: 'praxis-repair/v0.1',
    attemptId,
    planId: plan?.metadata?.planId ?? 'unknown',
    createdAt: now(),
    triggerVerdict,
    failedGates,
    failedCriteria,
    advisoryCriteria,
    strategies,
    affectedFiles: [...affectedFilesSet],
    summary: `Repair packet generated for attempt ${attemptId}. ${failedGates.length} gate(s) non-passing, ${failedCriteria.length} criterion/criteria failed.`,
    diagnostics,
  };
}
