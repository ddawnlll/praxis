// @praxis/kernel — ACCP Report Formats
// Dual-format ACCP reports: machine-readable YAML + human-readable Markdown summary.

import YAML from 'yaml';
import type { VerificationReport } from './reportGenerator';

export interface AccpYamlReport {
  accp_version: 'praxis-accp/v0.1';
  report_type: 'verification_report';
  generated_at: string;
  run: {
    attempt_id: string;
    plan_id: string;
    plan_title: string;
    verdict: string;
    ok: boolean;
    started_at: string;
    finished_at: string;
  };
  gates: Array<{
    name: string;
    verdict: string;
    reason_codes: string[];
  }>;
  summary: {
    total_gates: number;
    passed_gates: number;
    held_gates: number;
    failed_gates: number;
    criteria?: {
      total: number;
      passed: number;
      failed: number;
      advisory: number;
      not_evaluated: number;
    };
  };
  diagnostics: Array<{ code: string; severity: string; message: string }>;
}

export function formatReportAccpYaml(report: VerificationReport): string {
  const accp: AccpYamlReport = {
    accp_version: 'praxis-accp/v0.1',
    report_type: 'verification_report',
    generated_at: report.createdAt,
    run: {
      attempt_id: report.attemptId,
      plan_id: report.planId,
      plan_title: report.planTitle,
      verdict: report.verdict,
      ok: report.ok,
      started_at: report.startedAt,
      finished_at: report.finishedAt,
    },
    gates: report.gates.map(g => ({
      name: g.gateName,
      verdict: g.verdict,
      reason_codes: g.reasonCodes,
    })),
    summary: {
      total_gates: report.totalGates,
      passed_gates: report.passedGates,
      held_gates: report.heldGates,
      failed_gates: report.failedGates,
      criteria: report.criterionSummary ? {
        total: report.criterionSummary.total,
        passed: report.criterionSummary.passed,
        failed: report.criterionSummary.failed,
        advisory: report.criterionSummary.advisory,
        not_evaluated: report.criterionSummary.notEvaluated,
      } : undefined,
    },
    diagnostics: report.diagnostics.map(d => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
    })),
  };

  return YAML.stringify(accp, { lineWidth: 120 });
}

export function formatReportAccpSummary(report: VerificationReport): string {
  const lines: string[] = [];
  lines.push(`# PRAXIS Verification Summary`);
  lines.push(``);
  lines.push(`**Plan:** ${report.planTitle}`);
  lines.push(`**Run:** ${report.attemptId}`);
  lines.push(`**Verdict:** ${report.verdict}`);
  lines.push(`**Duration:** ${report.startedAt} → ${report.finishedAt}`);
  lines.push(``);
  lines.push(`## Gates`);
  lines.push(``);
  lines.push(`| Gate | Verdict |`);
  lines.push(`|------|--------|`);
  for (const g of report.gates) {
    lines.push(`| ${g.gateName} | ${g.verdict} |`);
  }
  lines.push(``);
  lines.push(`**${report.passedGates}/${report.totalGates} gates passed**`);
  if (report.heldGates > 0) lines.push(`⚠️ ${report.heldGates} gates held`);
  if (report.failedGates > 0) lines.push(`❌ ${report.failedGates} gates failed`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(report.summary);
  return lines.join('\n');
}
