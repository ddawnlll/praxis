import { describe, test, expect } from 'bun:test';
import { createGovernor, canAdmitWorker, admitWorker, completeWorker, getGovernorState } from '../src/governor/governor';

describe('Governor', () => {
  test('starts at stable_3 by default', () => {
    const g = createGovernor();
    expect(g.state.currentTier).toBe('stable_3');
    expect(g.state.maxWorkers).toBe(3);
  });

  test('canAdmitWorker returns true when below limit', () => {
    const g = createGovernor();
    expect(canAdmitWorker(g).allowed).toBe(true);
    admitWorker(g);
    admitWorker(g);
    expect(canAdmitWorker(g).allowed).toBe(true);
  });

  test('canAdmitWorker returns false when at limit', () => {
    const g = createGovernor();
    admitWorker(g);
    admitWorker(g);
    admitWorker(g);
    const result = canAdmitWorker(g);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('At max workers');
  });

  test('demotes on high failure rate', () => {
    const g = createGovernor({ initialTier: 'stable_6', promotionWindowHours: 999, demotionFailureThreshold: 0.3 });
    for (let i = 0; i < 3; i++) { admitWorker(g); completeWorker(g, true); }
    for (let i = 0; i < 2; i++) { admitWorker(g); completeWorker(g, false); }
    // 2 failures out of 5 = 40% > 30% threshold → demote
    expect(g.state.currentTier).toBe('stable_3');
    expect(g.state.lastDemotionAt).toBeTruthy();
  });

  test('stays at tier with low failure rate', () => {
    const g = createGovernor({ initialTier: 'stable_3', promotionWindowHours: 999, demotionFailureThreshold: 0.3 });
    for (let i = 0; i < 10; i++) { admitWorker(g); completeWorker(g, true); }
    expect(g.state.currentTier).toBe('stable_3');
    expect(g.state.lastDemotionAt).toBeNull();
  });

  test('getGovernorState returns snapshot', () => {
    const g = createGovernor();
    const state = getGovernorState(g);
    expect(state.currentTier).toBe('stable_3');
    expect(state.maxWorkers).toBe(3);
    expect(state.tierHistory.length).toBe(1);
  });
});
