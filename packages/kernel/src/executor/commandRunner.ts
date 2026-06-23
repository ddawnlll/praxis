// @praxis/kernel — Command Runner
// Spawns child processes, captures stdout/stderr with 10MB cap,
// enforces timeouts with SIGTERM → 5s grace → SIGKILL.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import type { Diagnostic } from '@praxis/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for running a single command. */
export interface RunCommandOptions {
  /** The full command string to execute. */
  command: string;
  /** The command split into [executable, ...args]. */
  args: string[];
  /** Working directory — must be within repoRoot. */
  cwd: string;
  /** Whether to execute via a shell (default: false). */
  shell: boolean;
  /** Timeout in seconds (default: 300). */
  timeoutSeconds: number;
  /** Environment variables to merge with inherited env. */
  env?: Record<string, string>;
  /** Repository root — CWD is validated to be within this. */
  repoRoot: string;
}

/** Result from the command runner after process completion. */
export interface RunCommandResult {
  /** Command identity for evidence. */
  command: string;
  /** Resolved working directory. */
  cwd: string;
  /** Exit code (null if killed by signal before exit). */
  exitCode: number | null;
  /** Signal that terminated the process, if any. */
  signal: string | null;
  /** Whether the command timed out. */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Captured stdout (up to MAX_OUTPUT_BYTES). */
  stdout: string;
  /** Captured stderr (up to MAX_OUTPUT_BYTES). */
  stderr: string;
  /** Whether stdout was truncated. */
  stdoutTruncated: boolean;
  /** Whether stderr was truncated. */
  stderrTruncated: boolean;
  /** Total captured stdout size in bytes. */
  stdoutBytes: number;
  /** Total captured stderr size in bytes. */
  stderrBytes: number;
  /** Any error that prevented spawning. */
  error?: string;
  /** Diagnostics collected during execution. */
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum bytes to capture per stdout/stderr stream. */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Default command timeout in seconds when not specified. */
const DEFAULT_TIMEOUT_SECONDS = 300;

/** Grace period in milliseconds after SIGTERM before SIGKILL. */
const SIGKILL_GRACE_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a command string into [executable, ...args], respecting single and
 * double quotes.  This is a simplified parser — it does not handle escaped
 * quotes or subshell syntax.
 */
export function parseCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

/**
 * Validate that `cwd` is within `repoRoot`.  Returns the resolved absolute
 * path if valid, or null if the path escapes repoRoot.
 */
export function validateCwd(
  cwd: string | undefined,
  repoRoot: string,
): { valid: boolean; resolved: string; error?: string } {
  const root = resolve(repoRoot);
  const normalizedRoot = root.endsWith('/') ? root : root + '/';

  const target = cwd && cwd.length > 0
    ? (isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd))
    : root;

  const normalizedTarget = target.endsWith('/') ? target : target + '/';

  if (!normalizedTarget.startsWith(normalizedRoot)) {
    return {
      valid: false,
      resolved: target,
      error: `CWD "${target}" escapes repoRoot "${root}". Command execution blocked.`,
    };
  }

  return { valid: true, resolved: target };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Spawn a child process, capture stdout/stderr (capped at 10 MB each),
 * enforce timeout with SIGTERM + 5s grace + SIGKILL, and return the
 * complete result.
 */
export async function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
  const diagnostics: Diagnostic[] = [];
  const startTime = performance.now();
  const timeoutMs = (opts.timeoutSeconds > 0 ? opts.timeoutSeconds : DEFAULT_TIMEOUT_SECONDS) * 1000;

  // --- CWD validation ---
  const cwdCheck = validateCwd(opts.cwd, opts.repoRoot);
  if (!cwdCheck.valid) {
    diagnostics.push({
      code: 'CWD_ESCAPES_REPO_ROOT',
      severity: 'error',
      message: cwdCheck.error!,
    });
    return {
      command: opts.command,
      cwd: opts.cwd,
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutBytes: 0,
      stderrBytes: 0,
      error: cwdCheck.error,
      diagnostics,
    };
  }

  const cwd = cwdCheck.resolved;

  // --- Merge environment ---
  const env = opts.env
    ? { ...process.env, ...opts.env }
    : { ...process.env };

  // --- Spawn ---
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(opts.args[0], opts.args.slice(1), {
      cwd,
      shell: opts.shell,
      env,
      stdio: 'pipe',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const endTime = performance.now();
    diagnostics.push({
      code: 'SPAWN_FAILED',
      severity: 'error',
      message: `Failed to spawn command: ${msg}`,
    });
    return {
      command: opts.command,
      cwd,
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs: Math.round(endTime - startTime),
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutBytes: 0,
      stderrBytes: 0,
      error: `SPAWN_FAILED: ${msg}`,
      diagnostics,
    };
  }

  // --- Capture output with 10 MB cap ---
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
    if (remaining <= 0) return;
    const toTake = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
    stdout += toTake;
    stdoutBytes += Buffer.byteLength(toTake, 'utf-8');
    if (Buffer.byteLength(chunk, 'utf-8') > remaining) {
      stdoutTruncated = true;
    }
  });

  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    const remaining = MAX_OUTPUT_BYTES - stderrBytes;
    if (remaining <= 0) return;
    const toTake = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
    stderr += toTake;
    stderrBytes += Buffer.byteLength(toTake, 'utf-8');
    if (Buffer.byteLength(chunk, 'utf-8') > remaining) {
      stderrTruncated = true;
    }
  });

  // --- Timeout enforcement ---
  let timedOut = false;
  let sigtermTimer: NodeJS.Timeout | null = null;
  let sigkillTimer: NodeJS.Timeout | null = null;

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      sigtermTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, SIGKILL_GRACE_MS);
    }
  }, timeoutMs);

  // --- Wait for process exit ---
  const exitResult = await new Promise<{ exitCode: number | null; signal: string | null }>(
    (resolve) => {
      child.on('close', (code, sig) => {
        resolve({ exitCode: code, signal: sig });
      });
      child.on('error', (err) => {
        resolve({
          exitCode: null,
          signal: err.message.includes('ENOENT') ? 'ENOENT' : null,
        });
      });
    },
  );

  // --- Cleanup timers ---
  clearTimeout(timeoutTimer);
  if (sigtermTimer) clearTimeout(sigtermTimer);
  if (sigkillTimer) clearTimeout(sigkillTimer);

  const endTime = performance.now();

  if (exitResult.signal && !timedOut) {
    diagnostics.push({
      code: 'PROCESS_SIGNALED',
      severity: 'error',
      message: `Command terminated by signal: ${exitResult.signal}`,
    });
  }

  if (stdoutTruncated) {
    diagnostics.push({
      code: 'STDOUT_TRUNCATED',
      severity: 'warning',
      message: `stdout exceeded ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB cap and was truncated.`,
    });
  }

  if (stderrTruncated) {
    diagnostics.push({
      code: 'STDERR_TRUNCATED',
      severity: 'warning',
      message: `stderr exceeded ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB cap and was truncated.`,
    });
  }

  return {
    command: opts.command,
    cwd,
    exitCode: exitResult.exitCode,
    signal: exitResult.signal,
    timedOut,
    durationMs: Math.round(endTime - startTime),
    stdout,
    stderr,
    stdoutTruncated,
    stderrTruncated,
    stdoutBytes,
    stderrBytes,
    diagnostics,
  };
}
