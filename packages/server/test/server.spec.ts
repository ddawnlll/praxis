import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer, getEventBus } from '../src/server';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEventBus } from '../src/runtime-event-bus';

describe('Server health', () => {
  const app = createServer();

  test('GET /health returns 200 with status ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('praxis-server');
  });
});

describe('Event bus', () => {
  test('publishes and retrieves events', () => {
    const bus = createEventBus();
    bus.publish({ id: 'evt-1', type: 'heartbeat', timestamp: new Date().toISOString(), payload: {} });
    bus.publish({ id: 'evt-2', type: 'run_started', timestamp: new Date().toISOString(), attemptId: 'run-1', payload: {} });

    const events = bus.getEvents();
    expect(events.length).toBe(2);
    expect(events[0].id).toBe('evt-1');
    expect(events[1].id).toBe('evt-2');
  });

  test('getEvents(afterId) returns only newer events', () => {
    const bus = createEventBus();
    bus.publish({ id: 'a', type: 'heartbeat', timestamp: '', payload: {} });
    bus.publish({ id: 'b', type: 'heartbeat', timestamp: '', payload: {} });
    bus.publish({ id: 'c', type: 'heartbeat', timestamp: '', payload: {} });

    const after = bus.getEvents('a');
    expect(after.length).toBe(2);
    expect(after[0].id).toBe('b');
  });

  test('subscribe receives events', () => {
    const bus = createEventBus();
    const received: any[] = [];
    const unsub = bus.subscribe((ev) => { received.push(ev); });

    bus.publish({ id: 's1', type: 'heartbeat', timestamp: '', payload: {} });
    expect(received.length).toBe(1);
    expect(received[0].id).toBe('s1');

    unsub();
    bus.publish({ id: 's2', type: 'heartbeat', timestamp: '', payload: {} });
    expect(received.length).toBe(1); // unsubscribed
  });

  test('getSnapshot returns summary', () => {
    const bus = createEventBus();
    bus.publish({ id: 'n1', type: 'heartbeat', timestamp: '', payload: {} });
    const snap = bus.getSnapshot();
    expect(snap.totalEvents).toBe(1);
    expect(snap.events.length).toBe(1);
  });
});

describe('Server API', () => {
  const app = createServer();

  test('GET /api/events returns empty array initially', async () => {
    const res = await app.request('/api/events');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
  });

  test('GET /api/snapshot returns run summary', async () => {
    const res = await app.request('/api/snapshot');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timestamp).toBeDefined();
    expect(body.runs).toBeDefined();
    expect(body.circuitBreaker).toBeDefined();
  });

  const REPO_ROOT = resolve(import.meta.dir, '../../..');
  const planYaml = readFileSync(resolve(REPO_ROOT, 'examples/planspec/test-only.plan.yaml'), 'utf-8');

  test('POST /api/verify with valid plan returns result', async () => {
    const res = await app.request('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planYaml,
        evidenceRecords: [],
        changedFiles: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBeDefined();
    expect(body.attemptId).toBeDefined();
    expect(body.gateVerdicts).toBeDefined();
  });

  test('POST /api/verify without planYaml returns 400', async () => {
    const res = await app.request('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
