// @praxis/kernel — runP5Kernel
// Composes SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate and stops there.
// Does NOT run FinalGate.

import type { Diagnostic, PlanSpecV01, PlanHashes, ExactAllowedCommand } from '@praxis/contracts';
import type { PlanLockV01, GateVerdict, GateVerdictValue, LockMode, KernelP5Result } from './types';
import { runSchemaGate } from './gates/schemaGate';
import { runLockGate } from './gates/lockGate';
import { runEvidenceGate } from './gates/evidenceGate';
import { runWiringGate } from './gates/wiringGate';
import { runExecGate } from './gates/execGate';
import { type EvidenceGateResult, type ChangedFile, type EvidenceRecordV01 } from './evidence/types';
import { type WiringGateResult } from './wiring/types';
import { type ExecGateResult } from './executor/types';
import { now } from './diagnostics';

export interface RunP5Options {
  planPath?: string;
  planYaml?: string;
  repoRoot?: string;
  lockPath?: string;
  lockMode?: LockMode;
  attemptId?: string;
  /** Path to evidence ledger JSONL file. */
  evidenceLedgerPath?: string;
  /** Pre-loaded evidence records (avoids file read). */
  evidenceRecords?: EvidenceRecordV01[];
  /** Explicit changed files list (used if no evidence ledger). */
  changedFiles?: ChangedFile[];
  /**
   * Optional command overrides. When provided, replaces plan.commands.exactAllowedCommands
   * before ExecGate execution. Useful for test or CI-driven overrides.
   */
  commandOverrides?: ExactAllowedCommand[];
}

/**
 * Run the P5 Kernel pipeline: SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → stop.
 *
 * Stop conditions:
 * - SchemaGate FAIL → stop
 * - LockGate FAIL → stop
 * - LockGate HOLD → stop
 * - EvidenceGate FAIL → stop
 * - WiringGate FAIL → stop
 * - ExecGate runs last, whatever its verdict
 *
 * ExecGate is async — command execution may take time.
 * Future gate (FinalGate) is never invoked.
 */
