import { Hono } from 'hono';
import type { EventBus } from '../runtime-event-bus';

export function verifyRoute(bus: EventBus) {
  const route = new Hono();

  route.post('/', async (c) => {
    const body = await c.req.json();
    const { planYaml, evidenceRecords, changedFiles } = body as {
      planYaml?: string;
      evidenceRecords?: any[];
      changedFiles?: Array<{ path: string; status: string }>;
    };

    if (!planYaml) return c.json({ error: 'planYaml is required' }, 400);

    const { runKernel } = await import('@praxis/kernel');
    const attemptId = `server-${Date.now()}`;

    bus.publish({
      id: `evt-${Date.now()}-start`,
      type: 'run_started',
      timestamp: new Date().toISOString(),
      attemptId,
      payload: { planId: 'unknown' },
    });

    try {
      const result = await runKernel({
        planYaml,
        repoRoot: process.cwd(),
        attemptId,
        lockMode: 'create_if_missing',
        evidenceRecords: evidenceRecords ?? [],
        changedFiles: changedFiles as any,
        commandOverrides: [],
      });

      bus.publish({
        id: `evt-${Date.now()}-complete`,
        type: 'run_completed',
        timestamp: new Date().toISOString(),
        attemptId,
        payload: {
          verdict: result.verdict,
          gateCount: result.gateVerdicts.length,
          passedGates: result.gateVerdicts.filter(g => g.verdict === 'PASS').length,
        },
      });

      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg, attemptId }, 500);
    }
  });

  return route;
}
