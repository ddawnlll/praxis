// @praxis/kernel — Executor Types
// ExecGateInput, ExecGateResult, CommandResult types for ExecGate v0.1.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, PlanHashes, ExactAllowedCommand } from '@praxis/contracts';
import type { GateVerdictValue, PlanLockV01 } from '../types';
import type { EvidenceRecordV01 } from '../evidence/types';
import type { WiringGateResult } from '../wiring/types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Input for ExecGate. */
export interface ExecGateInput {
  /** Parsed PlanSpec v0.1 — commands are read from plan.commands. */
  plan: PlanSpecV01;
  /** PlanHashes carried forward from SchemaGate/LockGate. */
  hashes: PlanHashes;
  /** Unique attempt identifier. */
  attemptId: string;
  /** Repository root — default CWD and bound for all command CWDs. */
  repoRoot: string;
  /** Evidence records from EvidenceGate (context, not validated here). */
  evidenceRecords?: EvidenceRecordV01[];
  /** WiringGate result (context). */
  wiringResult?: WiringGateResult;
  /** PlanLock carried forward from LockGate. */
  lock?: PlanLockV01;
}

// ---------------------------------------------------------------------------
// Per-command result
// ---------------------------------------------------------------------------

/** Verdict for a single command execution. */
export type CommandVerdict = 'PASS' | 'HOLD' | 'FAIL' | 'INFO';

/** Result of a single command execution captured by the runner. */
export interface CommandResult {
  /** ExactAllowedCommand.id from the plan. */
  commandId: string;
  /** Exact match of the command string that was executed. */
  command: string;
  /** Category from the plan's exactAllowedCommands entry. */
  kind: ExactAllowedCommand['kind'];
  /** Per-command verdict. */
  verdict: CommandVerdict;
  /** Exit code (undefined if command was never spawned). */
  exitCode: number | undefined;
  /** Signal that terminated the process (if any). */
  signal: string | null;
  /** Whether the command timed out. */
  timedOut: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** First 10KB of stdout for display. */
  stdoutTruncated: string;
  /** First 10KB of stderr for display. */
  stderrTruncated: string;
  /** Total captured stdout size in bytes. */
  stdoutBytes: number;
  /** Total captured stderr size in bytes. */
  stderrBytes: number;
  /** Reason codes specific to this command. */
  reasonCodes: string[];
  /** Whether this command was skipped (e.g. pre-validation failed). */
  skipped: boolean;
  /** Error message that prevented execution. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** ExecGate result — extends the GateVerdict shape with command-execution specifics. */
export interface ExecGateResult {
  gateName: 'ExecGate';
  verdict: GateVerdictValue;
  reasonCodes: string[];
  diagnostics: Diagnostic[];
  failedCriteriaIds: string[];
  evidenceRefs: string[];
  attemptId: string;
  timestamp: string;
  repairHint?: string;

  // --- ExecGate-specific fields ---

  /** Per-command results in execution order. */
  commandResults: CommandResult[];
  /** Number of commands that passed. */
  commandsPassed: number;
  /** Number of commands that resulted in HOLD. */
  commandsHeld: number;
  /** Number of commands that failed. */
  commandsFailed: number;
  /** Number of commands skipped (pre-validation failure). */
  commandsSkipped: number;
  /** Total number of commands requested for execution. */
  commandsTotal: number;

  // --- Carry-forward fields for downstream gates ---

  /** Plan carried forward. */
  plan?: PlanSpecV01;
  /** Hashes carried forward. */
  hashes?: PlanHashes;
  /** Lock carried forward. */
  lock?: PlanLockV01;
  /** Evidence records carried forward (includes command-output evidence). */
  evidenceRecords?: EvidenceRecordV01[];
}
