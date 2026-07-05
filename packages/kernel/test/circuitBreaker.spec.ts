// @praxis/kernel — Circuit Breaker Tests

import { describe, test, expect } from 'bun:test';
import {
  createCircuitBreaker,
  recordFailure,
  recordSuccess,
  allowRequest,
  getStatus,
  reset,
} from '../src/circuit-breaker/circuitBreaker';

describe('CircuitBreaker', () => {
  test('starts in CLOSED state', () => {
    const cb = createCircuitBreaker();
    expect(cb.state).toBe('CLOSED');
    const status = getStatus(cb);
    expect(status.state).toBe('CLOSED');
    expect(status.failureRate).toBe(0);
  });

  test('allows requests when CLOSED', () => {
    const cb = createCircuitBreaker();
    const result = allowRequest(cb);
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('CLOSED');
  });

  test('transitions to OPEN after failure rate exceeds threshold', () => {
    const cb = createCircuitBreaker({ windowMinutes: 60, failureRateThreshold: 0.3 });
    // Record 5 failures out of 5 total → 100% failure rate
    for (let i = 0; i < 5; i++) {
      recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');
    }
    expect(cb.state).toBe('OPEN');
    expect(cb.triggerReason).toContain('failure_rate');
  });

  test('blocks requests when OPEN', () => {
    const cb = createCircuitBreaker({ windowMinutes: 60, failureRateThreshold: 0.3 });
    for (let i = 0; i < 5; i++) recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');
    const result = allowRequest(cb);
    expect(result.allowed).toBe(false);
    expect(result.state).toBe('OPEN');
  });

  test('stays CLOSED with low failure rate', () => {
    const cb = createCircuitBreaker({ windowMinutes: 60, failureRateThreshold: 0.5 });
    // 2 failures out of 10 → 20% rate, below 50% threshold
    for (let i = 0; i < 8; i++) recordSuccess(cb);
    for (let i = 0; i < 2; i++) recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');
    expect(cb.state).toBe('CLOSED');
  });

  test('allows exactly one probe in HALF_OPEN', () => {
    const cb = createCircuitBreaker({ windowMinutes: 60, failureRateThreshold: 0.3 });
    // Force OPEN
    for (let i = 0; i < 5; i++) recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');

    // Manually set to HALF_OPEN (simulating cooldown)
    cb.state = 'HALF_OPEN';
    cb.halfOpenProbesUsed = 0;

    // First probe allowed
    const probe1 = allowRequest(cb);
    expect(probe1.allowed).toBe(true);
    expect(probe1.state).toBe('HALF_OPEN');

    // Second probe blocked
    const probe2 = allowRequest(cb);
    expect(probe2.allowed).toBe(false);
  });

  test('returns to CLOSED after successful probe', () => {
    const cb = createCircuitBreaker({ windowMinutes: 60, failureRateThreshold: 0.3 });
    for (let i = 0; i < 5; i++) recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');
    cb.state = 'HALF_OPEN';
    cb.halfOpenProbesUsed = 0;

    recordSuccess(cb);
    expect(cb.state).toBe('CLOSED');
    expect(cb.failedAttempts).toBe(0);
  });

  test('returns to OPEN after failed probe', () => {
    const cb = createCircuitBreaker({ windowMinutes: 60, failureRateThreshold: 0.3 });
    for (let i = 0; i < 5; i++) recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');
    cb.state = 'HALF_OPEN';
    cb.halfOpenProbesUsed = 0;

    recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');
    expect(cb.state).toBe('OPEN');
  });

  test('reset() returns to CLOSED', () => {
    const cb = createCircuitBreaker({ windowMinutes: 60, failureRateThreshold: 0.3 });
    for (let i = 0; i < 5; i++) recordFailure(cb, 'ExecGate', 'COMMAND_TIMEOUT');
    expect(cb.state).toBe('OPEN');

    reset(cb);
    expect(cb.state).toBe('CLOSED');
    expect(cb.failureRecords.length).toBe(0);
    expect(cb.totalAttempts).toBe(0);
  });

  test('getStatus() returns current state', () => {
    const cb = createCircuitBreaker();
    const status = getStatus(cb);
    expect(status.state).toBe('CLOSED');
    expect(typeof status.failureRate).toBe('number');
    expect(typeof status.totalAttempts).toBe('number');
    expect(typeof status.lastTransitionAt).toBe('string');
  });
});
