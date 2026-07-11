// @praxis/verity-qual — public API

export * from './fuzz';
export * from './fault';
export * from './releaseGate';

import { promises as fs } from 'node:fs';

export async function writeArtifact(path: string, data: unknown): Promise<void> {
  await fs.mkdir(require('node:path').dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}
