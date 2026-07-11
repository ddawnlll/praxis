// @praxis/ledger — append-only ledger + recovery tests

import { describe, test, expect } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ledger, LedgerCorruptError, type LedgerRecord } from '../src/ledger';
import { rootFromRecords } from '../src/merkle';

async function tempLedgerPath(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'praxis-ledger-'));
  return join(dir, 'evidence.jsonl');
}

function rec(id: string, payload: Record<string, unknown> = {}): LedgerRecord {
  return { recordId: id, capturedAt: '2026-07-11T00:00:00Z', payload };
}

describe('Ledger', () => {
  test('append updates the merkle root deterministically', async () => {
    const path = await tempLedgerPath();
    const l = await Ledger.open(path, 'cand-1');
    const empty = rootFromRecords([]).toString('hex');
    expect((await l.current).merkleRoot).toBe(empty);
    const r1 = await l.append(rec('r-1', { kind: 'command.exit', exitCode: 0 }));
    const r2 = await l.append(rec('r-2', { kind: 'command.exit', exitCode: 1 }));
    expect(r1.index).toBe(0);
    expect(r2.index).toBe(1);
    expect(r1.merkleRoot).not.toBe(empty);
    expect(r2.merkleRoot).not.toBe(r1.merkleRoot);
  });
  test('append refuses duplicate recordId', async () => {
    const path = await tempLedgerPath();
    const l = await Ledger.open(path, 'cand-1');
    await l.append(rec('r-1'));
    await expect(l.append(rec('r-1'))).rejects.toThrow(LedgerCorruptError);
  });
  test('appendIdempotent returns alreadyPresent=true on second call', async () => {
    const path = await tempLedgerPath();
    const l = await Ledger.open(path, 'cand-1');
    const a = await l.appendIdempotent(rec('r-1'));
    const b = await l.appendIdempotent(rec('r-1'));
    expect(a.alreadyPresent).toBe(false);
    expect(b.alreadyPresent).toBe(true);
    expect(b.merkleRoot).toBe(a.merkleRoot);
  });
  test('reopen preserves the ledger', async () => {
    const path = await tempLedgerPath();
    const l1 = await Ledger.open(path, 'cand-1');
    await l1.append(rec('r-1'));
    const r1 = (await l1.current).merkleRoot;
    const l2 = await Ledger.open(path, 'cand-1');
    const r2 = (await l2.current).merkleRoot;
    expect(r1).toBe(r2);
    expect((await l2.current).records.length).toBe(1);
  });
  test('recovery truncates a truncated trailing record', async () => {
    const path = await tempLedgerPath();
    const l1 = await Ledger.open(path, 'cand-1');
    await l1.append(rec('r-1', { x: 1 }));
    await l1.append(rec('r-2', { x: 2 }));
    // Simulate a crash mid-write: append a partial JSON line.
    const fd = await fs.open(path, 'a');
    await fd.write('\n{"recordId":"r-3","capturedAt":"2026-07-11T00:00:00Z","payload":'); // truncated
    await fd.close();
    // Reopen and recover.
    const l2 = await Ledger.open(path, 'cand-1');
    const recovered = await l2.recover();
    expect(recovered.records.length).toBe(2);
    expect(recovered.records[0].recordId).toBe('r-1');
    expect(recovered.records[1].recordId).toBe('r-2');
  });
  test('rejects candidateId mismatch on open', async () => {
    const path = await tempLedgerPath();
    await Ledger.open(path, 'cand-1');
    await expect(Ledger.open(path, 'cand-2')).rejects.toThrow(LedgerCorruptError);
  });
  test('rejects missing schema header', async () => {
    const path = await tempLedgerPath();
    await fs.writeFile(path, 'not a header\n', 'utf-8');
    await expect(Ledger.open(path, 'cand-1')).rejects.toThrow(LedgerCorruptError);
  });
  test('verifyIntegrity succeeds for a valid ledger', async () => {
    const path = await tempLedgerPath();
    const l = await Ledger.open(path, 'cand-1');
    await l.append(rec('r-1'));
    await l.append(rec('r-2'));
    const r = await l.verifyIntegrity();
    expect(r.ok).toBe(true);
  });
  test('verifyIntegrity detects a manually corrupted ledger', async () => {
    const path = await tempLedgerPath();
    const l = await Ledger.open(path, 'cand-1');
    await l.append(rec('r-1', { exitCode: 0 }));
    await l.append(rec('r-2', { exitCode: 0 }));
    // Tamper with one record's bytes.
    const raw = await fs.readFile(path, 'utf-8');
    const tampered = raw.replace('"exitCode":0', '"exitCode":99');
    expect(tampered).not.toBe(raw); // sanity
    await fs.writeFile(path, tampered, 'utf-8');
    const l2 = await Ledger.open(path, 'cand-1');
    const r = await l2.verifyIntegrity();
    expect(r.ok).toBe(false);
  });
});
