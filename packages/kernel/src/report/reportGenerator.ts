// @praxis/kernel — Report Generator
// Generates verification reports from kernel pipeline results.
// Produces both machine-readable JSON and human-readable text.

import type { Diagnostic } from '@praxis/contracts';
import type {
  KernelResult,
  GateVerdictValue,
  AnyGateResult,
} from '../types';
import { now } from '../diagnostics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationReport {
  reportVersion: 'praxis-report/v0.1';
  attemptId: string;
  planId: string;
  planTitle: string;
  verdict: GateVerdictValue;
  ok: boolean;
  createdAt: string;
  startedAt: string;
  finishedAt: string;

  gates: GateReportEntry[];
  totalGates: number;
  passedGates: number;
  heldGates: number;
  failedGates: number;

  diagnostics: Diagnostic[];

  // Summary
  summary: string;
  criterionSummary?: CriterionSummary;
}

export interface GateReportEntry {
  gateName: string;
  verdict: GateVerdictValue;
  reasonCodes: string[];
  repairHint?: string;
}

export interface CriterionSummary {
  total: number;
  passed: number;
  failed: number;
  advisory: number;
  notEvaluated: number;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function verdictSummary(verdict: GateVerdictValue): string {
  switch (verdict) {
    case 'PASS': return 'All gates passed. The task is complete per PRAXIS Law 1.';
    case 'HOLD': return 'Some gates returned HOLD. The task may not be complete — review the details and repair if needed.';
    case 'FAIL': return 'One or more gates FAILED. The task is not complete. Repair required before re-verification.';
  }
}

function countByVerdict(gates: AnyGateResult[], v: GateVerdictValue): number {
  return gates.filter(g => g.verdict === v).length;
}

/**
 * Generate a structured verification report from a kernel pipeline result.
 */
export function generateReport(result: KernelResult): VerificationReport {
  const gates: GateReportEntry[] = result.gateVerdicts.map(gv => ({
    gateName: gv.gateName,
    verdict: gv.verdict,
    reasonCodes: gv.reasonCodes,
    repairHint: 'repairHint' in gv ? (gv as any).repairHint as string | undefined : undefined,
  }));

  let criterionSummary: CriterionSummary | undefined;
  if (result.final) {
    criterionSummary = {
      total: result.final.totalCriteria,
      passed: result.final.passedCriteria,
      failed: result.final.failedCriteria,
      advisory: result.final.advisoryCriteria,
      notEvaluated: result.final.notEvaluatedCriteria,
    };
  }

  return {
    reportVersion: 'praxis-report/v0.1',
    attemptId: result.attemptId,
    planId: result.plan?.metadata?.planId ?? 'unknown',
    planTitle: result.plan?.metadata?.title ?? 'Untitled Plan',
    verdict: result.verdict,
    ok: result.ok,
    createdAt: now(),
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    gates,
    totalGates: gates.length,
    passedGates: countByVerdict(result.gateVerdicts, 'PASS'),
    heldGates: countByVerdict(result.gateVerdicts, 'HOLD'),
    failedGates: countByVerdict(result.gateVerdicts, 'FAIL'),
    diagnostics: result.diagnostics,
    summary: verdictSummary(result.verdict),
    criterionSummary,
  };
}

/**
 * Format a verification report as human-readable Markdown text.
 */
export function formatReportMarkdown(report: VerificationReport): string {
  const lines: string[] = [];

  lines.push(`# PRAXIS Verification Report`);
  lines.push(``);
  lines.push(`**Plan:** ${report.planTitle} (${report.planId})`);
  lines.push(`**Run ID:** ${report.attemptId}`);
  lines.push(`**Verdict:** ${verdictBadge(report.verdict)}`);
  lines.push(`**Started:** ${report.startedAt}`);
  lines.push(`**Finished:** ${report.finishedAt}`);
  lines.push(``);
  lines.push(`## Gate Results`);
  lines.push(``);
  lines.push(`| Gate | Verdict | Reason Codes |`);
  lines.push(`|------|---------|--------------|`);
  for (const g of report.gates) {
    const codes = g.reasonCodes.length > 0 ? g.reasonCodes.join(', ') : '—';
    lines.push(`| ${g.gateName} | ${g.verdict} | ${codes} |`);
  }
  lines.push(``);

  lines.push(`**Summary:** ${report.passedGates}/${report.totalGates} gates passed`);
  if (report.heldGates > 0) lines.push(`**Held:** ${report.heldGates} gates`);
  if (report.failedGates > 0) lines.push(`**Failed:** ${report.failedGates} gates`);
  lines.push(``);

  if (report.criterionSummary) {
    const cs = report.criterionSummary;
    lines.push(`## Acceptance Criteria`);
    lines.push(``);
    lines.push(`- **Total:** ${cs.total}`);
    lines.push(`- **Passed:** ${cs.passed}`);
    lines.push(`- **Failed:** ${cs.failed}`);
    lines.push(`- **Advisory:** ${cs.advisory}`);
    lines.push(`- **Not evaluated:** ${cs.notEvaluated}`);
    lines.push(``);
  }

  lines.push(`## Summary`);
  lines.push(``);
  lines.push(report.summary);
  lines.push(``);

  if (report.diagnostics.length > 0) {
    lines.push(`## Diagnostics`);
    lines.push(``);
    for (const d of report.diagnostics) {
      lines.push(`- [${d.severity}] ${d.message}`);
    }
    lines.push(``);
  }

  return lines.join('\n');
}

function verdictBadge(v: GateVerdictValue): string {
  switch (v) {
    case 'PASS': return '✅ PASS';
    case 'HOLD': return '⚠️ HOLD';
    case 'FAIL': return '❌ FAIL';
  }
}
