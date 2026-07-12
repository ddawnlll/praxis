// @praxis/ledger — append-only ledger with atomic writes and recovery.
//
// File format (one file per ledger):
//   <header-line>\n           // schema marker, also a fence for crash-recovery
//   <record-json>\n           // per record (NDJSON)
//   ...
//
// Atomicity: every append is done via `appendFile` after fsyncing a temporary
// staging file. The header is rewritten only via a `rename()` of a freshly
// written staging file, so a crash mid-append cannot leave a partial header
// that decodes as valid.
//
// Recovery: `recover()` walks the file, finds the last well-formed record
// boundary (newline after a complete JSON object), and truncates everything
// after it. A header that doesn't match the schema marker fails closed.

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalize, type JsonValue } from '@praxis/protocol';
import { rootFromRecords } from './merkle';

export const LEDGER_SCHEMA = 'praxis-ledger/v1';

export interface LedgerRecord {
  recordId: string;
  /** Wall-clock capture time (ISO 8601). */
  capturedAt: string;
  /** The evidence record payload (opaque JSON, canonicalized at hash time). */
  payload: JsonValue;
}

export interface LedgerHeader {
  schema: typeof LEDGER_SCHEMA;
  candidateId: string;
  createdAt: string;
  /** Frozen merkle root — must match the root computed from the persisted records. */
  merkleRoot: string;
}

export interface LedgerState {
  header: LedgerHeader;
  records: LedgerRecord[];
  merkleRoot: string;
}

export class LedgerCorruptError extends Error {
  constructor(message: string) {
    super(`Ledger corrupt: ${message}`);
    this.name = 'LedgerCorruptError';
  }
}

const HEADER_LINE_PREFIX = '# ';

export class Ledger {
  private constructor(
    private readonly path: string,
    private state: LedgerState
  ) {}

  static async open(path: string, candidateId: string): Promise<Ledger> {
    let exists = true;
    try {
      await fs.access(path);
    } catch {
      exists = false;
    }
    if (!exists) {
      const header: LedgerHeader = {
        schema: LEDGER_SCHEMA,
        candidateId,
        createdAt: new Date().toISOString(),
        merkleRoot: rootFromRecords([]).toString('hex'),
      };
      const state: LedgerState = { header, records: [], merkleRoot: header.merkleRoot };
      const l = new Ledger(path, state);
      await l.persistAll();
      return l;
    }
    // Recover and re-validate.
    const raw = await fs.readFile(path, 'utf-8');
    const state = parseOrThrow(raw, candidateId);
    return new Ledger(path, state);
  }

  static async openReadOnly(path: string, candidateId: string): Promise<Ledger> {
    const raw = await fs.readFile(path, 'utf-8');
    const state = parseOrThrow(raw, candidateId);
    return new Ledger(path, state);
  }

  get current(): LedgerState {
    // Return a defensive copy to prevent external mutation.
    return {
      header: { ...this.state.header },
      records: this.state.records.map((r) => ({ ...r })),
      merkleRoot: this.state.merkleRoot,
    };
  }

  /** Append a record. Throws LedgerCorruptError on duplicate recordId. */
  async append(record: LedgerRecord): Promise<{ index: number; merkleRoot: string }> {
    if (this.state.records.find((r) => r.recordId === record.recordId)) {
      throw new LedgerCorruptError(`duplicate recordId: ${record.recordId}`);
    }
    this.state.records.push({ ...record });
    const root = rootFromRecords(this.state.records.map((r) => recordBytes(r)));
    this.state.merkleRoot = root.toString('hex');
    this.state.header.merkleRoot = this.state.merkleRoot;
    await this.persistAll();
    return { index: this.state.records.length - 1, merkleRoot: this.state.merkleRoot };
  }

