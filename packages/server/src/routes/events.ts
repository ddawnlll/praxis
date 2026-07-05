import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventBus } from '../runtime-event-bus';

export function eventsRoute(bus: EventBus) {
  const route = new Hono();

  route.get('/', (c) => {
    const afterId = c.req.query('after');
    const events = bus.getEvents(afterId);
    return c.json({ events, total: events.length });
  });

  route.get('/stream', (c) => {
    return streamSSE(c, async (s) => {
      for (const event of bus.getEvents()) {
        await s.writeSSE({ data: JSON.stringify(event), event: 'message', id: event.id });
      }

      const unsub = bus.subscribe((event) => {
        s.writeSSE({ data: JSON.stringify(event), event: 'message', id: event.id }).catch(() => {});
      });

      s.onAbort(unsub);
    });
  });

  return route;
}
