// @praxis/kernel — Governor
// Concurrency management: controls how many workers can safely run.
// Tiers progress from stable_3 through stable_16 based on clean operation.

import type { GovernorConfig, GovernorState, GovernorTier } from './types';
import { TIER_LIMITS, TIER_ORDER, DEFAULT_GOV_CONFIG } from './types';

function now(): string { return new Date().toISOString(); }

export interface Governor {
  config: GovernorConfig;
  state: GovernorState;
  failureCount: number;
  totalOperations: number;
  windowStart: string;
}

export function createGovernor(config?: Partial<GovernorConfig>): Governor {
  const cfg = { ...DEFAULT_GOV_CONFIG, ...config };
  const initialTier: GovernorTier = cfg.initialTier;
  return {
    config: cfg,
    state: {
      currentTier: initialTier,
      maxWorkers: TIER_LIMITS[initialTier],
      activeWorkers: 0,
      queuedWorkers: 0,
      tierHistory: [{ tier: initialTier, startedAt: now(), reason: 'initial' }],
      cleanOperationStartedAt: now(),
      lastPromotionAt: null,
      lastDemotionAt: null,
    },
    failureCount: 0,
    totalOperations: 0,
    windowStart: now(),
  };
}

export function canAdmitWorker(gov: Governor): { allowed: boolean; reason?: string } {
  if (gov.state.activeWorkers >= gov.state.maxWorkers) {
    return { allowed: false, reason: `At max workers (${gov.state.maxWorkers}) for tier ${gov.state.currentTier}` };
  }
  return { allowed: true };
}

export function admitWorker(gov: Governor): Governor {
  gov.state.activeWorkers++;
  gov.state.queuedWorkers = Math.max(0, gov.state.queuedWorkers - 1);
  return gov;
}

export function completeWorker(gov: Governor, success: boolean): Governor {
  gov.state.activeWorkers = Math.max(0, gov.state.activeWorkers - 1);
  gov.totalOperations++;
  if (!success) gov.failureCount++;

  // Check demotion: if failure rate exceeds threshold
  const rate = gov.totalOperations > 0 ? gov.failureCount / gov.totalOperations : 0;
  if (rate > gov.config.demotionFailureThreshold && gov.state.currentTier !== 'stable_0') {
    return demote(gov, `Failure rate ${(rate * 100).toFixed(0)}% exceeds threshold`);
  }

  // Check promotion: enough clean time and low failure rate
  const cleanHours = (Date.now() - new Date(gov.state.cleanOperationStartedAt).getTime()) / 3600000;
  if (cleanHours >= gov.config.promotionWindowHours && rate <= gov.config.demotionFailureThreshold / 2) {
    return promote(gov, `${gov.config.promotionWindowHours}h clean operation`);
  }

  return gov;
}

function promote(gov: Governor, reason: string): Governor {
  const idx = TIER_ORDER.indexOf(gov.state.currentTier);
  if (idx >= TIER_ORDER.length - 1) return gov; // already at max
  const nextTier = TIER_ORDER[idx + 1];
  gov.state.currentTier = nextTier;
  gov.state.maxWorkers = TIER_LIMITS[nextTier];
  gov.state.lastPromotionAt = now();
  gov.state.tierHistory.push({ tier: nextTier, startedAt: now(), reason });
  gov.state.cleanOperationStartedAt = now();
  gov.failureCount = 0;
  gov.totalOperations = 0;
  return gov;
}

function demote(gov: Governor, reason: string): Governor {
  const idx = TIER_ORDER.indexOf(gov.state.currentTier);
  if (idx <= 0) return gov; // already at min
  const prevTier = TIER_ORDER[idx - 1];
  gov.state.currentTier = prevTier;
  gov.state.maxWorkers = TIER_LIMITS[prevTier];
  gov.state.lastDemotionAt = now();
  gov.state.tierHistory.push({ tier: prevTier, startedAt: now(), reason });
  gov.state.cleanOperationStartedAt = now();
  gov.failureCount = 0;
  gov.totalOperations = 0;
  return gov;
}

export function getGovernorState(gov: Governor): GovernorState {
  return { ...gov.state };
}

export function setWorkerQueue(gov: Governor, count: number): Governor {
  gov.state.queuedWorkers = count;
  return gov;
}
