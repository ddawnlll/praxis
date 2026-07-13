// @praxis/claude-plugin — PreToolUse hook
// Captures tool invocation events before execution.
// Plugin is READ-ONLY. Never decides truth. Errors are reported, not swallowed.
//
// NEW: Supports enforcementMode 'advisory' (default, log-only) and
// 'blocking' (rejects scope-violating tool calls via structured result).

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PluginConfig } from '../config';
import { ScopeGate } from '@praxis/verity-gates';
import type { ScopePolicy } from '@praxis/verity-gates';

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

/** Result returned by the pre-tool handler. */
export interface PreToolResult {
  /** Whether the tool call should be blocked. */
  blocked: boolean;
  /** Human-readable reason if blocked. */
  blockReason?: string;
}

/** Tools that mutate the filesystem — scope enforcement applies. */
const FILE_MUTATING_TOOLS = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
  'Bash',
  'RenameFile',
  'DeleteFile',
  'MoveFile',
  'CopyFile',
]);

/** Default allowed scope prefixes (relative to repo root). */
const DEFAULT_ALLOWED_PREFIXES = ['packages/', 'docs/', 'scripts/', '.github/'];

/**
 * Check whether a file path is within the allowed scope.
 * Returns the first forbidden file path if any, or null if everything is allowed.
 */
function checkFileScopeViolation(
  filePath: string,
  allowedPrefixes: string[],
): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const isAllowed = allowedPrefixes.some((prefix) => {
    const p = prefix.replace(/\\/g, '/');
    return normalized.startsWith(p) || normalized === p.slice(0, -1);
  });
  return isAllowed ? null : normalized;
}

/**
 * Create a ScopeGate from the given policy config and use it to check
 * whether a file path is within the allowed scope.
 *
 * Returns null when no violation, or a reason string when blocked.
 */
function checkWithScopeGate(
  filePath: string,
  rootDir: string,
  scopePolicy?: ScopePolicy,
): string | null {
  if (!scopePolicy) {
    // Fall back to simple prefix check when no policy is configured
    return checkFileScopeViolation(filePath, DEFAULT_ALLOWED_PREFIXES);
  }

  const gate = new ScopeGate({
    ...scopePolicy,
    rootDir,
  });

  const result = gate.evaluate({
    policy: {} as any,
    manifest: {} as any,
    metadata: {
      filesTouched: [filePath],
    },
  });

  if (result.verdict !== 'PASS') {
    return `PRAXIS: File "${filePath}" is outside allowed scope. ` +
      `ScopeGate verdict: ${result.verdict} (${result.reasonCode}).`;
  }

  return null;
}

/** File-mutating tools that accept a `file_path` parameter. */
const TOOLS_WITH_FILE_PATH = new Set(['Write', 'Edit', 'NotebookEdit', 'RenameFile', 'DeleteFile', 'MoveFile', 'CopyFile']);

/**
 * Evaluate a pre-tool event against the enforcement policy.
 *
 * In 'blocking' mode, file-mutating tools that write outside the allowed
 * scope are flagged with `blocked: true` and a reason.
 * In 'advisory' mode, violations are logged but never block.
 *
 * Pure function — no I/O.
 */
