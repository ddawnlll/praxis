// @praxis/claude-plugin — Stop handler
// Captures session end. Optionally triggers auto-verification.
// Plugin is READ-ONLY. Never decides truth. Errors are reported, not swallowed.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginConfig } from '../config';

/** Shape of a Claude Code Stop event. */
export interface StopEvent {
  timestamp: string;
  sessionId?: string;
  reason?: string;
  /** Whether the agent reported success. CLAIM ONLY — kernel decides. */
  agentReportedSuccess?: boolean;
}

/** Shape of a stop evidence record. */
interface StopEvidence {
  evidenceVersion: 'praxis-evidence/v0.1';
  recordId: string;
  attemptId: string;
  planId: string;
  timestamp: string;
  type: 'stop';
  source: 'hook';
  summary: string;
  metadata: {
    reason?: string;
    agentReportedSuccess?: boolean;
    sessionId?: string;
  };
}

/**
 * Handle a session Stop event.
 *
 * 1. Writes a stop record into the evidence ledger.
 * 2. Optionally triggers auto-verification (config.autoVerifyOnStop).
 *
 * Does NOT block or error on failure.
 */
export function handleStop(
  event: StopEvent,
  config: PluginConfig,
  repoRoot: string,
  attemptId: string,
  planId: string,
): { captured: boolean; autoVerifyTriggered: boolean; error?: string } {
  let captured = false;
  let autoVerifyTriggered = false;

  try {
    const evidenceDir = resolve(repoRoot, config.evidenceDir, attemptId);
    if (!existsSync(evidenceDir)) {
      mkdirSync(evidenceDir, { recursive: true });
    }

    // Write stop record
    const recordId = `EV-${config.runIdPrefix}-stop-${Date.now()}`;
    const evidence: StopEvidence = {
      evidenceVersion: 'praxis-evidence/v0.1',
      recordId,
      attemptId,
      planId,
      timestamp: event.timestamp,
      type: 'stop',
      source: 'hook',
      summary: `Session stopped: ${event.reason ?? 'normal'}. Agent claimed success: ${event.agentReportedSuccess ?? false}`,
      metadata: {
        reason: event.reason,
        agentReportedSuccess: event.agentReportedSuccess,
        sessionId: event.sessionId,
      },
    };

    const ledgerPath = resolve(evidenceDir, 'evidence.jsonl');
    appendFileSync(ledgerPath, JSON.stringify(evidence) + '\n', 'utf-8');
    captured = true;

    // Auto-verify trigger (configurable)
    if (config.autoVerifyOnStop) {
      // The actual exec happens in the slash command layer.
      // Here we just flag that it should be triggered.
      autoVerifyTriggered = true;
      const flagPath = resolve(evidenceDir, '.auto_verify');
      appendFileSync(flagPath, `${event.timestamp}\n`, 'utf-8');
    }

    return { captured, autoVerifyTriggered };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { captured: false, autoVerifyTriggered: false, error: msg };
  }
}
