// @praxis/kernel — Daemon State
// Warm state manager for the persistent Praxis daemon.
// Holds parsed plan, lock state, evidence index, and gate caches
// across invocations so repeated verify calls are near-instant.

import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type { PlanLockV01, GateVerdict } from '../types';
import type { EvidenceRecordV01 } from '../evidence/types';
import { type GateCache, createGateCache, CACHE_NAMESPACES } from './gateCache';

export interface WarmState {
  /** The last parsed PlanSpec — survives across verify calls. */
  plan: PlanSpecV01 | null;
  /** Computed hashes for the current plan. */
  hashes: PlanHashes | null;
  /** The current lock file state (read once, cached). */
  lock: PlanLockV01 | null;
  /** Lock file modification time — used to detect external changes. */
  lockMtime: number;
  /** Evidence records indexed by criterionId for O(1) lookup. */
  evidenceIndex: Map<string, EvidenceRecordV01[]>;
  /** Total evidence records processed (monotonic counter for incremental reads). */
  evidenceCount: number;
  /** Gate result cache — content-addressed by input hash. */
  gateCache: GateCache;
  /** Repository root path. */
  repoRoot: string;
  /** Whether the daemon should keep running. */
  running: boolean;
}

export function createWarmState(repoRoot: string): WarmState {
  return {
    plan: null,
    hashes: null,
    lock: null,
    lockMtime: 0,
    evidenceIndex: new Map(),
    evidenceCount: 0,
    gateCache: createGateCache(),
    repoRoot,
    running: true,
  };
}

/**
 * Index evidence records by criterionId for fast lookup.
 * Returns a new Map — does NOT mutate the existing index.
 */
export function indexEvidence(records: EvidenceRecordV01[]): Map<string, EvidenceRecordV01[]> {
  const index = new Map<string, EvidenceRecordV01[]>();
  for (const r of records) {
    if (r.criterionId) {
      const existing = index.get(r.criterionId);
      if (existing) {
        existing.push(r);
      } else {
        index.set(r.criterionId, [r]);
      }
    }
  }
  return index;
}

/**
 * Merge new evidence records into an existing index incrementally.
 * Only processes records with recordIds not already in the index.
 * This is the key optimization: O(newRecords) instead of O(allRecords) per call.
 */
export function mergeEvidence(
  existingIndex: Map<string, EvidenceRecordV01[]>,
  existingCount: number,
  newRecords: EvidenceRecordV01[],
  knownRecordIds?: Set<string>,
): { index: Map<string, EvidenceRecordV01[]>; count: number; added: number } {
  if (newRecords.length === 0) {
    return { index: existingIndex, count: existingCount, added: 0 };
  }

  // Build a set of known IDs from existing index if not provided
  const seen = knownRecordIds ?? new Set<string>();
  if (existingCount > 0 && !knownRecordIds) {
    for (const records of existingIndex.values()) {
      for (const r of records) {
        seen.add(r.recordId);
      }
    }
  }

  const index = new Map(existingIndex);
  let added = 0;

  for (const r of newRecords) {
    if (seen.has(r.recordId)) continue;
    seen.add(r.recordId);
    added++;

    if (r.criterionId) {
      const existing = index.get(r.criterionId);
      if (existing) {
        existing.push(r);
      } else {
        index.set(r.criterionId, [r]);
      }
    } else {
      // Records without criterionId still need to be findable
      const existing = index.get('__no_criterion');
      if (existing) {
        existing.push(r);
      } else {
        index.set('__no_criterion', [r]);
      }
    }
  }

  return { index, count: existingCount + added, added };
}
