import type { GateVerdictValue } from '@praxis/kernel';

export interface RuntimeEvent {
  id: string;
  type: 'gate_verdict' | 'evidence_captured' | 'run_started' | 'run_completed' | 'heartbeat' | 'error';
  timestamp: string;
  attemptId?: string;
  payload: Record<string, unknown>;
}

export interface RunSummary {
  attemptId: string;
  planId: string;
  verdict: GateVerdictValue;
  startedAt: string;
  finishedAt?: string;
  gateCount: number;
  passedGates: number;
}

export interface RuntimeSnapshot {
  timestamp: string;
  serverUptime: string;
  runs: RunSummary[];
  circuitBreaker: { state: string; failureRate: number };
}
