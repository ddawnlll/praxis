// @praxis/kernel — Failure Rate Tracker

import type { FailureRecord } from './types';

export function recordFailure(
  tracker: FailureRecord[],
  record: FailureRecord,
): FailureRecord[] {
  return [...tracker, record];
}

export function computeFailureRate(
  tracker: FailureRecord[],
  windowMinutes: number,
): { rate: number; total: number; failed: number } {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const recent = tracker.filter(r => new Date(r.timestamp).getTime() >= cutoff);
  const total = recent.length;
  const failed = recent.filter(r => r.reasonCode !== 'SUCCESS').length;
  return {
    rate: total > 0 ? failed / total : 0,
    total,
    failed,
  };
}

export function evictOldRecords(
  tracker: FailureRecord[],
  windowMinutes: number,
): FailureRecord[] {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  return tracker.filter(r => new Date(r.timestamp).getTime() >= cutoff);
}
