// @praxis/kernel — runP3Kernel
// Composes SchemaGate → LockGate → EvidenceGate and stops there.
// Does NOT run WiringGate, ExecGate, or FinalGate.

import type { Diagnostic, PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type { PlanLockV01, GateVerdict, GateVerdictValue, LockMode } from './types';
import { runSchemaGate } from './gates/schemaGate';
import { runLockGate } from './gates/lockGate';
import { runEvidenceGate } from './gates/evidenceGate';
import { type EvidenceGateResult, type ChangedFile, type EvidenceRecordV01 } from './evidence/types';
import { now } from './diagnostics';

export interface RunP3Options {
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
}

/**
 * Run the P3 Kernel pipeline: SchemaGate → LockGate → EvidenceGate → stop.
 *
 * Stop conditions:
 * - SchemaGate FAIL → stop
 * - LockGate FAIL → stop
 * - LockGate HOLD → stop (by default; caller may allow preview)
 * - EvidenceGate runs last, whatever its verdict
 *
 * Future gates (WiringGate, ExecGate, FinalGate) are never invoked.
 */
export function runP3Kernel(options: RunP3Options): import('./evidence/types').KernelP3Result {
  const attemptId = options.attemptId ?? `p3-${Date.now()}`;
  const repoRoot = options.repoRoot ?? process.cwd();
  const startedAt = now();
  const gateVerdicts: (GateVerdict | EvidenceGateResult)[] = [];
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
    lock: lockVerdict.hashes ? undefined : undefined, // LockGate carries forward indirectly
  });

  gateVerdicts.push(evidenceVerdict);
  if (evidenceVerdict.diagnostics) allDiagnostics.push(...evidenceVerdict.diagnostics);

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
    diagnostics: allDiagnostics,
  };
}
