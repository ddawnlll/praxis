// @praxis/kernel — resolveLockPath
// Content-addressed lock path resolver.
// Each plan+content identity gets an isolated lock file, eliminating
// collisions between sequential runs with different plans.
//
// Format: <baseDir>/<planId>-<planHashPrefix(12)>.lock.yaml
// Example: .praxis/locks/feature-auth-a1b2c3d4e5f6.lock.yaml

import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const HASH_PREFIX_LENGTH = 12;
const DEFAULT_LOCK_DIR = '.praxis/locks';

/**
 * Resolve a content-addressed lock file path from plan identity.
 *
 * Derives the path from planId and planHash so that:
 * - Different plans → different lock files → no collision
 * - Same plan + same content → same lock file → verification works
 * - Same plan + changed content → new lock file → old one preserved (audit trail)
 */
export function resolveLockPath(
  planId: string,
  planHash: string,
  options?: { baseDir?: string },
): string {
  const baseDir = options?.baseDir ?? DEFAULT_LOCK_DIR;
  const shortHash = planHash.substring(0, HASH_PREFIX_LENGTH);
  const filename = `${planId}-${shortHash}.lock.yaml`;
  return resolve(baseDir, filename);
}

/**
 * Ensure the parent directory of a lock path exists.
 * Returns the normalized absolute lock path.
 */
export function ensureLockDir(lockPath: string): string {
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return lockPath;
}
