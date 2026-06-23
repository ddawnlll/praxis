// @praxis/kernel — ExecGate
// Fifth gate in the PRAXIS Truth Kernel pipeline.
// Validates all commands, executes them sequentially with safety controls,
// and captures stdout/stderr as evidence records.
//
// Only commands in plan.commands.exactAllowedCommands may execute.
// Commands matching hardDeniedCommands are blocked.
// Timeouts are enforced on every command (default 300s).

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, PlanHashes, ExactAllowedCommand } from '@praxis/contracts';
import { resolve } from 'node:path';
import type {
  ExecGateInput,
  ExecGateResult,
  CommandResult,
  CommandVerdict,
} from '../executor/types';
import { runCommand, parseCommand } from '../executor/commandRunner';
import type { RunCommandResult } from '../executor/commandRunner';
import {
  validateAllCommands,
  containsWatchFlags,
  NO_TESTS_PATTERNS,
} from '../executor/commandValidator';
import type { CommandValidationResult } from '../executor/commandValidator';
import { EXEC_REASON_CODES } from '../diagnostics';
import type { EvidenceRecordV01 } from '../evidence/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an evidence record for a completed command execution.
 */
function buildCommandEvidence(
  result: CommandResult,
  planId: string,
  attemptId: string,
  runnerResult: RunCommandResult,
): EvidenceRecordV01 {
  return {
    evidenceVersion: 'praxis-evidence/v0.1' as const,
    recordId: `evt-exec-${result.commandId}-${Date.now()}`,
    attemptId,
    planId,
    timestamp: new Date().toISOString(),
    type: result.kind === 'discovery' ? 'test_output' : 'command',
    source: 'kernel',
    summary: JSON.stringify({
      commandId: result.commandId,
      command: result.command,
      kind: result.kind,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stdoutTruncated: runnerResult.stdoutTruncated,
      stderrTruncated: runnerResult.stderrTruncated,
      stdoutBytes: runnerResult.stdoutBytes,
      stderrBytes: runnerResult.stderrBytes,
    }),
    metadata: {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    },
  };
}

/**
 * Check stdout/stderr for "no tests found" patterns.
 */
function checkNoTestsFound(stdout: string, stderr: string): boolean {
  const combined = stdout + stderr;
  return NO_TESTS_PATTERNS.some(p => p.test(combined));
}

/**
 * Check if a command's output contains expected patterns.
 */
function checkExpectedOutputPatterns(
  stdout: string,
  stderr: string,
  expectedPatterns: string[],
): string[] {
  const missing: string[] = [];
  const combined = stdout + stderr;
  for (const pattern of expectedPatterns) {
    try {
      const regex = new RegExp(pattern);
      if (!regex.test(combined)) {
        missing.push(pattern);
      }
    } catch {
      // Treat invalid regex patterns as literal strings
      if (!combined.includes(pattern)) {
        missing.push(pattern);
      }
    }
  }
  return missing;
}

/**
 * Determine the per-command verdict from reason codes using the
 * FAIL > HOLD > PASS > INFO precedence ladder.
 */
function classifyVerdict(codes: string[]): CommandVerdict {
  if (codes.length === 0) return 'PASS';
  // FAIL codes
  const failSet: ReadonlySet<string> = new Set([
    EXEC_REASON_CODES.COMMAND_NOT_ALLOWED,
    EXEC_REASON_CODES.COMMAND_DENIED,
    EXEC_REASON_CODES.COMMAND_TIMEOUT,
    EXEC_REASON_CODES.WATCH_MODE_DETECTED,
    EXEC_REASON_CODES.COMMAND_CRASHED,
  ]);
  for (const c of codes) {
    if (failSet.has(c)) {
      return 'FAIL';
    }
  }
  // HOLD codes
  const holdSet: ReadonlySet<string> = new Set([
    EXEC_REASON_CODES.POSSIBLE_WATCH_MODE,
    EXEC_REASON_CODES.NO_TESTS_FOUND,
    EXEC_REASON_CODES.UNEXPECTED_EXIT_CODE,
    EXEC_REASON_CODES.EXIT_CODE_NONZERO,
    EXEC_REASON_CODES.EXPECTED_OUTPUT_MISSING,
  ]);
  for (const c of codes) {
    if (holdSet.has(c)) {
      return 'HOLD';
    }
  }
  // INFO codes
  if (codes.includes(EXEC_REASON_CODES.DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL)) {
    return codes.length === 1 ? 'INFO' : 'HOLD';
  }
  // PASS codes
  if (codes.includes(EXEC_REASON_CODES.EXEC_PASS) || codes.includes(EXEC_REASON_CODES.COMMAND_SUCCEEDED)) {
    return 'PASS';
  }
  return 'PASS';
}

/**
 * Truncate a string for display (first 10 KB).
 */