export async function runP5Kernel(options: RunP5Options): Promise<KernelP5Result> {
  const attemptId = options.attemptId ?? `p5-${Date.now()}`;
  const repoRoot = options.repoRoot ?? process.cwd();
  const startedAt = now();
  const gateVerdicts: KernelP5Result['gateVerdicts'] = [];
  const allDiagnostics: Diagnostic[] = [];

  // --- SchemaGate ---
  const schemaVerdict = runSchemaGate({
    planPath: options.planPath,
    planYaml: options.planYaml,
    repoRoot,
    attemptId,
  });

  gateVerdicts.push(schemaVerdict);
  if (schemaVerdict.diagnostics) allDiagnostics.push(...schemaVerdict.diagnostics);

  // Stop if SchemaGate failed
  if (schemaVerdict.verdict === 'FAIL') {
    return {
      ok: false,
      verdict: 'FAIL',
      attemptId,
      gateVerdicts,
      startedAt,
      finishedAt: now(),
      plan: schemaVerdict.plan,
      diagnostics: allDiagnostics,
    };
  }

  // SchemaGate must have plan and hashes
  if (!schemaVerdict.plan || !schemaVerdict.hashes) {
    allDiagnostics.push({
      code: 'SCHEMA_GATE_NO_PLAN',
      severity: 'error',
      message: 'SchemaGate passed but did not return plan or hashes.',
    });
    return {
      ok: false,
      verdict: 'FAIL',
      attemptId,
      gateVerdicts,
      startedAt,
      finishedAt: now(),
      diagnostics: allDiagnostics,
    };
  }

  const plan: PlanSpecV01 = schemaVerdict.plan;
  const hashes: PlanHashes = schemaVerdict.hashes;

  // --- LockGate ---
  const lockVerdict = runLockGate({
    plan,
    hashes,
    lockPath: options.lockPath,
    mode: options.lockMode ?? 'verify_existing',
    attemptId,
  });

  gateVerdicts.push(lockVerdict);
  if (lockVerdict.diagnostics) allDiagnostics.push(...lockVerdict.diagnostics);

  // Stop on LockGate FAIL or HOLD
  if (lockVerdict.verdict === 'FAIL') {
    return {
      ok: false,
      verdict: 'FAIL',
      attemptId,
      gateVerdicts,
      startedAt,
      finishedAt: now(),
      plan,
      hashes,
      diagnostics: allDiagnostics,
    };
  }

  if (lockVerdict.verdict === 'HOLD') {
    return {
      ok: false,
      verdict: 'HOLD',
      attemptId,
      gateVerdicts,
      startedAt,
      finishedAt: now(),
      plan,
      hashes,
      diagnostics: allDiagnostics,
    };
  }

  // --- EvidenceGate ---
  const evidenceVerdict = runEvidenceGate({
    plan,
    hashes,
    attemptId,
    evidenceLedgerPath: options.evidenceLedgerPath,
    evidenceRecords: options.evidenceRecords,
    changedFiles: options.changedFiles,
    repoRoot,
    lock: lockVerdict.hashes ? undefined : undefined,
  });

  gateVerdicts.push(evidenceVerdict);
  if (evidenceVerdict.diagnostics) allDiagnostics.push(...evidenceVerdict.diagnostics);

  // Stop on EvidenceGate FAIL
  if (evidenceVerdict.verdict === 'FAIL') {
    return {
      ok: false,
      verdict: 'FAIL',
      attemptId,
      gateVerdicts,
      startedAt,
      finishedAt: now(),
      plan,
      hashes,
      evidence: evidenceVerdict,
      diagnostics: allDiagnostics,
    };
  }

  // --- WiringGate ---
  const wiringVerdict = runWiringGate({
    plan,
    hashes,
    attemptId,
    repoRoot,
    evidenceRecords: evidenceVerdict.evidenceRecords,
    lock: lockVerdict.hashes ? undefined : undefined,
  });

  gateVerdicts.push(wiringVerdict);
  if (wiringVerdict.diagnostics) allDiagnostics.push(...wiringVerdict.diagnostics);

  // Stop on WiringGate FAIL
  if (wiringVerdict.verdict === 'FAIL') {
    return {
      ok: false,
      verdict: 'FAIL',
      attemptId,
      gateVerdicts,
      startedAt,
      finishedAt: now(),
      plan,
      hashes,
      evidence: evidenceVerdict,
      wiring: wiringVerdict,
      diagnostics: allDiagnostics,
    };
  }

  // --- ExecGate (async) ---
  // Apply command overrides if provided — create a modified plan with overridden commands
  const execPlan = options.commandOverrides
    ? {
        ...plan,
        commands: {
          ...plan.commands,
          exactAllowedCommands: options.commandOverrides,
        },
      }
    : plan;

  const execVerdict = await runExecGate({
    plan: execPlan,
    hashes,
    attemptId,
    repoRoot,
    evidenceRecords: evidenceVerdict.evidenceRecords,
    wiringResult: wiringVerdict,
    lock: lockVerdict.hashes ? undefined : undefined,
  });

  gateVerdicts.push(execVerdict);
  if (execVerdict.diagnostics) allDiagnostics.push(...execVerdict.diagnostics);

  // --- Determine overall verdict ---
  let overallVerdict: GateVerdictValue = 'PASS';
  for (const gv of gateVerdicts) {
    if (gv.verdict === 'FAIL') {
      overallVerdict = 'FAIL';
      break;
    }
    if (gv.verdict === 'HOLD') {
      overallVerdict = 'HOLD';
    }
  }

  return {
    ok: overallVerdict === 'PASS',
    verdict: overallVerdict,
    attemptId,
    gateVerdicts,
    startedAt,
    finishedAt: now(),
    plan,
    hashes,
    evidence: evidenceVerdict,
    wiring: wiringVerdict,
    exec: execVerdict,
    diagnostics: allDiagnostics,
  };
}
