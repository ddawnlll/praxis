// @praxis/kernel — Gate Cache
// Content-addressed gate result cache.
// Each gate result is cached by hash(inputs). If the same inputs
// appear again, the cached result is returned — no re-computation.
// Inspired by Turbopack's function-level memoization and Bazel's
// action cache.

import { createHash } from 'node:crypto';
import type { GateVerdict } from '../types';

/** Cache namespaces — one per gate for isolation. */
export const CACHE_NAMESPACES = {
  SCHEMA: 'schema',
  LOCK: 'lock',
  EVIDENCE: 'evidence',
  WIRING: 'wiring',
  EXEC: 'exec',
  FINAL: 'final',
  PIPELINE: 'pipeline',
} as const;

export type CacheNamespace = (typeof CACHE_NAMESPACES)[keyof typeof CACHE_NAMESPACES];

interface CacheEntry {
  /** Content hash of all inputs. */
  key: string;
  /** Cached verdict. */
  verdict: GateVerdict;
  /** When this entry was created (monotonic timestamp). */
  createdAt: number;
  /** Hit count for telemetry. */
  hits: number;
}

export interface GateCacheStats {
  entries: number;
  hits: Record<string, number>;
  misses: Record<string, number>;
}

/**
 * Content-addressed gate cache.
 *
 * Each gate registers its result under a hash of its inputs.
 * On lookup, if the hash matches, the cached result is returned.
 * This is correct by construction: same inputs → same output
 * (gates are pure functions of their inputs).
 */
export class GateCache {
  private entries = new Map<string, CacheEntry>();
  private hitCount: Record<string, number> = {};
  private missCount: Record<string, number> = {};
  private maxEntries: number;

  constructor(maxEntries = 256) {
    this.maxEntries = maxEntries;
  }

  /**
   * Compute a content-addressable key for a set of inputs.
   * Use this to generate the lookup key for gate results.
   */
  static hashInputs(...inputs: unknown[]): string {
    const hash = createHash('sha256');
    for (const input of inputs) {
      if (input === undefined || input === null) continue;
      if (typeof input === 'string') {
        hash.update(input);
      } else if (typeof input === 'object') {
        hash.update(JSON.stringify(input, Object.keys(input as object).sort()));
      } else {
        hash.update(String(input));
      }
    }
    return hash.digest('hex');
  }

  /**
   * Build a scoped cache key from namespace + input hash.
   */
  static scopedKey(namespace: CacheNamespace, inputHash: string): string {
    return `${namespace}:${inputHash}`;
  }

  /**
   * Look up a cached gate result.
   * Returns the cached verdict if found, or undefined on miss.
   */
  get(namespace: CacheNamespace, inputHash: string): GateVerdict | undefined {
    const key = GateCache.scopedKey(namespace, inputHash);
    const entry = this.entries.get(key);
    if (entry) {
      entry.hits++;
      this.hitCount[namespace] = (this.hitCount[namespace] ?? 0) + 1;
      return entry.verdict;
    }
    this.missCount[namespace] = (this.missCount[namespace] ?? 0) + 1;
    return undefined;
  }

  /**
   * Store a gate result in the cache.
   * Evicts oldest entries if over capacity.
   */
  set(namespace: CacheNamespace, inputHash: string, verdict: GateVerdict): void {
    const key = GateCache.scopedKey(namespace, inputHash);

    // Evict if at capacity
    if (this.entries.size >= this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, v] of this.entries) {
        if (v.createdAt < oldestTime) {
          oldestTime = v.createdAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.entries.delete(oldestKey);
    }

    this.entries.set(key, {
      key: inputHash,
      verdict,
      createdAt: Date.now(),
      hits: 0,
    });
  }

  /**
   * Invalidate all entries for a namespace (e.g., when plan changes).
   */
  invalidate(namespace: CacheNamespace): void {
    for (const [key, _entry] of this.entries) {
      if (key.startsWith(`${namespace}:`)) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Invalidate the entire cache (e.g., on full plan change).
   */
  invalidateAll(): void {
    this.entries.clear();
  }

  /**
   * Get cache statistics for telemetry.
   */
  stats(): GateCacheStats {
    return {
      entries: this.entries.size,
      hits: { ...this.hitCount },
      misses: { ...this.missCount },
    };
  }
}

/** Create a fresh gate cache instance. */
export function createGateCache(maxEntries?: number): GateCache {
  return new GateCache(maxEntries);
}
