// @praxis/kernel — runP2Kernel
// Composes SchemaGate → LockGate and stops there.
// Does NOT run EvidenceGate, WiringGate, ExecGate, or FinalGate.

import type { Diagnostic } from '@praxis/contracts';
import type { KernelP2Result, GateVerdict, GateVerdictValue, LockMode } from './types';
import { runSchemaGate } from './gates/schemaGate';
import { runLockGate } from './gates/lockGate';
import { now } from './diagnostics';

export interface RunP2Options {
  planPath?: string;
  planYaml?: string;
  repoRoot?: string;
  lockPath?: string;
  lockMode?: LockMode;
  attemptId?: string;
}

/**
 * Run the P2 Kernel pipeline: SchemaGate → LockGate → stop.
 *
 * On SchemaGate FAIL, LockGate is skipped.
 * Gate verdicts are returned in order.
 */
export function runP2Kernel(options: RunP2Options): KernelP2Result {
  const attemptId = options.attemptId ?? `p2-${Date.now()}`;
  const repoRoot = options.repoRoot ?? process.cwd();
  const startedAt = now();
  const gateVerdicts: GateVerdict[] = [];
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

  // SchemaGate passed — must have plan and hashes
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

  // --- LockGate ---
  const lockVerdict = runLockGate({
    plan: schemaVerdict.plan,
    hashes: schemaVerdict.hashes,
    lockPath: options.lockPath,
    mode: options.lockMode ?? 'verify_existing',
    attemptId,
  });

  gateVerdicts.push(lockVerdict);
  if (lockVerdict.diagnostics) allDiagnostics.push(...lockVerdict.diagnostics);

  // Determine overall verdict
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
    plan: schemaVerdict.plan,
    hashes: schemaVerdict.hashes,
    diagnostics: allDiagnostics,
  };
}
