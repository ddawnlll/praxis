// @praxis/contracts — Canonicalizer
// Produces a stable, deterministic JSON string for hashing.
// Object keys are sorted recursively. YAML comments are already stripped by the parser.

import type { PlanSpecV01 } from './types';

/**
 * Produce a deterministic canonical JSON string for the given PlanSpec object.
 * Keys are sorted recursively. This is suitable for SHA-256 hashing.
 */
export function canonicalizePlanSpec(plan: PlanSpecV01): string {
  return JSON.stringify(sortKeys(plan), null, 0);
}

/** Recursively sort all object keys. */
function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      sorted[k] = sortKeys(obj[k]);
    }
    return sorted;
  }

  return value;
}
