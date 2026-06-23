// @praxis/claude-plugin — Plugin entry point
// PRAXIS Claude Code plugin bridge.
// READ-ONLY display + dispatch. Never decides truth.
//
// Exports:
//   - Slash command parser and executor
//   - Hook handlers (preToolUse, postToolUse, stop)
//   - Display formatting utilities
//   - Plugin configuration reader

// Configuration
export { readPluginConfig, validateCliPath } from './config';
export type { PluginConfig } from './config';

// Slash commands
export {
  parseSlashCommand,
  executeSlashCommand,
  slashInit,
  slashPlanValidate,
  slashPlanLock,
  slashVerify,
  slashStatus,
  slashReport,
  slashLedger,
  slashRepairShow,
  slashHelp,
} from './slashCommands';
export type { SlashCommand } from './slashCommands';

// Hooks
export { capturePreToolUse } from './hooks/preToolUse';
export type { PreToolUseEvent } from './hooks/preToolUse';

export { capturePostToolUse } from './hooks/postToolUse';
export type { PostToolUseEvent } from './hooks/postToolUse';

export { handleStop } from './hooks/stopHandler';
export type { StopEvent } from './hooks/stopHandler';

// Display
export {
  formatVerdictBadge,
  formatGateLine,
  formatReasonCodes,
  formatGateResult,
  formatKernelResult,
} from './display/formatVerdict';

// ---------------------------------------------------------------------------
// Plugin bootstrap — called by Claude Code when the plugin loads.
// ---------------------------------------------------------------------------

import { readPluginConfig } from './config';
import { executeSlashCommand, parseSlashCommand } from './slashCommands';
import { capturePreToolUse } from './hooks/preToolUse';
import { capturePostToolUse } from './hooks/postToolUse';
import { handleStop } from './hooks/stopHandler';

let pluginConfig: ReturnType<typeof readPluginConfig> | null = null;
let currentRepoRoot = process.cwd();
let currentAttemptId = '';
let currentPlanId = '';

/**
 * Initialize the plugin for a given repository.
 * Called once when the plugin is first loaded.
 */
export function initPlugin(repoRoot?: string): void {
  const root = repoRoot ?? process.cwd();
  currentRepoRoot = root;
  pluginConfig = readPluginConfig(root);

  // Generate a unique attempt ID for this session
  currentAttemptId = `${pluginConfig.runIdPrefix}-${Date.now()}`;
  currentPlanId = 'unknown'; // Will be read from plan on first slash command

  console.error(`[praxis-plugin] Initialized for ${root}`);
  console.error(`[praxis-plugin] Attempt ID: ${currentAttemptId}`);
  console.error(`[praxis-plugin] CLI path: ${pluginConfig.cliPath}`);
  console.error(`[praxis-plugin] Auto-verify on stop: ${pluginConfig.autoVerifyOnStop}`);
}

/**
 * Handle a slash command invocation from Claude Code.
 * This is the main entry point that Claude Code calls.
 */
export async function handleSlashCommand(args: string): Promise<string> {
  if (!pluginConfig) {
    initPlugin();
  }

  const config = pluginConfig!;

  try {
    const cmd = parseSlashCommand(args);
    return await executeSlashCommand(cmd, config, currentRepoRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ PRAXIS plugin error: ${msg}\n\nUse \`/praxis help\` for usage.`;
  }
}

/**
 * Handle a pre-tool event from Claude Code.
 * Captures tool invocation evidence.
 */
export function handlePreToolUse(event: {
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp?: string;
  sessionId?: string;
}): void {
  if (!pluginConfig) return;

  capturePreToolUse(
    {
      toolName: event.toolName,
      toolInput: event.toolInput,
      timestamp: event.timestamp ?? new Date().toISOString(),
      sessionId: event.sessionId,
    },
    pluginConfig,
    currentRepoRoot,
    currentAttemptId,
    currentPlanId,
  );
}

/**
 * Handle a post-tool event from Claude Code.
 * Captures tool output and file change evidence.
 */
export function handlePostToolUse(event: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: unknown;
  timestamp?: string;
  sessionId?: string;
  touchedFiles?: string[];
}): void {
  if (!pluginConfig) return;

  capturePostToolUse(
    {
      toolName: event.toolName,
      toolInput: event.toolInput,
      toolOutput: event.toolOutput,
      timestamp: event.timestamp ?? new Date().toISOString(),
      sessionId: event.sessionId,
      touchedFiles: event.touchedFiles,
    },
    pluginConfig,
    currentRepoRoot,
    currentAttemptId,
    currentPlanId,
  );
}

/**
 * Handle a stop event from Claude Code.
 * Captures session end and optionally triggers auto-verification.
 */
export function handleStopEvent(event: {
  timestamp?: string;
  sessionId?: string;
  reason?: string;
  agentReportedSuccess?: boolean;
}): { captured: boolean; autoVerifyTriggered: boolean; error?: string } {
  if (!pluginConfig) {
    return { captured: false, autoVerifyTriggered: false, error: 'Plugin not initialized' };
  }

  return handleStop(
    {
      timestamp: event.timestamp ?? new Date().toISOString(),
      sessionId: event.sessionId,
      reason: event.reason,
      agentReportedSuccess: event.agentReportedSuccess,
    },
    pluginConfig,
    currentRepoRoot,
    currentAttemptId,
    currentPlanId,
  );
}
