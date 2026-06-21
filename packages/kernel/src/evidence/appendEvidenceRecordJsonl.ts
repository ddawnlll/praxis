// @praxis/kernel — appendEvidenceRecordJsonl
// Appends a single EvidenceRecordV01 to a JSONL file.
// v0.1: uses writeFileSync with append flag — atomic enough for single-writer scenarios.

import { appendFileSync } from 'node:fs';
import type { EvidenceRecordV01 } from './types';

/**
 * Append one evidence record to an evidence ledger JSONL file.
 *
 * v0.1 limitation: uses synchronous append. Concurrent writes from multiple
 * processes are not safe. This is acceptable for single-session single-writer
 * use (one Claude Code process at a time).
 *
 * @param ledgerPath - Target .jsonl file path.
 * @param record - The evidence record to append.
 */
export function appendEvidenceRecordJsonl(
  ledgerPath: string,
  record: EvidenceRecordV01,
): { ok: boolean; path: string; error?: string } {
  try {
    const line = JSON.stringify(record) + '\n';
    appendFileSync(ledgerPath, line, 'utf-8');
    return { ok: true, path: ledgerPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, path: ledgerPath, error: msg };
  }
}
