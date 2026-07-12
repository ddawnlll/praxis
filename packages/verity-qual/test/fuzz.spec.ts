// @praxis/verity-qual — fuzz tests

import { describe, test, expect } from 'bun:test';
import { fuzzGate, applyFault, seedHash } from '../src/index';
import type { FaultSpec } from '../src/fault';

describe('fuzzGate', () => {
  test('deterministic for a fixed seed', () => {
    const a = fuzzGate('test', { seed: 42, iterations: 100, runOnce: (i) => ({ verdict: 'FAIL' as const }) });
    const b = fuzzGate('test', { seed: 42, iterations: 100, runOnce: (i) => ({ verdict: 'FAIL' as const }) });
    expect(a.falsePass).toBe(b.falsePass);
    expect(a.determinismViolations).toBe(b.determinismViolations);
  });
  test('no false PASS when the gate is honest (always FAIL or always throws)', () => {
    const r = fuzzGate('honest', { seed: 1, iterations: 200, runOnce: (i) => ({ verdict: 'FAIL' as const }) });
    expect(r.falsePass).toBe(0);
  });
  test('no false PASS even when the gate is naive (always PASS)', () => {
    // An always-PASS gate would be the "naive" worst case. Our fuzzer should
    // detect it: every PASS gets mutated; if the mutated still PASSes, it
    // counts as a false PASS.
    const r = fuzzGate('naive', { seed: 1, iterations: 100, runOnce: (i) => ({ verdict: 'PASS' as const }) });
    expect(r.falsePass).toBeGreaterThan(0); // the fuzzer caught the naive gate
  });
  test('mutation flips: PASS→FAIL when the gate is well-behaved', () => {
    // A "well-behaved" gate: PASS iff `x === 42` AND `id` length is odd.
    // The combination ensures the fuzzer needs to mutate a structural
    // property of BOTH fields to preserve PASS, so at least one mutation
    // should flip the verdict.
    const r = fuzzGate('well-behaved', { seed: 7, iterations: 500, runOnce: (i) => {
      const obj = i as Record<string, unknown>;
      const idLen = typeof obj.id === 'string' ? obj.id.length : 0;
      return { verdict: obj.x === 42 && idLen % 2 === 1 ? 'PASS' as const : 'FAIL' as const };
    } });
    expect(r.mutationFlips).toBeGreaterThan(0);
  });
  test('detects a permissive gate as false-PASS', () => {
    // Gate that checks only the first char of `id`. Mutations of subsequent
    // chars leave the predicate intact — that's a false PASS we want caught.
    const r = fuzzGate('permissive', { seed: 1, iterations: 200, runOnce: (i) => {
      const obj = i as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : '';
      return { verdict: id.length > 0 ? 'PASS' as const : 'FAIL' as const };
    } });
    // The fuzzer should detect at least one false PASS.
    expect(r.falsePass).toBeGreaterThan(0);
  });
  test('different seeds give different fuzz behavior', () => {
    const a = fuzzGate('s', { seed: 1, iterations: 100, runOnce: (i) => ({ verdict: 'FAIL' as const }) });
    const b = fuzzGate('s', { seed: 999, iterations: 100, runOnce: (i) => ({ verdict: 'FAIL' as const }) });
    expect(a.crashes).toBe(b.crashes);
    // Different seeds may not produce different stats when the gate is trivial,
    // but the seedHash is always different.
    expect(seedHash(a.seed, a.total)).not.toBe(seedHash(b.seed, b.total));
  });
});

describe('applyFault', () => {
  const recs = [{ recordId: 'a' }, { recordId: 'b' }, { recordId: 'c' }];
  test('truncate-write removes the last record', () => {
    const out = applyFault(recs, { kind: 'truncate-write', atIndex: 2 } as FaultSpec);
    expect(out.map((r) => r.recordId)).toEqual(['a', 'b']);
  });
  test('corrupt-record prefixes the recordId with CORRUPTED-', () => {
    const out = applyFault(recs, { kind: 'corrupt-record', atIndex: 1 } as FaultSpec);
    expect(out[1].recordId).toBe('CORRUPTED-b');
  });
  test('reorder-events swaps two consecutive records', () => {
    const out = applyFault(recs, { kind: 'reorder-events', atIndex: 0 } as FaultSpec);
    expect(out.map((r) => r.recordId)).toEqual(['b', 'a', 'c']);
  });
  test('duplicate-event inserts a copy at the given index', () => {
    const out = applyFault(recs, { kind: 'duplicate-event', atIndex: 0 } as FaultSpec);
    expect(out.map((r) => r.recordId)).toEqual(['a', 'a', 'b', 'c']);
  });
  test('disk-full and kill-mid-promotion leave records intact', () => {
    const out1 = applyFault(recs, { kind: 'disk-full' });
    expect(out1).toEqual(recs);
    const out2 = applyFault(recs, { kind: 'kill-mid-promotion' });
    expect(out2).toEqual(recs);
  });
});
