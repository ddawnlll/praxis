// @praxis/kernel — Circuit Breaker Public API

export type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerStatus,
  CircuitBreakerResult,
  FailureRecord,
} from './types';
export { DEFAULT_CB_CONFIG } from './types';
export {
  createCircuitBreaker,
  recordFailure,
  recordSuccess,
  allowRequest,
  getStatus,
  reset,
} from './circuitBreaker';
export {
  recordFailure as addFailureRecord,
  computeFailureRate,
  evictOldRecords,
} from './failureRateTracker';
