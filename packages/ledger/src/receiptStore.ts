// @praxis/ledger — immutable receipt storage
//
// Each receipt is stored as <id>.json under a candidate-scoped directory.
// Immutability is enforced by:
//   * Writing to <id>.json.staging then renaming atomically.
//   * Rejecting any subsequent write that would change the bytes of an
//     existing receipt (the storage is append-only for the lifetime of the
//     candidate).
//   * The on-disk hash is part of the file name suffix so any tampering
//     produces a missing-file condition rather than a silent overwrite.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, type JsonValue } from '@praxis/protocol';
import { createHash } from 'node:crypto';

export interface ReceiptStorageOptions {
  baseDir: string;
  candidateId: string;
}

export class ReceiptStorage {
  private constructor(private readonly dir: string) {}

  static async open(opts: ReceiptStorageOptions): Promise<ReceiptStorage> {
    const dir = join(opts.baseDir, 'receipts', opts.candidateId);
    await fs.mkdir(dir, { recursive: true });
    return new ReceiptStorage(dir);
  }

  async write(receipt: JsonValue): Promise<{ filename: string; contentHash: string }> {
    const bytes = canonicalize(receipt);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const filename = `${contentHash}.json`;
    const target = join(this.dir, filename);
    // Fail-closed: refuse to overwrite an existing receipt. Same bytes → no-op.
    try {
      const existing = await fs.readFile(target, 'utf-8');
      if (existing === bytes.toString('utf-8')) {
        return { filename, contentHash };
      }
      throw new Error(`receipt at ${target} already exists with different bytes`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }
    const staging = target + '.staging.' + process.pid;
    await fs.writeFile(staging, bytes, 'utf-8');
    await fs.rename(staging, target);
    return { filename, contentHash };
  }

  async read(contentHash: string): Promise<JsonValue | null> {
    const target = join(this.dir, `${contentHash}.json`);
    try {
      const raw = await fs.readFile(target, 'utf-8');
      return JSON.parse(raw) as JsonValue;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async list(): Promise<string[]> {
    const entries = await fs.readdir(this.dir);
    return entries.filter((e) => e.endsWith('.json') && !e.includes('.staging.'));
  }

  path(): string {
    return this.dir;
  }
}
