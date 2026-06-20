// @praxis/kernel — readPlanLockYaml
// Reads and parses a .lock.yaml file.

import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import type { PlanLockV01 } from '../types';
import type { Diagnostic } from '@praxis/contracts';

export interface LockReadResult {
  ok: boolean;
  lock?: PlanLockV01;
  diagnostics: Diagnostic[];
}

/**
 * Read and parse a PlanLock YAML file.
 */
export function readPlanLockYaml(lockPath: string): LockReadResult {
  const diagnostics: Diagnostic[] = [];

  let raw: string;
  try {
    raw = readFileSync(lockPath, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      code: 'PLAN_LOCK_READ_ERROR',
      severity: 'error',
      message: `Failed to read lock file at ${lockPath}: ${msg}`,
    });
    return { ok: false, diagnostics };
  }

  if (!raw || raw.trim().length === 0) {
    diagnostics.push({
      code: 'PLAN_LOCK_EMPTY',
      severity: 'error',
      message: `Lock file at ${lockPath} is empty.`,
    });
    return { ok: false, diagnostics };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      code: 'PLAN_LOCK_PARSE_ERROR',
      severity: 'error',
      message: `Failed to parse lock YAML at ${lockPath}: ${msg}`,
    });
    return { ok: false, diagnostics };
  }

  if (!parsed || typeof parsed !== 'object') {
    diagnostics.push({
      code: 'PLAN_LOCK_PARSE_ERROR',
      severity: 'error',
      message: `Lock file at ${lockPath} does not contain a valid object.`,
    });
    return { ok: false, diagnostics };
  }

  const lock = parsed as PlanLockV01;

  // Validate required fields — treat completely unrecognizable structure as parse error
  if (!lock.lockVersion && !lock.planId) {
    diagnostics.push({
      code: 'PLAN_LOCK_PARSE_ERROR',
      severity: 'error',
      message: `File at ${lockPath} does not appear to be a valid PlanLock (missing lockVersion and planId).`,
    });
    return { ok: false, diagnostics };
  }

  if (lock.lockVersion !== 'praxis-plan-lock/v0.1') {
    diagnostics.push({
      code: 'PLAN_LOCK_VERSION_MISMATCH',
      severity: 'error',
      message: `Lock version "${lock.lockVersion}" is not "praxis-plan-lock/v0.1".`,
    });
    return { ok: false, lock, diagnostics };
  }

  if (!lock.planId) {
    diagnostics.push({
      code: 'PLAN_ID_MISMATCH',
      severity: 'error',
      message: 'Lock file is missing planId.',
    });
    return { ok: false, lock, diagnostics };
  }

  if (!lock.hashes || !lock.hashes.planHash) {
    diagnostics.push({
      code: 'LOCK_HASH_FIELD_MISSING',
      severity: 'error',
      message: 'Lock file is missing hashes.planHash.',
    });
    return { ok: false, lock, diagnostics };
  }

  return { ok: true, lock, diagnostics };
}
