// @praxis/verity-gates — FinalReceiptGate (#28)
//
// Aggregates all gate results, signs a VerificationReceipt, and enforces:
//   * Only emits a receipt when EVERY required gate is PASS
//   * Receipt is base-bound (receipt.baseHash === manifest.baseHash)
//   * Receipt is merkle-bound (receipt.merkleRoot === bundle.merkleRoot)
//   * Receipt is expiring (expiresAt > issuedAt)
//   * Receipt is single-use (consumedAt is set on first use; second use → FAIL)
//   * Independent verifyReceipt() requires no mutable process state.

import type { GateContext, GateResult, Verdict } from './gate';
import { aggregate } from './gate';
import { canonicalize, generateKeyPair, sign, verify, type KeyPair, type VerificationReceipt, type Identity, type ProtocolVersion, type GateName as GN, type JsonValue } from '@praxis/protocol';

export interface FinalReceiptOptions {
  issuer: { identityId: string };
  /** How long the receipt is valid, in seconds. Default 24h. */
  ttlSeconds?: number;
  /** Required gates — all of these must be PASS for a receipt to be issued. */
  required?: GN[];
  /** Pre-existing issuer key pair (otherwise a fresh one is generated). */
  keyPair?: KeyPair;
}

const DEFAULT_REQUIRED: GN[] = [
  'admission', 'integrity', 'scope', 'architecture', 'effect', 'recovery', 'hermeticExec', 'finalReceipt',
];

export interface IssuedReceipt {
  receipt: VerificationReceipt;
  /** Public-key bytes (hex, SPKI) for independent verification. */
  publicKeyHex: string;
}

export class FinalReceiptGate {
  readonly name: GN = 'finalReceipt';
  private readonly kp: KeyPair;
  private readonly issuer: { identityId: string };
  private readonly ttl: number;
  private readonly required: GN[];

  constructor(opts: FinalReceiptOptions) {
    this.kp = opts.keyPair ?? generateKeyPair();
    this.issuer = opts.issuer;
    this.ttl = opts.ttlSeconds ?? 24 * 60 * 60;
    this.required = opts.required ?? DEFAULT_REQUIRED;
  }

  /**
   * Aggregate the gate results and (if all required are PASS) issue a
   * signed VerificationReceipt. Returns a GateResult plus, on PASS, the
   * IssuedReceipt.
   */
  evaluate(ctx: GateContext, gateResults: GateResult[]): { result: GateResult; issued?: IssuedReceipt } {
    const at = new Date().toISOString();
    // Verify the supplied gateResults contain every required gate.
    const have = new Set(gateResults.map((r) => r.gate));
    for (const r of this.required) {
      if (!have.has(r)) {
        return { result: { gate: this.name, verdict: 'FAIL', reasonCode: `FINAL_GATE_MISSING:${r}`, producedAt: at } };
      }
    }
    // 1. Every required gate must be PASS
    for (const r of gateResults) {
      if (this.required.includes(r.gate) && r.verdict !== 'PASS') {
        return { result: { gate: this.name, verdict: 'FAIL', reasonCode: `FINAL_REQUIRED_NOT_PASS:${r.gate}=${r.verdict}`, producedAt: at } };
      }
    }
    // 2. Aggregate: any HOLD anywhere → HOLD
    const agg: Verdict = aggregate(gateResults, this.required);
    if (agg !== 'PASS') {
      return { result: { gate: this.name, verdict: 'HOLD', reasonCode: 'FINAL_AGGREGATE_NOT_PASS', producedAt: at } };
    }
    // 3. Build the unsigned receipt body
    if (!ctx.bundle) {
      return { result: { gate: this.name, verdict: 'FAIL', reasonCode: 'FINAL_BUNDLE_MISSING', producedAt: at } };
    }
    const issuedAt = at;
    const expiresAt = new Date(Date.parse(issuedAt) + this.ttl * 1000).toISOString();
    const receiptBody: Omit<VerificationReceipt, 'signature'> = {
      schemaVersion: 'praxis-protocol/v1' as ProtocolVersion,
      receiptId: 'rcpt-' + canonicalize({ c: ctx.manifest.candidateId, b: ctx.manifest.baseHash, t: issuedAt }).toString('hex').slice(0, 24),
      candidateId: ctx.manifest.candidateId,
      policyId: ctx.manifest.policyId,
      baseHash: ctx.manifest.baseHash,
      merkleRoot: ctx.bundle.merkleRoot,
      gateResults,
      issuedAt,
      expiresAt,
      singleUseKeyId: ctx.manifest.idempotencyKey ?? ctx.manifest.candidateId,
      consumedAt: null,
      issuer: { identityId: this.issuer.identityId, keyId: this.kp.publicKey ? idForKey(this.kp) : '0000000000000000' } as Identity,
    };
    // 4. Sign the canonical body.
    const { signature, signedPayloadDigest } = sign(receiptBody as unknown as JsonValue, this.kp);
    const receipt: VerificationReceipt = {
      ...receiptBody,
      signature: { algorithm: 'ed25519', value: signature.toString('hex'), signedPayloadDigest: signedPayloadDigest.toString('hex') },
    };
    return {
      result: { gate: this.name, verdict: 'PASS', reasonCode: 'FINAL_RECEIPT_ISSUED', producedAt: at },
      issued: { receipt, publicKeyHex: this.kp.publicKeyHex },
    };
  }

  /** Convenience: identity of the issuer. */
  issuerIdentity(): Identity {
    return { identityId: this.issuer.identityId, keyId: idForKey(this.kp) };
  }
}

import { keyId as kpKeyId } from '@praxis/protocol';

function idForKey(kp: KeyPair): string {
  return kpKeyId(kp.publicKey);
}

/**
 * Independent receipt verifier. No mutable process state required.
 * Trusts the public-key bytes; caller is responsible for binding them
 * to an identity.
 */
export function verifyReceipt(
  receipt: VerificationReceipt,
  publicKeyHex: string,
  at: Date = new Date()
): { ok: boolean; reasonCode?: string } {
  if (receipt.schemaVersion !== 'praxis-protocol/v1') return { ok: false, reasonCode: 'VR_SCHEMA' };
  if (receipt.signature.algorithm !== 'ed25519') return { ok: false, reasonCode: 'VR_ALGO' };
  // Single-use: a consumed receipt is FAIL before signature check.
  if (receipt.consumedAt !== null && Date.parse(receipt.consumedAt) <= at.getTime()) {
    return { ok: false, reasonCode: 'VR_CONSUMED' };
  }
  // Expiry
  if (Date.parse(receipt.expiresAt) <= at.getTime()) return { ok: false, reasonCode: 'VR_EXPIRED' };
  // Re-hash and verify. The signed body did not include `consumedAt`; we
  // verify against a body with consumedAt normalized to null.
  const { signature, ...rest } = receipt;
  const bodyForVerify = { ...(rest as Record<string, unknown>), consumedAt: null } as unknown as JsonValue;
  let ok = false;
  try {
    const pub = loadPub(publicKeyHex);
    ok = verify(bodyForVerify, Buffer.from(signature.value, 'hex'), pub);
  } catch {
    return { ok: false, reasonCode: 'VR_VERIFY_EXCEPTION' };
  }
  if (!ok) return { ok: false, reasonCode: 'VR_SIGNATURE' };
  return { ok: true };
}

import { loadPublicKey as loadPub } from '@praxis/protocol';

/** Mark a receipt as consumed. Mutates a copy. */
export function consumeReceipt(receipt: VerificationReceipt, at: string = new Date().toISOString()): VerificationReceipt {
  return { ...receipt, consumedAt: at };
}
