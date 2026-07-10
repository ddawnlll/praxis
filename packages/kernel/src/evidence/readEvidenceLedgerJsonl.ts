// @praxis/kernel — readEvidenceLedgerJsonl
// Reads a .jsonl evidence ledger file line-by-line.
// v0.2: supports DSSE envelope lines (PEL-1 attestation) — detects envelopes
// and extracts records from them. When attestationSecret is provided, verifies
// envelope signatures and reports attestation failures as diagnostics.
//
// v0.1: uses writeFileSync with append flag — atomic enough for single-writer scenarios.

import { readFileSync } from 'node:fs';
import type { Diagnostic } from '@praxis/contracts';
import { EVIDENCE_VERSION_V01, type EvidenceRecordV01, type EvidenceLedgerReadResult } from './types';
import { verifyAttestation, extractRecord } from './attestation';
import type { DsseEnvelope } from './attestation';

/**
 * Detect whether a parsed JSON object is a DSSE envelope (PEL-1 attested).
 */
function isDsseEnvelope(obj: Record<string, unknown>): boolean {
  return typeof obj.payloadType === 'string'
    && typeof obj.payload === 'string'
    && Array.isArray(obj.signatures);
}

/**
 * Parse a single JSON line into an EvidenceRecordV01.
 * Supports both bare records and DSSE envelopes (PEL-1 attestation).
 *
 * @param attestationSecret - Optional HMAC secret. When provided, envelope
 *   signatures are verified. Verification failures are returned as diagnostics.
 */
export function parseEvidenceRecord(
  line: string,
  lineNumber: number,
  attestationSecret?: string,
): EvidenceRecordV01 | Diagnostic {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return {
      code: 'EVIDENCE_BLANK_LINE',
      severity: 'info',
      message: `Line ${lineNumber}: blank line (skipped).`,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      code: 'EVIDENCE_LEDGER_PARSE_ERROR',
      severity: 'error',
      message: `Line ${lineNumber}: JSON parse error — ${msg}`,
    };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      code: 'EVIDENCE_LEDGER_PARSE_ERROR',
      severity: 'error',
      message: `Line ${lineNumber}: expected JSON object, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
    };
  }

  const obj = raw as Record<string, unknown>;

  // --- DSSE Envelope path (PEL-1 attested) ---
  if (isDsseEnvelope(obj)) {
    const envelope = obj as unknown as DsseEnvelope;

    // If a secret is configured, verify the signature
    if (attestationSecret) {
      if (!verifyAttestation(envelope, attestationSecret)) {
        return {
          code: 'ATTESTATION_VERIFICATION_FAILED',
          severity: 'error',
          message: `Line ${lineNumber}: DSSE envelope signature verification failed. ` +
            `Evidence may be forged or key mismatch.`,
        };
      }
    }

    // Extract the record from the envelope
    const record = extractRecord(envelope);
    if (!record) {
      return {
        code: 'ATTESTATION_EXTRACT_FAILED',
        severity: 'error',
        message: `Line ${lineNumber}: DSSE envelope contains malformed evidence record.`,
      };
    }

    return record;
  }

  // --- Bare EvidenceRecordV01 path (no attestation) ---
  // Validate evidenceVersion
  if (obj.evidenceVersion !== EVIDENCE_VERSION_V01) {
    return {
      code: 'EVIDENCE_VERSION_MISMATCH',
      severity: 'error',
      message: `Line ${lineNumber}: evidenceVersion must be "${EVIDENCE_VERSION_V01}", got "${String(obj.evidenceVersion)}".`,
    };
  }

  // Validate required string fields
  for (const field of ['recordId', 'attemptId', 'planId', 'timestamp', 'type', 'source']) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim().length === 0) {
      return {
        code: 'EVIDENCE_MISSING_REQUIRED_FIELD',
        severity: 'error',
        message: `Line ${lineNumber}: missing or empty required field "${field}".`,
      };
    }
  }

  // Validate recordId pattern
  const recordId = obj.recordId as string;
  if (!/^EV-[A-Za-z0-9_.-]+$/.test(recordId)) {
    return {
      code: 'EVIDENCE_INVALID_RECORD_ID',
      severity: 'error',
      message: `Line ${lineNumber}: recordId "${recordId}" does not match pattern ^EV-[A-Za-z0-9_.-]+$.`,
    };
  }

  return {
    evidenceVersion: EVIDENCE_VERSION_V01,
    recordId,
    attemptId: obj.attemptId as string,
    planId: obj.planId as string,
    timestamp: obj.timestamp as string,
    type: obj.type as EvidenceRecordV01['type'],
    source: obj.source as EvidenceRecordV01['source'],
    taskId: typeof obj.taskId === 'string' ? obj.taskId : undefined,
    criterionId: typeof obj.criterionId === 'string' ? obj.criterionId : undefined,
    path: typeof obj.path === 'string' ? obj.path : undefined,
    paths: Array.isArray(obj.paths) ? obj.paths.filter((p): p is string => typeof p === 'string') : undefined,
    changedFile: obj.changedFile as EvidenceRecordV01['changedFile'] | undefined,
    status: typeof obj.status === 'string' ? obj.status : undefined,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    hash: typeof obj.hash === 'string' ? obj.hash : undefined,
    metadata: obj.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Read and parse a JSONL evidence ledger file.
 * Supports both bare EvidenceRecordV01 lines and DSSE envelopes (PEL-1 attestation).
 *
 * When attestationSecret is provided, envelope signatures are verified.
 *
 * @param ledgerPath - Absolute or relative path to the .jsonl file.
 * @param attestationSecret - Optional HMAC secret for PEL-1 attestation verification.
 * @returns EvidenceLedgerReadResult with parsed records and diagnostics.
 */
export function readEvidenceLedgerJsonl(
  ledgerPath: string,
  attestationSecret?: string,
): EvidenceLedgerReadResult {
  const diagnostics: Diagnostic[] = [];
  const records: EvidenceRecordV01[] = [];
  let blankLinesSkipped = 0;
  let totalLines = 0;

  let raw: string;
  try {
    raw = readFileSync(ledgerPath, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagnostics.push({
      code: 'EVIDENCE_LEDGER_MISSING',
      severity: 'error',
      message: `Cannot read evidence ledger at ${ledgerPath}: ${msg}`,
    });
    return { ok: false, records, diagnostics, blankLinesSkipped, totalLines };
  }

  const lines = raw.split('\n');
  totalLines = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const trimmed = lines[i].trim();

    // Skip blank lines
    if (trimmed.length === 0) {
      blankLinesSkipped++;
      continue;
    }

    const parsed = parseEvidenceRecord(lines[i], lineNumber, attestationSecret);
    if ('severity' in parsed) {
      // It's a Diagnostic
      diagnostics.push(parsed);
    } else {
      records.push(parsed);
    }
  }

  const ok = diagnostics.every(d => d.severity !== 'error');
  return { ok, records, diagnostics, blankLinesSkipped, totalLines };
}
