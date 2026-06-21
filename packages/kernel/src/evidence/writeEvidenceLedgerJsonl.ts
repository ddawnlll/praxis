// @praxis/kernel — writeEvidenceLedgerJsonl
// Writes a complete evidence ledger as a JSONL file.
// Primarily used for tests and helpers, not for runtime evidence capture.

import { writeFileSync } from 'node:fs';
import type { EvidenceRecordV01 } from './types';

/**
 * Serialize an array of EvidenceRecordV01 to a JSONL string.
 * Each record is JSON-stringified on its own line.
 */
export function serializeEvidenceLedgerJsonl(records: EvidenceRecordV01[]): string {
  return records.map(r => JSON.stringify(r)).join('\n') + '\n';
}

/**
 * Write a complete evidence ledger JSONL file to disk.
 * Overwrites existing content.
 *
 * @param ledgerPath - Target file path.
 * @param records - Evidence records to write.
 */
export function writeEvidenceLedgerJsonl(
  ledgerPath: string,
  records: EvidenceRecordV01[],
): { ok: boolean; path: string; recordCount: number; error?: string } {
  try {
    const content = serializeEvidenceLedgerJsonl(records);
    writeFileSync(ledgerPath, content, 'utf-8');
    return { ok: true, path: ledgerPath, recordCount: records.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, path: ledgerPath, recordCount: 0, error: msg };
  }
}
