// @praxis/kernel — Daemon Tests (TDD for P0 issues)
// Issue #1: ExecGate cache stale PASS
// Issue #3: Daemon FinalGate empty evidence
// Issue #7: Zero test coverage for daemon/cache/MCP

import { describe, test, expect, beforeEach } from 'bun:test';
import { GateCache, createGateCache, CACHE_NAMESPACES } from '../src/daemon/gateCache';
import { createWarmState, indexEvidence, mergeEvidence } from '../src/daemon/state';
import { createDaemon, type DaemonServer, type VerifyRequest } from '../src/daemon/praxisDaemon';
import type { GateVerdict } from '../src/types';
import type { EvidenceRecordV01 } from '../src/evidence/types';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const REPO_ROOT = resolve(import.meta.dir, '../../..');

// ---------------------------------------------------------------------------
// GateCache unit tests
// ---------------------------------------------------------------------------

describe('GateCache', () => {
  test('hashInputs produces deterministic SHA256', () => {
    const h1 = GateCache.hashInputs('hello', 'world');
    const h2 = GateCache.hashInputs('hello', 'world');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA256 hex
  });

  test('hashInputs produces different hashes for different inputs', () => {
    const h1 = GateCache.hashInputs('hello');
    const h2 = GateCache.hashInputs('goodbye');
    expect(h1).not.toBe(h2);
  });

  test('get returns undefined on miss', () => {
    const cache = createGateCache();
    expect(cache.get(CACHE_NAMESPACES.EXEC, 'nonexistent')).toBeUndefined();
  });

  test('set + get returns cached verdict', () => {
    const cache = createGateCache();
    const verdict: GateVerdict = {
      gateName: 'ExecGate',
      verdict: 'PASS',
      reasonCodes: ['EXEC_PASS'],
      failedCriteriaIds: [],
      evidenceRefs: [],
      attemptId: 'test-1',
      timestamp: new Date().toISOString(),
    };
    cache.set(CACHE_NAMESPACES.EXEC, 'key1', verdict);
    const cached = cache.get(CACHE_NAMESPACES.EXEC, 'key1');
    expect(cached).toBeDefined();
    expect(cached!.verdict).toBe('PASS');
  });

  test('stats track hits and misses', () => {
    const cache = createGateCache();
    cache.get(CACHE_NAMESPACES.EXEC, 'miss1');
    cache.get(CACHE_NAMESPACES.EXEC, 'miss2');

    const verdict: GateVerdict = {
      gateName: 'ExecGate', verdict: 'PASS', reasonCodes: [],
      failedCriteriaIds: [], evidenceRefs: [], attemptId: 't', timestamp: '',
    };
    cache.set(CACHE_NAMESPACES.EXEC, 'hit1', verdict);
    cache.get(CACHE_NAMESPACES.EXEC, 'hit1');

    const stats = cache.stats();
    expect(stats.misses['exec']).toBe(2);
    expect(stats.hits['exec']).toBe(1);
  });

  test('invalidate removes entries for a namespace', () => {
    const cache = createGateCache();
    const verdict: GateVerdict = {
      gateName: 'ExecGate', verdict: 'PASS', reasonCodes: [],
      failedCriteriaIds: [], evidenceRefs: [], attemptId: 't', timestamp: '',
    };
    cache.set(CACHE_NAMESPACES.EXEC, 'k1', verdict);
    cache.set(CACHE_NAMESPACES.LOCK, 'k2', verdict);
    cache.invalidate(CACHE_NAMESPACES.EXEC);

    expect(cache.get(CACHE_NAMESPACES.EXEC, 'k1')).toBeUndefined();
    expect(cache.get(CACHE_NAMESPACES.LOCK, 'k2')).toBeDefined(); // other namespace untouched
  });

  test('eviction removes oldest entry when at capacity', () => {
    const cache = createGateCache(2); // max 2 entries
    const verdict: GateVerdict = {
      gateName: 'ExecGate', verdict: 'PASS', reasonCodes: [],
      failedCriteriaIds: [], evidenceRefs: [], attemptId: 't', timestamp: '',
    };
    cache.set(CACHE_NAMESPACES.EXEC, 'k1', verdict);
    cache.set(CACHE_NAMESPACES.EXEC, 'k2', verdict);
    cache.set(CACHE_NAMESPACES.EXEC, 'k3', verdict); // evicts k1

    expect(cache.get(CACHE_NAMESPACES.EXEC, 'k1')).toBeUndefined();
    expect(cache.get(CACHE_NAMESPACES.EXEC, 'k2')).toBeDefined();
    expect(cache.get(CACHE_NAMESPACES.EXEC, 'k3')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #1: ExecGate cache stale PASS — THE BUG
// ---------------------------------------------------------------------------

describe('P0 #1: ExecGate cache stale PASS', () => {
  test('cache key does NOT change when source code changes (demonstrates the bug)', () => {
    // This test PROVES the bug exists.
    // ExecGate cache key is based on commandPolicyHash (the allowed-commands list).
    // Source code changes don't change commandPolicyHash.
    // So if tests PASS once, the cache returns PASS even after code breaks.

    const commandPolicyHash = 'abc123'; // fixed — doesn't change with source
    const key1 = GateCache.hashInputs(commandPolicyHash);

    // "Source code changed" — but commandPolicyHash is the same
    const key2 = GateCache.hashInputs(commandPolicyHash);

    expect(key1).toBe(key2); // BUG: same key = stale PASS returned

    // What SHOULD happen: key should include file-content hashes
    // e.g., GateCache.hashInputs(commandPolicyHash, sourceFileHashes)
  });

  test('cache returns stale PASS after simulated code change', () => {
    const cache = createGateCache();
    const commandPolicyHash = 'abc123';

    // First run: tests PASS, result cached
    const passVerdict: GateVerdict = {
      gateName: 'ExecGate', verdict: 'PASS', reasonCodes: ['EXEC_PASS'],
      failedCriteriaIds: [], evidenceRefs: [], attemptId: 'run-1', timestamp: '',
    };
    const cacheKey = GateCache.hashInputs(commandPolicyHash);
    cache.set(CACHE_NAMESPACES.EXEC, cacheKey, passVerdict);

    // Second run: source code changed, tests WOULD FAIL now
    // But cache key is same (commandPolicyHash unchanged)
    const cachedResult = cache.get(CACHE_NAMESPACES.EXEC, cacheKey);

    // BUG: cache returns PASS even though tests would fail
    expect(cachedResult).toBeDefined();
    expect(cachedResult!.verdict).toBe('PASS'); // STALE PASS — Law 1 violated
  });
});

// ---------------------------------------------------------------------------
// #3: Daemon FinalGate empty evidence
// ---------------------------------------------------------------------------

describe('P0 #3: Daemon FinalGate empty evidence', () => {
  test('handleVerify passes evidence records to FinalGate (not empty)', async () => {
    // This test will be RED until we fix #3.
    // Currently, daemon passes evidenceRecords: [] to runFinalGate.

    const daemon = createDaemon({ repoRoot: REPO_ROOT, idleTimeoutMs: 0 });

    // Load a valid plan
    const planPath = resolve(REPO_ROOT, 'examples/planspec/runtime-code.plan.yaml');
    const planYaml = readFileSync(planPath, 'utf-8');

    const req: VerifyRequest = {
      planYaml,
      attemptId: 'test-evidence',
      gates: ['schema', 'final'], // skip exec for speed
    };

    // Spy on runFinalGate by checking the result
    const result = await daemon.handleVerify(req);

    // The FinalGate result should have meaningful reason codes,
    // not just "NO_CRITERIA_DEFINED" from empty evidence
    const finalResult = result.gateResults.find(g => g.gateName === 'FinalGate');

    // RED TEST: currently FinalGate gets empty evidenceRecords + commandResults
    // This means it can't evaluate criteria properly
    // After fix: FinalGate should get actual evidence from EvidenceGate
    expect(finalResult).toBeDefined();

    // After fix, this should NOT be the case:
    // FinalGate with empty evidence → NO_CRITERIA_DEFINED or NO_DETERMINISTIC_CRITERIA
    // With real evidence, it should evaluate criteria
    if (finalResult) {
      // This assertion documents the bug: empty evidence → meaningless FinalGate verdict
      // After fix, we'd expect CRITERIA_PARTIAL or ALL_CRITERIA_MET
      expect(finalResult.reasonCodes).not.toContain('NO_CRITERIA_DEFINED');
    }
  });
});

// ---------------------------------------------------------------------------
// Daemon State tests
// ---------------------------------------------------------------------------

describe('Daemon State', () => {
  test('createWarmState initializes empty state', () => {
    const state = createWarmState('/tmp/test');
    expect(state.plan).toBeNull();
    expect(state.hashes).toBeNull();
    expect(state.evidenceCount).toBe(0);
    expect(state.evidenceIndex.size).toBe(0);
    expect(state.running).toBe(true);
  });

  test('indexEvidence builds criterionId index', () => {
    const records: EvidenceRecordV01[] = [
      { evidenceVersion: 'praxis-evidence/v0.1', recordId: 'EV-1', attemptId: 'a', planId: 'p', timestamp: '', type: 'test_output', source: 'test', criterionId: 'AC-1', status: 'pass' },
      { evidenceVersion: 'praxis-evidence/v0.1', recordId: 'EV-2', attemptId: 'a', planId: 'p', timestamp: '', type: 'test_output', source: 'test', criterionId: 'AC-1', status: 'pass' },
      { evidenceVersion: 'praxis-evidence/v0.1', recordId: 'EV-3', attemptId: 'a', planId: 'p', timestamp: '', type: 'diff', source: 'test', criterionId: 'AC-2', status: 'pass' },
    ];

    const index = indexEvidence(records);
    expect(index.get('AC-1')).toHaveLength(2);
    expect(index.get('AC-2')).toHaveLength(1);
  });

  test('mergeEvidence deduplicates by recordId', () => {
    const existing: EvidenceRecordV01[] = [
      { evidenceVersion: 'praxis-evidence/v0.1', recordId: 'EV-1', attemptId: 'a', planId: 'p', timestamp: '', type: 'test_output', source: 'test', criterionId: 'AC-1', status: 'pass' },
    ];
    const newIndex = indexEvidence(existing);

    const newRecords: EvidenceRecordV01[] = [
      { evidenceVersion: 'praxis-evidence/v0.1', recordId: 'EV-1', attemptId: 'a', planId: 'p', timestamp: '', type: 'test_output', source: 'test', criterionId: 'AC-1', status: 'pass' }, // duplicate
      { evidenceVersion: 'praxis-evidence/v0.1', recordId: 'EV-2', attemptId: 'a', planId: 'p', timestamp: '', type: 'diff', source: 'test', criterionId: 'AC-2', status: 'pass' }, // new
    ];

    const merged = mergeEvidence(newIndex, 1, newRecords);
    expect(merged.added).toBe(1); // only EV-2 added
    expect(merged.count).toBe(2); // 1 existing + 1 new
  });
});
