import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createEventBus } from './runtime-event-bus';
import { healthRoute } from './routes/health';
import { snapshotRoute } from './routes/snapshot';
import { eventsRoute } from './routes/events';
import { verifyRoute } from './routes/verify';

let eventBus: ReturnType<typeof createEventBus> | null = null;

export function createServer() {
  const app = new Hono();
  eventBus = createEventBus();

  app.use('*', cors());
  app.route('/health', healthRoute);
  app.route('/api/snapshot', snapshotRoute(eventBus));
  app.route('/api/events', eventsRoute(eventBus));
  app.route('/api/verify', verifyRoute(eventBus));

  return app;
}

export function getEventBus() {
  return eventBus ?? createEventBus();
}

export function startServer(port = 3457) {
  const app = createServer();
  console.error(`[praxis-server] Starting on http://127.0.0.1:${port}`);
  Bun.serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  return { app, port };
}
