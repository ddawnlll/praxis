// @praxis/kernel — LockGate
// Verifies that current PlanHashes match an existing YAML lock file,
// or creates a lock when mode allows it.

import { existsSync } from 'node:fs';
import type { Diagnostic } from '@praxis/contracts';
import type { LockGateInput, GateVerdict, PlanLockV01 } from '../types';
import { LOCK_REASON_CODES } from '../diagnostics';
import { createPlanLock } from '../lock/createPlanLock';
import { readPlanLockYaml } from '../lock/readPlanLockYaml';
import { writePlanLockYaml } from '../lock/writePlanLockYaml';
import { verifyPlanLock } from '../lock/verifyPlanLock';

const DEFAULT_LOCK_PATH = '.praxis/locks/current.lock.yaml';

/**
 * Run LockGate — verifies hash consistency with existing lock,
 * or creates a new lock depending on mode.
 */
export function runLockGate(input: LockGateInput): GateVerdict {
  const attemptId = input.attemptId ?? `lock-${Date.now()}`;
  const lockPath = input.lockPath ?? DEFAULT_LOCK_PATH;
  const mode = input.mode ?? 'verify_existing';
  const timestamp = new Date().toISOString();
  const plan = input.plan;
  const hashes = input.hashes;

  const reasonCodes: string[] = [];
  const allDiagnostics: Diagnostic[] = [];
  let lock: PlanLockV01 | undefined;

  const lockExists = existsSync(lockPath);

  // --- verify_existing mode ---
  if (mode === 'verify_existing') {
    if (!lockExists) {
      reasonCodes.push(LOCK_REASON_CODES.MISSING_PLAN_LOCK);
      allDiagnostics.push({
        code: 'MISSING_PLAN_LOCK',
        severity: 'error',
        message: `Lock file not found at ${lockPath}. Use create_if_missing mode to create one.`,
      });
      return buildVerdict('LockGate', 'HOLD', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);
    }

    const readResult = readPlanLockYaml(lockPath);
    allDiagnostics.push(...readResult.diagnostics);

    if (!readResult.ok) {
      // Map read diagnostics to reason codes
      for (const d of readResult.diagnostics) {
        if (d.severity === 'error') {
          if (d.code === 'PLAN_LOCK_VERSION_MISMATCH') {
            reasonCodes.push(LOCK_REASON_CODES.PLAN_LOCK_VERSION_MISMATCH);
          } else if (d.code === 'PLAN_ID_MISMATCH') {
            reasonCodes.push(LOCK_REASON_CODES.PLAN_ID_MISMATCH);
          } else if (d.code === 'LOCK_HASH_FIELD_MISSING') {
            reasonCodes.push(LOCK_REASON_CODES.LOCK_HASH_FIELD_MISSING);
          } else {
            reasonCodes.push(LOCK_REASON_CODES.PLAN_LOCK_PARSE_ERROR);
          }
        }
      }
      return buildVerdict('LockGate', 'FAIL', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, readResult.lock ?? undefined);
    }

    if (!readResult.lock) {
      reasonCodes.push(LOCK_REASON_CODES.PLAN_LOCK_PARSE_ERROR);
      return buildVerdict('LockGate', 'FAIL', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, undefined);
    }

    lock = readResult.lock;

    // Check planId match
    if (lock.planId !== plan.metadata.planId) {
      reasonCodes.push(LOCK_REASON_CODES.PLAN_ID_MISMATCH);
      allDiagnostics.push({
        code: 'PLAN_ID_MISMATCH',
        severity: 'error',
        message: `Lock planId "${lock.planId}" does not match current planId "${plan.metadata.planId}".`,
      });
    }

    // Verify hashes
    const verifyResult = verifyPlanLock(hashes, lock);
    allDiagnostics.push(...verifyResult.diagnostics);
    reasonCodes.push(...verifyResult.reasonCodes);

    const verdict = reasonCodes.length === 0 ? 'PASS' : 'FAIL';
    return buildVerdict('LockGate', verdict, reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);

  // --- create_if_missing mode ---
  } else if (mode === 'create_if_missing') {
    if (lockExists) {
      // Lock exists — verify it instead
      const readResult = readPlanLockYaml(lockPath);
      allDiagnostics.push(...readResult.diagnostics);

      if (!readResult.ok) {
        for (const d of readResult.diagnostics) {
          if (d.severity === 'error') {
            if (d.code === 'PLAN_LOCK_VERSION_MISMATCH') {
              reasonCodes.push(LOCK_REASON_CODES.PLAN_LOCK_VERSION_MISMATCH);
            } else if (d.code === 'PLAN_ID_MISMATCH') {
              reasonCodes.push(LOCK_REASON_CODES.PLAN_ID_MISMATCH);
            } else if (d.code === 'LOCK_HASH_FIELD_MISSING') {
              reasonCodes.push(LOCK_REASON_CODES.LOCK_HASH_FIELD_MISSING);
            } else {
              reasonCodes.push(LOCK_REASON_CODES.PLAN_LOCK_PARSE_ERROR);
            }
          }
        }
        return buildVerdict('LockGate', 'FAIL', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, readResult.lock ?? undefined);
      }

      if (!readResult.lock) {
        reasonCodes.push(LOCK_REASON_CODES.PLAN_LOCK_PARSE_ERROR);
        return buildVerdict('LockGate', 'FAIL', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, undefined);
      }

      lock = readResult.lock;

      if (lock.planId !== plan.metadata.planId) {
        reasonCodes.push(LOCK_REASON_CODES.PLAN_ID_MISMATCH);
        allDiagnostics.push({
          code: 'PLAN_ID_MISMATCH',
          severity: 'error',
          message: `Lock planId "${lock.planId}" does not match current planId "${plan.metadata.planId}".`,
        });
      }

      const verifyResult = verifyPlanLock(hashes, lock);
      allDiagnostics.push(...verifyResult.diagnostics);
      reasonCodes.push(...verifyResult.reasonCodes);

      const verdict = reasonCodes.length === 0 ? 'PASS' : 'FAIL';
      return buildVerdict('LockGate', verdict, reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);
    }

    // Lock doesn't exist — create it
    lock = createPlanLock(plan, hashes, { planPath: undefined });
    const writeResult = writePlanLockYaml(lock, lockPath);
    allDiagnostics.push(...writeResult.diagnostics);

    if (!writeResult.ok) {
      reasonCodes.push(...writeResult.diagnostics.map(d => d.code));
      return buildVerdict('LockGate', 'FAIL', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);
    }

    reasonCodes.push(LOCK_REASON_CODES.LOCK_CREATED);
    allDiagnostics.push({
      code: 'LOCK_CREATED',
      severity: 'info',
      message: `Lock file created at ${lockPath}.`,
    });

    return buildVerdict('LockGate', 'PASS', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);

  // --- refresh_explicit mode ---
  } else if (mode === 'refresh_explicit') {
    lock = createPlanLock(plan, hashes, { planPath: undefined });
    const writeResult = writePlanLockYaml(lock, lockPath);
    allDiagnostics.push(...writeResult.diagnostics);

    if (!writeResult.ok) {
      reasonCodes.push(...writeResult.diagnostics.map(d => d.code));
      return buildVerdict('LockGate', 'FAIL', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);
    }

    reasonCodes.push(LOCK_REASON_CODES.LOCK_PASS);
    allDiagnostics.push({
      code: 'LOCK_REFRESHED',
      severity: 'info',
      message: `Lock file refreshed at ${lockPath}.`,
    });

    return buildVerdict('LockGate', 'PASS', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);
  }

  // Unknown mode
  reasonCodes.push('UNKNOWN_LOCK_MODE');
  allDiagnostics.push({
    code: 'UNKNOWN_LOCK_MODE',
    severity: 'error',
    message: `Unknown lock mode "${mode}". Use verify_existing, create_if_missing, or refresh_explicit.`,
  });
  return buildVerdict('LockGate', 'FAIL', reasonCodes, allDiagnostics, attemptId, timestamp, lockPath, lock);
}

function buildVerdict(
  gateName: string,
  verdict: 'PASS' | 'HOLD' | 'FAIL',
  reasonCodes: string[],
  diagnostics: Diagnostic[],
  attemptId: string,
  timestamp: string,
  lockPath: string,
  lock?: PlanLockV01,
): GateVerdict {
  const uniqueCodes = [...new Set(reasonCodes)];
  const passCodes = verdict === 'PASS' && uniqueCodes.length === 0
    ? [LOCK_REASON_CODES.LOCK_PASS]
    : uniqueCodes;

  return {
    gateName,
    verdict,
    reasonCodes: passCodes,
    failedCriteriaIds: [],
    evidenceRefs: [],
    attemptId,
    timestamp,
    repairHint: verdict === 'FAIL'
      ? 'Plan hashes do not match lock file. Check for unintended plan changes.'
      : verdict === 'HOLD'
        ? 'Lock file is missing. Create one using create_if_missing mode.'
        : undefined,
    diagnostics,
    hashes: lock?.hashes,
    lockPath,
    plan: undefined,
  };
}
