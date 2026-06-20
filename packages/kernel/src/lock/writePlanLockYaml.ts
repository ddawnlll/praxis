// @praxis/kernel — writePlanLockYaml
// Writes a PlanLockV01 to a .lock.yaml file.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import YAML from 'yaml';
import type { PlanLockV01 } from '../types';
import type { Diagnostic } from '@praxis/contracts';

export interface LockWriteResult {
  ok: boolean;
  path: string;
  diagnostics: Diagnostic[];
}

/**
 * Write a PlanLockV01 to a YAML file.
 * Creates parent directories if needed.
 */
export function writePlanLockYaml(lock: PlanLockV01, lockPath: string): LockWriteResult {
  const diagnostics: Diagnostic[] = [];

  // Ensure parent directory exists
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      code: 'PLAN_LOCK_WRITE_ERROR',
      severity: 'error',
      message: `Failed to create lock directory ${dirname(lockPath)}: ${msg}`,
    });
    return { ok: false, path: lockPath, diagnostics };
  }

  // Serialize to YAML
  let yamlStr: string;
  try {
    yamlStr = YAML.stringify(lock, { indent: 2 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      code: 'PLAN_LOCK_WRITE_ERROR',
      severity: 'error',
      message: `Failed to serialize PlanLock to YAML: ${msg}`,
    });
    return { ok: false, path: lockPath, diagnostics };
  }

  // Write to disk
  try {
    writeFileSync(lockPath, yamlStr, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      code: 'PLAN_LOCK_WRITE_ERROR',
      severity: 'error',
      message: `Failed to write lock file to ${lockPath}: ${msg}`,
    });
    return { ok: false, path: lockPath, diagnostics };
  }

  return { ok: true, path: lockPath, diagnostics };
}