  /** Idempotent append: if recordId already present, return its index. */
  async appendIdempotent(record: LedgerRecord): Promise<{ index: number; merkleRoot: string; alreadyPresent: boolean }> {
    const existing = this.state.records.find((r) => r.recordId === record.recordId);
    if (existing) {
      return { index: this.state.records.indexOf(existing), merkleRoot: this.state.merkleRoot, alreadyPresent: true };
    }
    const r = await this.append(record);
    return { ...r, alreadyPresent: false };
  }

  async recover(): Promise<LedgerState> {
    const raw = await fs.readFile(this.path, 'utf-8');
    // parseOrThrow already truncates trailing garbage.
    const next = parseOrThrow(raw, this.state.header.candidateId);
    this.state = next;
    await this.persistAll();
    return this.current;
  }

  private async persistAll(): Promise<void> {
    const dir = dirname(this.path);
    await fs.mkdir(dir, { recursive: true });
    const lines: string[] = [];
    lines.push(HEADER_LINE_PREFIX + JSON.stringify(this.state.header));
    for (const r of this.state.records) {
      // canonicalize returns canonical JSON bytes; convert to string for line output.
      lines.push(canonicalize(recordToJson(r)).toString('utf-8'));
    }
    const staging = this.path + '.staging.' + process.pid;
    const data = lines.join('\n') + '\n';
    await fs.writeFile(staging, data, 'utf-8');
    await fs.rename(staging, this.path);
  }

  async verifyIntegrity(): Promise<{ ok: boolean; reason?: string }> {
    const expected = rootFromRecords(this.state.records.map((r) => recordBytes(r))).toString('hex');
    if (this.state.header.merkleRoot !== expected) {
      return { ok: false, reason: `header merkle root mismatch: header=${this.state.header.merkleRoot} computed=${expected}` };
    }
    if (expected !== this.state.merkleRoot) {
      return { ok: false, reason: `state merkle root mismatch: expected ${expected} got ${this.state.merkleRoot}` };
    }
    return { ok: true };
  }
}

function recordToJson(r: LedgerRecord): JsonValue {
  return {
    recordId: r.recordId,
    capturedAt: r.capturedAt,
    payload: r.payload,
  };
}

function recordBytes(r: LedgerRecord): Buffer {
  return Buffer.from(canonicalize(recordToJson(r)));
}

function parseOrThrow(raw: string, expectedCandidateId: string): LedgerState {
  const lines = raw.split('\n');
  if (lines.length === 0 || !lines[0].startsWith(HEADER_LINE_PREFIX)) {
    throw new LedgerCorruptError('missing schema header line');
  }
  let header: LedgerHeader;
  try {
    header = JSON.parse(lines[0].slice(HEADER_LINE_PREFIX.length)) as LedgerHeader;
  } catch (e) {
    throw new LedgerCorruptError(`header not valid JSON: ${(e as Error).message}`);
  }
  if (header.schema !== LEDGER_SCHEMA) {
    throw new LedgerCorruptError(`unsupported schema: ${header.schema}`);
  }
  if (header.candidateId !== expectedCandidateId) {
    throw new LedgerCorruptError(`candidateId mismatch: file=${header.candidateId} expected=${expectedCandidateId}`);
  }
  const records: LedgerRecord[] = [];
  // Truncation: stop at the first non-empty line that fails to parse as a
  // record. This is how crash-recovery removes a partial trailing write.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      // Truncation: stop reading here.
      break;
    }
    if (typeof obj !== 'object' || obj === null) {
      throw new LedgerCorruptError(`record on line ${i + 1} is not an object`);
    }
    const o = obj as { recordId?: unknown; capturedAt?: unknown; payload?: unknown };
    if (typeof o.recordId !== 'string' || typeof o.capturedAt !== 'string' || !('payload' in o)) {
      throw new LedgerCorruptError(`record on line ${i + 1} missing required fields`);
    }
    records.push({
      recordId: o.recordId,
      capturedAt: o.capturedAt,
      payload: o.payload as JsonValue,
    });
  }
  const merkleRoot = rootFromRecords(records.map((r) => recordBytes(r))).toString('hex');
  return { header, records, merkleRoot };
}
