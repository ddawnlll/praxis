// @praxis/claude-plugin — Verdict formatting for Claude Code display
// Formats gate verdicts, reason codes, and diagnostics for human-readable
// display within Claude Code conversations.
// Plugin is READ-ONLY. Never decides truth.

import type {
  GateVerdictValue,
  AnyGateResult,
} from '@praxis/kernel';

/** Styled verdict label. */
export function formatVerdictBadge(verdict: GateVerdictValue): string {
  switch (verdict) {
    case 'PASS':
      return '✅ PASS';
    case 'HOLD':
      return '⚠️ HOLD';
    case 'FAIL':
      return '❌ FAIL';
    default:
      return `❓ ${verdict}`;
  }
}

/** Format a single gate verdict line. */
export function formatGateLine(gateName: string, verdict: GateVerdictValue): string {
  return `${formatVerdictBadge(verdict)} — ${gateName}`;
}

/** Format reason codes for display. */
export function formatReasonCodes(codes: string[]): string {
  if (codes.length === 0) return '';
  return codes.map(c => `  ▪ ${c}`).join('\n');
}

/** Format a full gate result block. */
export function formatGateResult(gv: AnyGateResult): string {
  const lines: string[] = [];
  lines.push(formatGateLine(gv.gateName, gv.verdict));

  if (gv.reasonCodes && gv.reasonCodes.length > 0) {
    lines.push(formatReasonCodes(gv.reasonCodes));
  }

  // EvidenceGate-specific fields — cast via unknown per TS strict mode
  const eg = gv as unknown as Record<string, unknown>;
  if (typeof eg.evidenceCount === 'number') {
    lines.push(`  📄 Evidence records: ${eg.evidenceCount}`);
  }
  if (Array.isArray(eg.forbiddenFilesTouched) && (eg.forbiddenFilesTouched as unknown[]).length > 0) {
    lines.push('  🚫 Forbidden files touched:');
    for (const f of eg.forbiddenFilesTouched as string[]) {
      lines.push(`    - ${f}`);
    }
  }
  if (Array.isArray(eg.namespaceViolations) && (eg.namespaceViolations as unknown[]).length > 0) {
    lines.push('  📛 Namespace violations:');
    for (const f of eg.namespaceViolations as string[]) {
      lines.push(`    - ${f}`);
    }
  }
  if (eg.diffEmpty) {
    lines.push('  ⚠️ Diff evidence is empty');
  }

  // ExecGate-specific fields
  if (Array.isArray(eg.commandResults)) {
    const crs = eg.commandResults as Array<Record<string, unknown>>;
    lines.push(`  🔧 Commands executed: ${crs.length}`);
    for (const cr of crs) {
      const icon = cr.verdict === 'PASS' ? '✓' : cr.verdict === 'FAIL' ? '✗' : '?';
      lines.push(`    ${icon} ${cr.command as string}: ${cr.verdict as string} (exit ${cr.exitCode as number}/${cr.exitSignal as string ?? 'none'})`);
    }
  }

  return lines.join('\n');
}

/** Format a full kernel result for display. */
export function formatKernelResult(result: {
  verdict: GateVerdictValue;
  attemptId: string;
  gateVerdicts: AnyGateResult[];
  diagnostics?: Array<{ code: string; severity: string; message: string }>;
}): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════');
  lines.push(`  PRAXIS Verification: ${formatVerdictBadge(result.verdict)}`);
  lines.push(`  Run ID: ${result.attemptId}`);
  lines.push('═══════════════════════════════════════════════');
  lines.push('');

  lines.push('📋 Gate Results:');
  for (const gv of result.gateVerdicts) {
    lines.push('');
    lines.push(formatGateResult(gv));
  }

  lines.push('');
  lines.push('───────────────────────────────────────────────');

  // Summary
  const passCount = result.gateVerdicts.filter(g => g.verdict === 'PASS').length;
  const holdCount = result.gateVerdicts.filter(g => g.verdict === 'HOLD').length;
  const failCount = result.gateVerdicts.filter(g => g.verdict === 'FAIL').length;
  lines.push(`  Summary: ${passCount} PASS, ${holdCount} HOLD, ${failCount} FAIL`);
  lines.push(`  Overall: ${formatVerdictBadge(result.verdict)}`);

  if (result.verdict === 'HOLD') {
    lines.push('');
    lines.push('  ⏳ Some gates are HOLD — review the reason codes above.');
    lines.push('  HOLD means the kernel needs more data or human input.');
  } else if (result.verdict === 'FAIL') {
    lines.push('');
    lines.push('  ❌ Verification FAILED — some gates blocked completion.');
    lines.push('  Review the failed gates and their reason codes.');
    lines.push('  Fix the issues before re-running verification.');
  } else {
    lines.push('');
    lines.push('  ✅ All gates passed. The task is verified complete.');
  }

  if (result.diagnostics && result.diagnostics.length > 0) {
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    const warnings = result.diagnostics.filter(d => d.severity === 'warning');
    if (errors.length > 0 || warnings.length > 0) {
      lines.push('');
      lines.push(`  📝 Diagnostics: ${errors.length} errors, ${warnings.length} warnings`);
    }
  }

  return lines.join('\n');
}
