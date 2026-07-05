import { describe, test, expect } from 'bun:test';
import { createGovernor, canAdmitWorker, admitWorker, completeWorker } from '../src/governor/governor';
import { TIER_LIMITS, TIER_ORDER } from '../src/governor/types';

describe('Governor — stable_16 tiers', () => {
  test('TIER_LIMITS has correct values', () => {
    expect(TIER_LIMITS.stable_0).toBe(0);
    expect(TIER_LIMITS.stable_3).toBe(3);
    expect(TIER_LIMITS.stable_6).toBe(6);
    expect(TIER_LIMITS.stable_8).toBe(8);
    expect(TIER_LIMITS.stable_12).toBe(12);
    expect(TIER_LIMITS.stable_16).toBe(16);
  });

  test('TIER_ORDER has correct sequence', () => {
    expect(TIER_ORDER).toEqual(['stable_0', 'stable_3', 'stable_6', 'stable_8', 'stable_12', 'stable_16']);
  });

  test('starts at stable_16 when configured', () => {
    const g = createGovernor({ initialTier: 'stable_16' });
    expect(g.state.currentTier).toBe('stable_16');
    expect(g.state.maxWorkers).toBe(16);
  });

  test('admits 16 workers at stable_16, blocks 17th', () => {
    const g = createGovernor({ initialTier: 'stable_16' });
    for (let i = 0; i < 16; i++) {
      expect(canAdmitWorker(g).allowed).toBe(true);
      admitWorker(g);
    }
    expect(canAdmitWorker(g).allowed).toBe(false);
  });

  test('promotes when clean ops exceed window', () => {
    const g = createGovernor({
      initialTier: 'stable_3',
      promotionWindowHours: 0,
      demotionFailureThreshold: 0.3,
    });
    for (let i = 0; i < 3; i++) { admitWorker(g); completeWorker(g, true); }
    expect(g.state.tierHistory.length).toBeGreaterThan(1);
  });

  test('each failure demotes one tier', () => {
    const g = createGovernor({
      initialTier: 'stable_6',
      promotionWindowHours: 999,
      demotionFailureThreshold: 0.01, // any failure triggers demotion
    });
    // 1 failure → stable_6 → stable_3
    admitWorker(g); completeWorker(g, false);
    expect(g.state.currentTier).toBe('stable_3');
    // 2nd failure → stable_3 → stable_0
    admitWorker(g); completeWorker(g, false);
    expect(g.state.currentTier).toBe('stable_0');
  });

  test('demotes from stable_16 progressively', () => {
    const g = createGovernor({
      initialTier: 'stable_16',
      promotionWindowHours: 999,
      demotionFailureThreshold: 0.01,
    });
    // 1 failure → stable_16 → stable_12
    admitWorker(g); completeWorker(g, false);
    expect(g.state.currentTier).toBe('stable_12');
    // 2nd failure → stable_12 → stable_8
    admitWorker(g); completeWorker(g, false);
    expect(g.state.currentTier).toBe('stable_8');
  });

  test('demotes to stable_0 from stable_3', () => {
    const g = createGovernor({
      initialTier: 'stable_3',
      promotionWindowHours: 999,
      demotionFailureThreshold: 0.01,
    });
    admitWorker(g); completeWorker(g, false);
    expect(g.state.currentTier).toBe('stable_0');
  });
});
