// @praxis/kernel — Command Validator
// Pre-execution validation: exact-match against allowed commands,
// denied-command blocking, watch-mode detection, and discovery classification.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, ExactAllowedCommand, DeniedCommand } from '@praxis/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome of validating a single command before execution. */
export interface CommandValidationResult {
  /** Whether the command is allowed to execute. */
  allowed: boolean;
  /** The matched ExactAllowedCommand entry (if allowed). */
  matchedCommand?: ExactAllowedCommand;
  /** Reason codes produced during validation. */
  reasonCodes: string[];
  /** Diagnostics produced during validation. */
  diagnostics: Diagnostic[];
  /** Whether this is a discovery-only command (cannot satisfy FinalGate). */
  isDiscovery: boolean;
  /** Denied reason if matched. */
  deniedReason?: string;
  /** Human-readable error message if not allowed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Watch mode detection patterns
// ---------------------------------------------------------------------------

/** Patterns that indicate a watch-mode command. */
const WATCH_PATTERNS: RegExp[] = [
  /--watch/,
  /-w\b/,
  /\bnodemon\b/,
  /\bchokidar\b/,
  /--hot\b/,
  /--live\b/,
  /--dev\b.*--watch/,
  /\.watch\(/,
];

/** Patterns that indicate "no tests found" in output. */
export const NO_TESTS_PATTERNS: RegExp[] = [
  /no tests? (found|ran|executed)/i,
  /No test files/i,
  /0 tests/i,
  /tests? suite? did not run/i,
  /no test files found/i,
  /test.*empty/i,
];

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

/**
 * Check whether a command string matches a denied command entry.
 * Returns the DeniedCommand if matched, or null.
 */
export function isCommandDenied(
  command: string,
  deniedCommands: DeniedCommand[],
): DeniedCommand | null {
  for (const dc of deniedCommands) {
    // Exact match on command string
    if (dc.command === command) return dc;

    // Pattern match — treat the pattern as a regex if provided,
    // otherwise fall back to substring match on the command field.
    if (dc.pattern) {
      try {
        const regex = new RegExp(dc.pattern, 'i');
        if (regex.test(command)) return dc;
      } catch {
        // If pattern is not a valid regex, treat it as literal substring
        if (command.toLowerCase().includes(dc.pattern.toLowerCase())) {
          return dc;
        }
      }
    }
  }

  return null;
}

/**
 * Check whether a command string contains watch-mode indicators.
 */
export function containsWatchFlags(command: string): boolean {
  return WATCH_PATTERNS.some(p => p.test(command));
}

/**
 * Find the ExactAllowedCommand entry that matches the requested command
 * via EXACT string match (not substring).
 */
export function findExactMatch(
  command: string,
  allowedCommands: ExactAllowedCommand[],
): ExactAllowedCommand | null {
  for (const ac of allowedCommands) {
    if (ac.command === command) return ac;
  }
  return null;
}

/**
 * Validate a single command for execution.
 *
 * Checks (in order):
 * 1. Exact match in exactAllowedCommands
 * 2. Not in hardDeniedCommands
 * 3. Watch mode detection
 * 4. Discovery classification
 */
export function validateCommand(
  command: string,
  plan: PlanSpecV01,
): CommandValidationResult {
  const reasonCodes: string[] = [];
  const diagnostics: Diagnostic[] = [];

  const { exactAllowedCommands, hardDeniedCommands, validationEvidenceRules } =
    plan.commands;

  // --- Check 1: Exact match against allowed list ---
  const matched = findExactMatch(command, exactAllowedCommands);

  if (!matched) {
    reasonCodes.push('COMMAND_NOT_ALLOWED');
    diagnostics.push({
      code: 'COMMAND_NOT_ALLOWED',
      severity: 'error',
      message: `Command "${command}" is not in exactAllowedCommands. Only pre-declared commands may execute.`,
    });
    return {
      allowed: false,
      reasonCodes,
      diagnostics,
      isDiscovery: false,
      error: `Command "${command}" not in exactAllowedCommands. Execution blocked.`,
    };
  }

  // --- Check 2: Denied commands ---
  const denied = isCommandDenied(command, hardDeniedCommands);

  if (denied) {
    reasonCodes.push('COMMAND_DENIED');
    diagnostics.push({
      code: 'COMMAND_DENIED',
      severity: 'error',
      message: `Command "${command}" matches hardDeniedCommand${denied.id ? ` "${denied.id}"` : ''}: ${denied.reason}`,
    });
    return {
      allowed: false,
      matchedCommand: matched,
      reasonCodes,
      diagnostics,
      isDiscovery: false,
      deniedReason: denied.reason,
      error: `Command is hard-denied: ${denied.reason}`,
    };
  }

  // --- Check 3: Watch mode detection ---
  if (matched.watchModeForbidden !== false) {
    // watchModeForbidden defaults to strict — if not explicitly false, check
    if (containsWatchFlags(command)) {
      reasonCodes.push('WATCH_MODE_DETECTED');
      diagnostics.push({
        code: 'WATCH_MODE_DETECTED',
        severity: 'error',
        message: `Command "${command}" contains watch-mode indicators (--watch, nodemon, chokidar, etc.). Watch mode is forbidden for this command.`,
      });
      return {
        allowed: false,
        matchedCommand: matched,
        reasonCodes,
        diagnostics,
        isDiscovery: false,
        error: 'Watch mode is forbidden for this command.',
      };
    }
  }

  // --- Check 4: Discovery classification ---
  const isDiscovery = matched.kind === 'discovery';

  if (
    isDiscovery &&
    validationEvidenceRules.discoveryCommandsMayNotSatisfyFinalValidation
  ) {
    reasonCodes.push('DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL');
    diagnostics.push({
      code: 'DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL',
      severity: 'info',
      message: `Command "${command}" (kind: discovery) may execute but its output cannot satisfy FinalGate final validation.`,
    });
  }

  return {
    allowed: true,
    matchedCommand: matched,
    reasonCodes,
    diagnostics,
    isDiscovery,
  };
}

/**
 * Validate all requested commands before executing any.
 * Returns the full list of validation results.
 */
export function validateAllCommands(
  commands: string[],
  plan: PlanSpecV01,
): CommandValidationResult[] {
  return commands.map(cmd => validateCommand(cmd, plan));
}
