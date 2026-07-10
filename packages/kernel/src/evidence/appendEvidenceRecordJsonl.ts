// @praxis/kernel — appendEvidenceRecordJsonl
// Appends a single EvidenceRecordV01 to a JSONL file.
// v0.2: supports optional PEL-1 attestation — signs records before writing
// when a signingKey is provided.
//
// v0.1: uses writeFileSync with append flag — atomic enough for single-writer scenarios.

import { appendFileSync } from 'node:fs';
import type { EvidenceRecordV01 } from './types';
import { signEvidenceRecord } from './attestation';
import type { DsseEnvelope } from './attestation';

/**
 * Append one evidence record to an evidence ledger JSONL file.
 *
 * When signingKey is provided, the record is wrapped in a DSSE envelope
 * (HMAC-SHA256) before writing. The attestation prevents forgery of
 * deterministic source claims (PEL-1).
 *
 * v0.1 limitation: uses synchronous append. Concurrent writes from multiple
 * processes are not safe. This is acceptable for single-session single-writer
 * use (one Claude Code process at a time).
 *
 * @param ledgerPath - Target .jsonl file path.
 * @param record - The evidence record to append.
 * @param signingKey - Optional HMAC secret key for PEL-1 attestation.
 *   When provided, the record is signed as a DSSE envelope before writing.
 */
export function appendEvidenceRecordJsonl(
  ledgerPath: string,
  record: EvidenceRecordV01,
  signingKey?: string,
): { ok: boolean; path: string; error?: string } {
  try {
    const line = signingKey
      ? JSON.stringify(signEvidenceRecord(record, signingKey)) + '\n'
      : JSON.stringify(record) + '\n';
    appendFileSync(ledgerPath, line, 'utf-8');
    return { ok: true, path: ledgerPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, path: ledgerPath, error: msg };
  }
}

/**
 * Check whether a signed JSONL line contains a valid DSSE envelope.
 * Returns true if the line is a signed envelope (not a bare record).
 */
export function isDsseEnvelopeLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line);
    return !!(parsed.payloadType && parsed.payload && parsed.signatures);
  } catch {
    return false;
  }
}
