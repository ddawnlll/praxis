// @praxis/kernel — runKernel (aka runP6Kernel)
// Full 6-gate pipeline: SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate.
// This is the complete Truth Kernel pipeline — FinalGate PASS means the task is complete (Law 1).

import type { Diagnostic, PlanSpecV01, PlanHashes, ExactAllowedCommand } from '@praxis/contracts';
import type { GateVerdict, GateVerdictValue, LockMode, KernelResult, AnyGateResult } from './types';
import { runSchemaGate } from './gates/schemaGate';
import { runLockGate } from './gates/lockGate';
import { runEvidenceGate } from './gates/evidenceGate';
import { runWiringGate } from './gates/wiringGate';
import { runExecGate } from './gates/execGate';
import { runFinalGate } from './gates/finalGate';
import { type ChangedFile, type EvidenceRecordV01 } from './evidence/types';
import { now } from './diagnostics';

export interface RunKernelOptions {
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
   * before ExecGate execution.
   */
  commandOverrides?: ExactAllowedCommand[];
  /**
   * When true, stop the pipeline on any HOLD verdict from an intermediate gate
   * (LockGate, EvidenceGate, WiringGate). When false (default), continue through
   * HOLD to let FinalGate produce a complete picture.
   */
  stopOnHold?: boolean;
}

/**
 * Build a GateVerdict-compatible prior gate verdicts list from the accumulated
 * gate results. All gate result types share the shape accessed by FinalGate
 * (gateName, verdict).
 */
function buildPriorGateVerdicts(
  gateVerdicts: AnyGateResult[],
): GateVerdict[] {
  return gateVerdicts.map(gv => ({
    gateName: gv.gateName,
    verdict: gv.verdict,
    reasonCodes: gv.reasonCodes,
    failedCriteriaIds: ('failedCriteriaIds' in gv ? gv.failedCriteriaIds as string[] : []),
    evidenceRefs: ('evidenceRefs' in gv ? gv.evidenceRefs as string[] : []),
    attemptId: gv.attemptId,
    timestamp: gv.timestamp,
  }));
}

/**
 * Run the full 6-gate PRAXIS Truth Kernel pipeline.
 *
 * Pipeline: SchemaGate → LockGate → EvidenceGate → WiringGate → ExecGate → FinalGate
 *
 * Stop conditions:
 * - SchemaGate FAIL → stop immediately
 * - LockGate FAIL → stop immediately
 * - LockGate HOLD → stop if stopOnHold is true
 * - EvidenceGate FAIL → stop immediately
 * - EvidenceGate HOLD → stop if stopOnHold is true
 * - WiringGate FAIL → stop immediately
 * - WiringGate HOLD → stop if stopOnHold is true
 * - ExecGate runs after WiringGate PASS (or HOLD with stopOnHold=false)
 * - FinalGate always runs as the final gate — it evaluates all prior verdicts
 *
 * FinalGate PASS means the task is complete (Law 1).
 */