function truncateForDisplay(s: string): string {
  const maxLen = 10 * 1024;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Gate entry point
// ---------------------------------------------------------------------------

/**
 * Run ExecGate — validate and execute declared commands.
 *
 * Checks (in order):
 * 1. Validate all commands against exactAllowedCommands
 * 2. Block any matching hardDeniedCommands
 * 3. Detect watch-mode flags
 * 4. Classify discovery commands
 * 5. Execute validated commands sequentially
 * 6. Post-execution: timeout check, watch-mode output check, exit code check,
 *    noTestsFound check, expected output pattern check, signal/crash check
 * 7. Capture stdout/stderr as evidence records
 */
export async function runExecGate(input: ExecGateInput): Promise<ExecGateResult> {
  const { plan, hashes, attemptId, repoRoot, evidenceRecords, wiringResult, lock } = input;
  const timestamp = new Date().toISOString();

  const reasonCodes: string[] = [];
  const allDiagnostics: Diagnostic[] = [];
  const commandResults: CommandResult[] = [];
  const execEvidenceRecords: EvidenceRecordV01[] = [];
  const evidenceRefs: string[] = [];

  // --- Collect all commands to run from plan ---
  const commandsToRun: ExactAllowedCommand[] = plan.commands.exactAllowedCommands;

  // --- Step 1: Validate all commands before executing any ---
  const commandStrings = commandsToRun.map(c => c.command);
  const validationResults = validateAllCommands(commandStrings, plan);

  // Pair validation results with their original command configs
  for (let i = 0; i < commandsToRun.length; i++) {
    const cmd = commandsToRun[i];
    const validation = validationResults[i];

    allDiagnostics.push(...validation.diagnostics);

    if (!validation.allowed) {
      // Command blocked by validation — create a skipped result
      for (const rc of validation.reasonCodes) {
        reasonCodes.push(rc);
      }

      const cmdResult: CommandResult = {
        commandId: cmd.id,
        command: cmd.command,
        kind: cmd.kind,
        verdict: classifyVerdict(validation.reasonCodes),
        exitCode: undefined,
        signal: null,
        timedOut: false,
        durationMs: 0,
        stdoutTruncated: '',
        stderrTruncated: '',
        stdoutBytes: 0,
        stderrBytes: 0,
        reasonCodes: [...validation.reasonCodes],
        skipped: true,
        error: validation.error,
      };
      commandResults.push(cmdResult);
      evidenceRefs.push(`skipped-${cmd.id}`);
    }
  }

  // --- Step 2: Execute validated commands sequentially ---
  for (let i = 0; i < commandsToRun.length; i++) {
    const cmd = commandsToRun[i];
    const validation = validationResults[i];

    if (!validation.allowed) {
      // Already handled as skipped above
      continue;
    }

    const cmdReasonCodes: string[] = [...validation.reasonCodes];

    // --- Resolve CWD ---
    const cwd = cmd.cwd
      ? resolve(repoRoot, cmd.cwd)
      : repoRoot;

    // --- Parse command into args ---
    const args = parseCommand(cmd.command);

    // --- Run the command ---
    const runnerResult = await runCommand({
      command: cmd.command,
      args,
      cwd,
      shell: cmd.shellAllowed ?? false,
      timeoutSeconds: cmd.timeoutSeconds,
      repoRoot,
    });

    allDiagnostics.push(...runnerResult.diagnostics);

    // --- Post-execution checks ---

    // Check 1: Timeout
    if (runnerResult.timedOut) {
      cmdReasonCodes.push(EXEC_REASON_CODES.COMMAND_TIMEOUT);
    }

    // Check 2: Signal / crash
    if (runnerResult.signal && !runnerResult.timedOut) {
      cmdReasonCodes.push(EXEC_REASON_CODES.COMMAND_CRASHED);
    }

    // Check 3: Possible watch mode (process ran > 10s with no output)
    if (
      !runnerResult.timedOut &&
      runnerResult.stdout.length === 0 &&
      runnerResult.stderr.length === 0 &&
      runnerResult.durationMs > 10_000
    ) {
      cmdReasonCodes.push(EXEC_REASON_CODES.POSSIBLE_WATCH_MODE);
      allDiagnostics.push({
        code: 'POSSIBLE_WATCH_MODE',
        severity: 'warning',
        message: `Command "${cmd.id}" (${cmd.command}) ran for ${runnerResult.durationMs}ms with no output — may be in watch mode.`,
      });
    }

    // Check 4: Expected exit code
    if (cmd.expectedExitCode !== undefined && runnerResult.exitCode !== null) {
      if (runnerResult.exitCode !== cmd.expectedExitCode) {
        cmdReasonCodes.push(EXEC_REASON_CODES.UNEXPECTED_EXIT_CODE);

        if (runnerResult.exitCode !== 0 && cmd.expectedExitCode === 0) {
          cmdReasonCodes.push(EXEC_REASON_CODES.EXIT_CODE_NONZERO);
        }
      }
    } else if (
      runnerResult.exitCode !== null &&
      runnerResult.exitCode !== 0 &&
      cmd.expectedExitCode === undefined
    ) {
      // Non-zero exit without explicit expected exit code → HOLD
      cmdReasonCodes.push(EXEC_REASON_CODES.EXIT_CODE_NONZERO);
    }

    // Check 5: No tests found
    if (cmd.noTestsFoundIsFailure === true) {
      if (checkNoTestsFound(runnerResult.stdout, runnerResult.stderr)) {
        cmdReasonCodes.push(EXEC_REASON_CODES.NO_TESTS_FOUND);
      }
    }

    // Check 6: Expected output patterns
    if (cmd.expectedOutputPatterns && cmd.expectedOutputPatterns.length > 0) {
      const missing = checkExpectedOutputPatterns(
        runnerResult.stdout,
        runnerResult.stderr,
        cmd.expectedOutputPatterns,
      );
      if (missing.length > 0) {
        cmdReasonCodes.push(EXEC_REASON_CODES.EXPECTED_OUTPUT_MISSING);
        allDiagnostics.push({
          code: 'EXPECTED_OUTPUT_MISSING',
          severity: 'warning',
          message: `Command "${cmd.id}" (${cmd.command}) missing expected output patterns: ${missing.join(', ')}`,
        });
      }
    }

    // --- Add success code if nothing bad happened ---
    if (
      cmdReasonCodes.length === 0 ||
      (cmdReasonCodes.length === 1 &&
        cmdReasonCodes[0] === EXEC_REASON_CODES.DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL)
    ) {
      cmdReasonCodes.push(EXEC_REASON_CODES.COMMAND_SUCCEEDED);
    }

    // --- Build the command result ---
    const cmdResult: CommandResult = {
      commandId: cmd.id,
      command: cmd.command,
      kind: cmd.kind,
      verdict: classifyVerdict(cmdReasonCodes),
      exitCode: runnerResult.exitCode ?? undefined,
      signal: runnerResult.signal,
      timedOut: runnerResult.timedOut,
      durationMs: runnerResult.durationMs,
      stdoutTruncated: truncateForDisplay(runnerResult.stdout),
      stderrTruncated: truncateForDisplay(runnerResult.stderr),
      stdoutBytes: runnerResult.stdoutBytes,
      stderrBytes: runnerResult.stderrBytes,
      reasonCodes: [...new Set(cmdReasonCodes)],
      skipped: false,
      error: runnerResult.error,
    };

    commandResults.push(cmdResult);

    // --- Build evidence record ---
    const evidenceRecord = buildCommandEvidence(
      cmdResult,
      plan.metadata.planId,
      attemptId,
      runnerResult,
    );
    execEvidenceRecords.push(evidenceRecord);
    evidenceRefs.push(evidenceRecord.recordId);

    // Collect reason codes
    for (const rc of cmdReasonCodes) {
      reasonCodes.push(rc);
    }
  }

  // --- Aggregate verdict ---
  const cmdPassed = commandResults.filter(c => c.verdict === 'PASS').length;
  const cmdHeld = commandResults.filter(c => c.verdict === 'HOLD').length;
  const cmdFailed = commandResults.filter(c => c.verdict === 'FAIL').length;
  const cmdSkipped = commandResults.filter(c => c.skipped).length;

  const uniqueReasonCodes = [...new Set(reasonCodes)];

  // Overall verdict: FAIL if any command FAILed, HOLD if any HOLD, else PASS
  const overallVerdict = cmdFailed > 0
    ? 'FAIL'
    : cmdHeld > 0
      ? 'HOLD'
      : 'PASS';

  // Add EXEC_PASS if all passed
  if (overallVerdict === 'PASS') {
    uniqueReasonCodes.push(EXEC_REASON_CODES.EXEC_PASS);
  }

  // --- Build repair hint ---
  let repairHint: string | undefined;
  if (cmdFailed > 0) {
    repairHint = 'One or more commands failed validation or execution. Check denied commands, timeouts, or watch-mode flags.';
  } else if (cmdHeld > 0) {
    repairHint = 'Some commands completed with unexpected results. Check exit codes, test output, and expected output patterns.';
  }

  // Merge evidence records
  const allEvidenceRecords = evidenceRecords
    ? [...evidenceRecords, ...execEvidenceRecords]
    : execEvidenceRecords;

  const failedCriteriaIds = plan.tasks.flatMap(t =>
    t.acceptanceCriteria
      .filter(ac =>
        ac.verification.commandRef &&
        commandResults.some(c => c.commandId === ac.verification.commandRef && c.verdict !== 'PASS'),
      )
      .map(ac => ac.id),
  );

  return {
    gateName: 'ExecGate',
    verdict: overallVerdict,
    reasonCodes: uniqueReasonCodes,
    diagnostics: allDiagnostics,
    failedCriteriaIds: [...new Set(failedCriteriaIds)],
    evidenceRefs,
    attemptId,
    timestamp,
    repairHint,
    commandResults,
    commandsPassed: cmdPassed,
    commandsHeld: cmdHeld,
    commandsFailed: cmdFailed,
    commandsSkipped: cmdSkipped,
    commandsTotal: commandResults.length,
    plan,
    hashes,
    lock,
    evidenceRecords: allEvidenceRecords,
  };
}
