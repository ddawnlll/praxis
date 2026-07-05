import type { RuntimeEvent } from './types';

const MAX_EVENTS = 1000;

export interface EventBus {
  publish(event: RuntimeEvent): void;
  subscribe(callback: (event: RuntimeEvent) => void): () => void;
  getEvents(afterId?: string): RuntimeEvent[];
  getSnapshot(): { events: RuntimeEvent[]; totalEvents: number };
  clear(): void;
}

export function createEventBus(): EventBus {
  const events: RuntimeEvent[] = [];
  const subscribers = new Set<(event: RuntimeEvent) => void>();

  return {
    publish(event: RuntimeEvent): void {
      events.push(event);
      if (events.length > MAX_EVENTS) events.shift();
      for (const cb of subscribers) cb(event);
    },

    subscribe(callback: (event: RuntimeEvent) => void): () => void {
      subscribers.add(callback);
      return () => { subscribers.delete(callback); };
    },

    getEvents(afterId?: string): RuntimeEvent[] {
      if (!afterId) return [...events];
      const idx = events.findIndex(e => e.id === afterId);
      return idx === -1 ? [...events] : events.slice(idx + 1);
    },

    getSnapshot() {
      return { events: [...events], totalEvents: events.length };
    },

    clear(): void {
      events.length = 0;
      subscribers.clear();
    },
  };
}
