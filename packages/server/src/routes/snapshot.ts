import { Hono } from 'hono';
import type { EventBus } from '../runtime-event-bus';
import type { RuntimeSnapshot, RunSummary } from '../types';

export function snapshotRoute(bus: EventBus) {
  const route = new Hono();

  route.get('/', (c) => {
    const { events } = bus.getSnapshot();
    const runMap = new Map<string, RunSummary>();

    for (const ev of events) {
      if (ev.type === 'run_started' || ev.type === 'run_completed') {
        const aid = ev.attemptId ?? 'unknown';
        const existing = runMap.get(aid);
        if (ev.type === 'run_started') {
          runMap.set(aid, {
            attemptId: aid,
            planId: (ev.payload.planId as string) ?? 'unknown',
            verdict: 'HOLD',
            startedAt: ev.timestamp,
            gateCount: 0,
            passedGates: 0,
          });
        } else if (existing) {
          existing.verdict = (ev.payload.verdict as any) ?? existing.verdict;
          existing.finishedAt = ev.timestamp;
          existing.gateCount = (ev.payload.gateCount as number) ?? 0;
          existing.passedGates = (ev.payload.passedGates as number) ?? 0;
        }
      }
    }

    const snapshot: RuntimeSnapshot = {
      timestamp: new Date().toISOString(),
      serverUptime: `${Math.floor(process.uptime())}s`,
      runs: [...runMap.values()],
      circuitBreaker: { state: 'CLOSED', failureRate: 0 },
    };

    return c.json(snapshot);
  });

  return route;
}