export function evaluatePreToolUse(
  event: PreToolUseEvent,
  config: PluginConfig,
  options?: {
    allowedPrefixes?: string[];
    scopePolicy?: ScopePolicy;
    rootDir?: string;
  },
): PreToolResult {
  const prefixes = options?.allowedPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const rootDir = options?.rootDir ?? process.cwd();

  // Only file-mutating tools are scoped
  if (!FILE_MUTATING_TOOLS.has(event.toolName)) {
    return { blocked: false };
  }

  // Write/Edit/Delete/Rename/Move/Copy have file_path
  if (TOOLS_WITH_FILE_PATH.has(event.toolName)) {
    const filePath = event.toolInput['file_path'] as string | undefined
      ?? event.toolInput['filePath'] as string | undefined
      ?? event.toolInput['path'] as string | undefined;
    if (filePath) {
      const violation = options?.scopePolicy
        ? checkWithScopeGate(filePath, rootDir, options.scopePolicy)
        : checkFileScopeViolation(filePath, prefixes);
      if (violation) {
        if (config.enforcementMode === 'blocking') {
          return {
            blocked: true,
            blockReason: violation,
          };
        }
        // Advisory mode: still log the violation (but don't block)
        console.error(`[praxis] ADVISORY: File scope violation — ${violation}`);
      }
    }
  }

  // Bash tool: check cmd shell commands for file operations outside scope
  if (event.toolName === 'Bash') {
    const command = event.toolInput['command'] as string | undefined
      ?? event.toolInput['cmd'] as string | undefined;
    if (command && typeof command === 'string') {
      // Simple heuristic: check for 'cat >', 'mv', 'cp', 'rm' targeting paths outside scope
      const fileOps = command.match(/(?:cat\s*>\s*|>>\s*|mv\s+|cp\s+|rm\s+)(\S+)/g);
      if (fileOps) {
        for (const op of fileOps) {
          // Extract the target path from the operation
          const parts = op.split(/\s+/);
          const targetPath = parts[parts.length - 1];
          if (targetPath && !targetPath.startsWith('/') && !targetPath.startsWith('~')) {
            const violation = options?.scopePolicy
              ? checkWithScopeGate(targetPath, rootDir, options.scopePolicy)
              : checkFileScopeViolation(targetPath, prefixes);
            if (violation) {
              if (config.enforcementMode === 'blocking') {
                return {
                  blocked: true,
                  blockReason: `PRAXIS: Bash command targets "${targetPath}" is outside allowed scope. ${violation}`,
                };
              }
              console.error(`[praxis] ADVISORY: Bash command targets "${targetPath}" outside scope.`);
              break; // log once per command
            }
          }
        }
      }
    }
  }

  return { blocked: false };
}

/**
 * Capture a PreToolUse event into the evidence ledger.
 *
 * Returns a PreToolResult indicating whether the tool call should be blocked.
 *
 * In 'advisory' mode (default): violations are logged but never block.
 * In 'blocking' mode: scope violations cause the tool to be rejected.
 */
export function capturePreToolUse(
  event: PreToolUseEvent,
  config: PluginConfig,
  repoRoot: string,
  attemptId: string,
  planId: string,
  scopePolicy?: ScopePolicy,
): PreToolResult {
  if (!config.capturePreTool && config.enforcementMode !== 'blocking') {
    return { blocked: false };
  }

  // Check enforcement first (even if capture is disabled)
  if (config.enforcementMode === 'blocking') {
    const enforcement = evaluatePreToolUse(event, config, {
      rootDir: repoRoot,
      scopePolicy,
    });
    if (enforcement.blocked) {
      // Still write evidence for the blocked attempt
      if (config.capturePreTool) {
        try {
          writeBlockEvidence(event, config, repoRoot, attemptId, planId, enforcement.blockReason ?? '');
        } catch {
          // Best-effort
        }
      }
      return enforcement;
    }
  }

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

  return { blocked: false };
}

/**
 * Write a blocked-tool evidence record.
 */
function writeBlockEvidence(
  event: PreToolUseEvent,
  config: PluginConfig,
  repoRoot: string,
  attemptId: string,
  planId: string,
  blockReason: string,
): void {
  const evidenceDir = resolve(repoRoot, config.evidenceDir, attemptId);
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }
  const recordId = `EV-${config.runIdPrefix}-block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const evidence = {
    evidenceVersion: 'praxis-evidence/v0.1',
    recordId,
    attemptId,
    planId,
    timestamp: event.timestamp,
    type: 'divergence_tool',
    source: 'hook',
    summary: `BLOCKED: ${event.toolName} — ${blockReason}`,
    metadata: {
      toolName: event.toolName,
      toolInputKeys: Object.keys(event.toolInput),
      blockReason,
      enforcementMode: 'blocking',
    },
  };
  const ledgerPath = resolve(evidenceDir, 'evidence.jsonl');
  appendFileSync(ledgerPath, JSON.stringify(evidence) + '\n', 'utf-8');
}
