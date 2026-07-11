// @praxis/verity-replay — golden replay scenarios tests

import { describe, test, expect } from 'bun:test';
import { InProcessScenarioRunner, runAllScenarios } from '../src/scenarios';

describe('golden replay scenarios', () => {
  const runner = new InProcessScenarioRunner();
  test('listScenarios returns the 6 named scenarios', () => {
    expect(runner.listScenarios()).toEqual([
      'stale-base',
      'crash-mid-promotion',
      'irreversible-AFK',
      'postcondition-rollback',
      'dual-surface-kill',
      'receipt-expiry-replay',
    ]);
  });
  test('stale-base → PASS (verdict is FAIL on stale base)', async () => {
    const r = await runner.run('stale-base');
    expect(r.verdict).toBe('PASS');
  });
  test('crash-mid-promotion → PASS (idempotent replay)', async () => {
    const r = await runner.run('crash-mid-promotion');
    expect(r.verdict).toBe('PASS');
  });
  test('irreversible-AFK → PASS (irreversible without human is FAIL)', async () => {
    const r = await runner.run('irreversible-AFK');
    expect(r.verdict).toBe('PASS');
  });
  test('postcondition-rollback → PASS', async () => {
    const r = await runner.run('postcondition-rollback');
    expect(r.verdict).toBe('PASS');
  });
  test('dual-surface-kill → PASS (either surface FAILs)', async () => {
    const r = await runner.run('dual-surface-kill');
    expect(r.verdict).toBe('PASS');
  });
  test('receipt-expiry-replay → PASS (consumed + expired are FAIL)', async () => {
    const r = await runner.run('receipt-expiry-replay');
    expect(r.verdict).toBe('PASS');
  });
  test('unknown scenario → FAIL', async () => {
    const r = await runner.run('not-a-scenario');
    expect(r.verdict).toBe('FAIL');
  });
  test('runAllScenarios returns PASS for all 6 named scenarios', async () => {
    const results = await runAllScenarios();
    expect(results.length).toBe(6);
    expect(results.every((r) => r.verdict === 'PASS')).toBe(true);
  });
});
