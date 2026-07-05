// @praxis/kernel — Circuit Breaker
// Safety component: CLOSED → OPEN → HALF_OPEN → CLOSED
// Prevents work admission when the system is unstable.

import type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerResult,
  CircuitBreakerStatus,
  FailureRecord,
  CircuitBreakerState,
} from './types';
import { DEFAULT_CB_CONFIG } from './types';
import { computeFailureRate, evictOldRecords, recordFailure as addFailure } from './failureRateTracker';

function now(): string {
  return new Date().toISOString();
}

function buildStatus(cb: CircuitBreaker): CircuitBreakerStatus {
  const { rate } = computeFailureRate(cb.failureRecords, cb.config.windowMinutes);
  return {
    state: cb.state,
    failureRate: rate,
    totalAttempts: cb.totalAttempts,
    failedAttempts: cb.failedAttempts,
    lastTransitionAt: cb.lastTransitionAt,
    openedAt: cb.openedAt,
    triggerReason: cb.triggerReason,
    halfOpenProbesUsed: cb.halfOpenProbesUsed,
  };
}

function shouldTransitionToOpen(cb: CircuitBreaker): { shouldOpen: boolean; reason: string | null } {
  const { rate } = computeFailureRate(cb.failureRecords, cb.config.windowMinutes);
  if (rate > cb.config.failureRateThreshold) {
    return { shouldOpen: true, reason: `failure_rate ${(rate * 100).toFixed(1)}% > threshold ${(cb.config.failureRateThreshold * 100).toFixed(0)}%` };
  }
  return { shouldOpen: false, reason: null };
}

export function createCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  return {
    config: { ...DEFAULT_CB_CONFIG, ...config },
    state: 'CLOSED',
    failureRecords: [],
    totalAttempts: 0,
    failedAttempts: 0,
    lastTransitionAt: now(),
    openedAt: null,
    triggerReason: null,
    halfOpenProbesUsed: 0,
  };
}

export function recordFailure(
  cb: CircuitBreaker,
  gateName: string,
  reasonCode: string,
): CircuitBreaker {
  const record: FailureRecord = { timestamp: now(), gateName, reasonCode };
  cb.failureRecords = addFailure(cb.failureRecords, record);
  cb.failureRecords = evictOldRecords(cb.failureRecords, cb.config.windowMinutes);
  cb.totalAttempts++;
  cb.failedAttempts++;

  if (cb.state === 'CLOSED') {
    const { shouldOpen, reason } = shouldTransitionToOpen(cb);
    if (shouldOpen) {
      cb.state = 'OPEN';
      cb.lastTransitionAt = now();
      cb.openedAt = now();
      cb.triggerReason = reason;
    }
  } else if (cb.state === 'HALF_OPEN') {
    cb.state = 'OPEN';
    cb.lastTransitionAt = now();
    cb.openedAt = now();
    cb.triggerReason = 'Half-open probe failed';
  }

  return cb;
}

export function recordSuccess(cb: CircuitBreaker): CircuitBreaker {
  cb.totalAttempts++;
  cb.failureRecords = addFailure(cb.failureRecords, {
    timestamp: now(),
    gateName: 'all',
    reasonCode: 'SUCCESS',
  });

  if (cb.state === 'HALF_OPEN') {
    cb.state = 'CLOSED';
    cb.lastTransitionAt = now();
    cb.openedAt = null;
    cb.triggerReason = null;
    cb.halfOpenProbesUsed = 0;
    cb.failureRecords = [];
    cb.failedAttempts = 0;
  }

  return cb;
}

export function allowRequest(cb: CircuitBreaker): CircuitBreakerResult {
  const status = buildStatus(cb);

  if (cb.state === 'CLOSED') {
    return { allowed: true, state: 'CLOSED', status };
  }

  if (cb.state === 'OPEN') {
    return { allowed: false, state: 'OPEN', reason: cb.triggerReason ?? 'Circuit breaker is OPEN', status };
  }

  // HALF_OPEN — allow exactly one probe
  if (cb.halfOpenProbesUsed >= cb.config.halfOpenMaxProbes) {
    return { allowed: false, state: 'HALF_OPEN', reason: 'Max half-open probes used', status };
  }

  cb.halfOpenProbesUsed++;
  return { allowed: true, state: 'HALF_OPEN', reason: 'Half-open probe attempt', status };
}

export function getStatus(cb: CircuitBreaker): CircuitBreakerStatus {
  return buildStatus(cb);
}

export function reset(cb: CircuitBreaker): CircuitBreaker {
  cb.state = 'CLOSED';
  cb.failureRecords = [];
  cb.totalAttempts = 0;
  cb.failedAttempts = 0;
  cb.lastTransitionAt = now();
  cb.openedAt = null;
  cb.triggerReason = null;
  cb.halfOpenProbesUsed = 0;
  return cb;
}
