// @praxis/kernel — Evidence Attestation (PEL-1 POC)
// Implements Praxis Evidence Level 1: each evidence record is signed
// with an HMAC-SHA256 envelope (DSSE-style). Forged records fail verification.
//
// PEL-1: HMAC-SHA256 signing (POC — production should use ed25519)
// PEL-2: Merkle transparency log (future)
// PEL-3: Third-party offline verification (future)

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EvidenceRecordV01 } from './types';

/** DSSE-style envelope wrapping an evidence record. */
export interface DsseEnvelope {
  payloadType: 'application/vnd.praxis-evidence+json';
  payload: string; // base64-encoded EvidenceRecordV01
  signatures: Array<{
    keyid: string;
    sig: string; // HMAC-SHA256 of PAE(payloadType, payload)
  }>;
}

/** PAE (Payload Authentication Encoding) — prevents format confusion attacks. */
function pae(payloadType: string, payload: string): Buffer {
  // PAE = len(payloadType) || payloadType || len(payload) || payload
  // Using little-endian 64-bit integers (same as DSSE spec)
  const ptBuf = Buffer.from(payloadType, 'utf-8');
  const pBuf = Buffer.from(payload, 'utf-8');
  const result = Buffer.alloc(8 + ptBuf.length + 8 + pBuf.length);
  result.writeBigUInt64LE(BigInt(ptBuf.length), 0);
  ptBuf.copy(result, 8);
  result.writeBigUInt64LE(BigInt(pBuf.length), 8 + ptBuf.length);
  pBuf.copy(result, 16 + ptBuf.length);
  return result;
}

/**
 * Sign an evidence record with HMAC-SHA256.
 * Returns a DSSE envelope containing the signed record.
 *
 * @param record The evidence record to sign
 * @param secret The signing key (should be stored outside agent's reach)
 * @param keyid Identifier for the key (for rotation support)
 */
export function signEvidenceRecord(
  record: EvidenceRecordV01,
  secret: string,
  keyid = 'praxis-default',
): DsseEnvelope {
  const payload = Buffer.from(JSON.stringify(record)).toString('base64');
  const payloadType = 'application/vnd.praxis-evidence+json';
  const dataToSign = pae(payloadType, payload);
  const sig = createHmac('sha256', secret).update(dataToSign).digest('hex');

  return {
    payloadType,
    payload,
    signatures: [{ keyid, sig }],
  };
}

/**
 * Verify a DSSE envelope's signature.
 * Returns true if the signature is valid, false otherwise.
 *
 * @param envelope The DSSE envelope to verify
 * @param secret The signing key (must match the one used to sign)
 */
export function verifyAttestation(
  envelope: DsseEnvelope,
  secret: string,
): boolean {
  if (!envelope.signatures || envelope.signatures.length === 0) return false;

  const dataToVerify = pae(envelope.payloadType, envelope.payload);
  const expectedSig = createHmac('sha256', secret).update(dataToVerify).digest('hex');

  for (const { sig } of envelope.signatures) {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
        return true;
      }
    } catch {
      // Invalid hex encoding — skip
    }
  }
  return false;
}

/**
 * Extract the evidence record from a verified envelope.
 * Returns null if the envelope is invalid or the payload is malformed.
 */
export function extractRecord(envelope: DsseEnvelope): EvidenceRecordV01 | null {
  try {
    const json = Buffer.from(envelope.payload, 'base64').toString('utf-8');
    const record = JSON.parse(json) as EvidenceRecordV01;
    // Basic validation
    if (!record.recordId || !record.evidenceVersion || !record.type) return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * Check if a source is deterministic AND has a valid attestation.
 * This is the tightened check for PEL-1: source alone is not enough,
 * the record must also be signed with a valid envelope.
 */
export function isAttestedDeterministicSource(
  source: string,
  envelope: DsseEnvelope | undefined,
  secret: string | undefined,
): boolean {
  // Source must be in DETERMINISTIC_SOURCES
  const DETERMINISTIC_SOURCES = new Set(['kernel', 'contracts', 'hook', 'cli', 'test']);
  if (!DETERMINISTIC_SOURCES.has(source)) return false;

  // If no secret configured, fall back to source-only check (backward compatible)
  if (!secret) return true;

  // If secret is configured, envelope must be present and valid
  if (!envelope) return false;
  return verifyAttestation(envelope, secret);
}
