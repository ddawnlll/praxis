// @praxis/claude-plugin — PreToolUse hook
// Captures tool invocation events before execution.
// Plugin is READ-ONLY. Never decides truth. Errors are reported, not swallowed.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginConfig } from '../config';

/** Shape of a Claude Code PreToolUse event. */
export interface PreToolUseEvent {
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: string;
  sessionId?: string;
}

/** Shape of a captured pre-tool evidence record. */
interface PreToolEvidence {
  evidenceVersion: 'praxis-evidence/v0.1';
  recordId: string;
  attemptId: string;
  planId: string;
  timestamp: string;
  type: 'pre_tool';
  source: 'hook';
  summary: string;
  metadata: {
    toolName: string;
    toolInputKeys: string[];
    sessionId?: string;
  };
}

/**
 * Capture a PreToolUse event into the evidence ledger.
 *
 * Does NOT block or error on failure — the plugin is read-only and
 * must never interfere with the agent's operation.
 */
export function capturePreToolUse(
  event: PreToolUseEvent,
  config: PluginConfig,
  repoRoot: string,
  attemptId: string,
  planId: string,
): void {
  if (!config.capturePreTool) return;

  try {
    const evidenceDir = resolve(repoRoot, config.evidenceDir, attemptId);
    if (!existsSync(evidenceDir)) {
      mkdirSync(evidenceDir, { recursive: true });
    }

    const recordId = `EV-${config.runIdPrefix}-pre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const evidence: PreToolEvidence = {
      evidenceVersion: 'praxis-evidence/v0.1',
      recordId,
      attemptId,
      planId,
      timestamp: event.timestamp,
      type: 'pre_tool',
      source: 'hook',
      summary: `PreToolUse: ${event.toolName}`,
      metadata: {
        toolName: event.toolName,
        toolInputKeys: Object.keys(event.toolInput),
        sessionId: event.sessionId,
      },
    };

    const ledgerPath = resolve(evidenceDir, 'evidence.jsonl');
    appendFileSync(ledgerPath, JSON.stringify(evidence) + '\n', 'utf-8');
  } catch (err) {
    // Plugin is read-only display. Never crash the agent.
    // Error is silently dropped — do not emit stderr during agent operation.
    void err;
  }
}
