// @praxis/kernel — Circuit Breaker Types

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureRateThreshold: number;
  windowMinutes: number;
  governorRedMinutes: number;
  halfOpenMaxProbes: number;
}

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureRate: number;
  totalAttempts: number;
  failedAttempts: number;
  lastTransitionAt: string;
  openedAt: string | null;
  triggerReason: string | null;
  halfOpenProbesUsed: number;
}

export interface FailureRecord {
  timestamp: string;
  gateName: string;
  reasonCode: string;
}

export interface CircuitBreakerResult {
  allowed: boolean;
  state: CircuitBreakerState;
  reason?: string;
  status: CircuitBreakerStatus;
}

export interface CircuitBreaker {
  config: CircuitBreakerConfig;
  state: CircuitBreakerState;
  failureRecords: FailureRecord[];
  totalAttempts: number;
  failedAttempts: number;
  lastTransitionAt: string;
  openedAt: string | null;
  triggerReason: string | null;
  halfOpenProbesUsed: number;
}

export const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureRateThreshold: 0.3,
  windowMinutes: 10,
  governorRedMinutes: 15,
  halfOpenMaxProbes: 1,
};