export async function runKernel(options: RunKernelOptions): Promise<KernelResult> {
  const attemptId = options.attemptId ?? `run-${Date.now()}`;
  const repoRoot = options.repoRoot ?? process.cwd();
  const startedAt = now();
  const gateVerdicts: KernelResult['gateVerdicts'] = [];
  const allDiagnostics: Diagnostic[] = [];

  // -----------------------------------------------------------------------
  // SchemaGate
  // -----------------------------------------------------------------------
  const schemaVerdict = runSchemaGate({
    planPath: options.planPath,
    planYaml: options.planYaml,
    repoRoot,
    attemptId,
  });

  gateVerdicts.push(schemaVerdict);
  if (schemaVerdict.diagnostics) allDiagnostics.push(...schemaVerdict.diagnostics);

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

  // -----------------------------------------------------------------------
  // LockGate
  // -----------------------------------------------------------------------
  const lockVerdict = runLockGate({
    plan,
    hashes,
    lockPath: options.lockPath,
    mode: options.lockMode ?? 'verify_existing',
    attemptId,
  });

  gateVerdicts.push(lockVerdict);
  if (lockVerdict.diagnostics) allDiagnostics.push(...lockVerdict.diagnostics);

  if (lockVerdict.verdict === 'FAIL') {
    return finishEarly('FAIL', attemptId, gateVerdicts, allDiagnostics, startedAt, plan, hashes);
  }

  if (lockVerdict.verdict === 'HOLD' && options.stopOnHold) {
    return finishEarly('HOLD', attemptId, gateVerdicts, allDiagnostics, startedAt, plan, hashes);
  }

  // -----------------------------------------------------------------------
  // EvidenceGate
  // -----------------------------------------------------------------------
  const evidenceVerdict = runEvidenceGate({
    plan,
    hashes,
    attemptId,
    evidenceLedgerPath: options.evidenceLedgerPath,
    evidenceRecords: options.evidenceRecords,
    changedFiles: options.changedFiles,
    repoRoot,
    lock: undefined,
  });

  gateVerdicts.push(evidenceVerdict);
  if (evidenceVerdict.diagnostics) allDiagnostics.push(...evidenceVerdict.diagnostics);

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

  if (evidenceVerdict.verdict === 'HOLD' && options.stopOnHold) {
    return {
      ok: false,
      verdict: 'HOLD',
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

  // -----------------------------------------------------------------------
  // WiringGate
  // -----------------------------------------------------------------------
  const wiringVerdict = runWiringGate({
    plan,
    hashes,
    attemptId,
    repoRoot,
    evidenceRecords: evidenceVerdict.evidenceRecords,
    lock: undefined,
  });

  gateVerdicts.push(wiringVerdict);
  if (wiringVerdict.diagnostics) allDiagnostics.push(...wiringVerdict.diagnostics);

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

  if (wiringVerdict.verdict === 'HOLD' && options.stopOnHold) {
    return {
      ok: false,
      verdict: 'HOLD',
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

  // -----------------------------------------------------------------------
  // ExecGate (async)
  // -----------------------------------------------------------------------
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
    lock: undefined,
  });

  gateVerdicts.push(execVerdict);
  if (execVerdict.diagnostics) allDiagnostics.push(...execVerdict.diagnostics);

  // -----------------------------------------------------------------------
  // FinalGate
  // -----------------------------------------------------------------------
  // Collect all evidence records: EvidenceGate's + ExecGate's new records
  const allEvidenceRecords: EvidenceRecordV01[] = [
    ...(evidenceVerdict.evidenceRecords ?? []),
    ...(execVerdict.evidenceRecords ?? []),
  ];

  const priorGateVerdicts = buildPriorGateVerdicts(gateVerdicts);

  const finalVerdict = runFinalGate({
    plan,
    hashes,
    attemptId,
    repoRoot,
    evidenceRecords: allEvidenceRecords,
    commandResults: execVerdict.commandResults,
    wiringResult: wiringVerdict,
    priorGateVerdicts,
    lock: undefined,
  });

  gateVerdicts.push(finalVerdict);
  if (finalVerdict.diagnostics) allDiagnostics.push(...finalVerdict.diagnostics);

  // -----------------------------------------------------------------------
  // Determine overall verdict
  // -----------------------------------------------------------------------
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
    final: finalVerdict,
    diagnostics: allDiagnostics,
  };
}

/**
 * Build an early-termination result when a gate returns FAIL or HOLD.
 */
function finishEarly(
  verdict: GateVerdictValue,
  attemptId: string,
  gateVerdicts: KernelResult['gateVerdicts'],
  diagnostics: Diagnostic[],
  startedAt: string,
  plan?: PlanSpecV01,
  hashes?: PlanHashes,
): KernelResult {
  return {
    ok: false,
    verdict,
    attemptId,
    gateVerdicts,
    startedAt,
    finishedAt: now(),
    plan,
    hashes,
    diagnostics,
  };
}

/**
 * Alias: runP6Kernel is the full 6-gate pipeline, identical to runKernel.
 * Exported for phase-naming symmetry with runP2Kernel, runP3Kernel, etc.
 */
export const runP6Kernel = runKernel;
