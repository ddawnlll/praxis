// @praxis/kernel — verifyPlanLock
// Compares current PlanHashes against lock file hashes.

import type { PlanHashes, Diagnostic } from '@praxis/contracts';
import type { PlanLockV01 } from '../types';
import { HASH_FIELD_REASON_MAP } from '../diagnostics';

export interface LockVerifyResult {
  ok: boolean;
  mismatches: string[];
  reasonCodes: string[];
  diagnostics: Diagnostic[];
}

/**
 * Compare current PlanHashes against a locked PlanLockV01.
 * Returns mismatches with specific reason codes per hash field.
 */
export function verifyPlanLock(
  current: PlanHashes,
  lock: PlanLockV01,
): LockVerifyResult {
  const mismatches: string[] = [];
  const reasonCodes: string[] = [];
  const diagnostics: Diagnostic[] = [];

  // Check planId consistency
  const hashFields = Object.keys(HASH_FIELD_REASON_MAP) as Array<keyof PlanHashes>;

  for (const field of hashFields) {
    const lockHash = lock.hashes[field];
    const currentHash = current[field];

    if (!lockHash) {
      // Lock is missing this field — may be intentional (e.g., no integration contract)
      diagnostics.push({
        code: 'LOCK_HASH_FIELD_MISSING',
        severity: 'warning',
        message: `Lock file is missing hash field "${field}".`,
      });
      continue;
    }

    if (lockHash !== currentHash) {
      const reason = HASH_FIELD_REASON_MAP[field];
      mismatches.push(field);
      reasonCodes.push(reason);
      diagnostics.push({
        code: reason,
        severity: 'error',
        message: `Hash mismatch for "${field}": lock=${lockHash.substring(0, 16)}... current=${currentHash.substring(0, 16)}...`,
        details: { field, lockHash, currentHash },
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    reasonCodes: [...new Set(reasonCodes)],
    diagnostics,
  };
}
