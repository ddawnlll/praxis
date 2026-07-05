// @praxis/server — Standalone launcher
// Start this before opening the desktop app:
//   ANTHROPIC_BASE_URL=http://localhost:3456 ANTHROPIC_AUTH_TOKEN=unused bun run packages/server/launch.ts

import { startServer } from './src/server';

const port = parseInt(process.env.PORT ?? '3457', 10);
console.error(`[praxis-server] Starting on http://127.0.0.1:${port}`);
startServer(port);
