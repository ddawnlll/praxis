// @praxis/verity-client — versioned client + promotion binding (#31)
//
// JSON protocol transport with:
//   * Pure-JSON envelope (no mixed stdout, no logs on stdout)
//   * Version + capability handshake
//   * Pinned Praxis identity
//   * Receipt verification + single-use consumption
//   * stderr-only logs
//
// The "promote" action requires a current-base valid receipt.

import {
  type ProtocolEnvelope,
  type VerificationReceipt,
  type Capability,
  type EnvelopeKind,
  validate as validateProtocol,
  canonicalize,
  loadPublicKey,
  verify,
  keyId as computeKeyId,
} from '@praxis/protocol';

export interface ClientOptions {
  identity: { identityId: string };
  praxisPublicKeyHex: string;
  /** Optional pre-shared key id (otherwise derived from publicKey). */
  keyId?: string;
  /** Capabilities this client requests. */
  capabilities: Capability[];
}

export interface PromotionRequest {
  candidateId: string;
  baseHash: string;
  receipt: VerificationReceipt;
  reason: string;
}

export interface PromotionResult {
  decision: 'APPLIED' | 'REJECTED' | 'HOLD';
  reasonCode: string;
  promotionId: string;
}

export class VersionedPraxisClient {
  private readonly opts: ClientOptions;
  private readonly resolvedKeyId: string;
  private consumedReceipts: Set<string> = new Set();

  constructor(opts: ClientOptions) {
    this.opts = opts;
    // Resolve the key id from the public key bytes.
    this.resolvedKeyId = opts.keyId ?? computeKeyId(loadPublicKey(opts.praxisPublicKeyHex));
  }

  /** Build a capability handshake envelope. */
  handshake(now: string = new Date().toISOString()): ProtocolEnvelope {
    return {
      protocolVersion: 'praxis-protocol/v1',
      envelopeKind: 'capability.handshake' as EnvelopeKind,
      sender: { identityId: this.opts.identity.identityId, keyId: this.resolvedKeyId },
      capabilities: this.opts.capabilities,
      issuedAt: now,
      expiresAt: null,
      nonce: this.nonce(),
      payload: { requestedAt: now },
    };
  }

  /** Build a promote.request envelope. The receiver verifies the receipt. */
  buildPromoteRequest(req: PromotionRequest, now: string = new Date().toISOString()): ProtocolEnvelope {
    return {
      protocolVersion: 'praxis-protocol/v1',
      envelopeKind: 'promote.request',
      sender: { identityId: this.opts.identity.identityId, keyId: this.resolvedKeyId },
      capabilities: ['promote.authority', 'receipt.consume'],
      issuedAt: now,
      expiresAt: null,
      nonce: this.nonce(),
      payload: {
        candidateId: req.candidateId,
        baseHash: req.baseHash,
        reason: req.reason,
        receipt: req.receipt,
      },
    };
  }

  /**
   * Server-side: evaluate a promotion. Verifies the receipt and the
   * base-binding. Single-use: a consumed receipt cannot promote twice.
   */
  evaluatePromote(env: ProtocolEnvelope): PromotionResult {
    if (env.protocolVersion !== 'praxis-protocol/v1') {
      return { decision: 'REJECTED', reasonCode: 'PC_PROTOCOL_VERSION', promotionId: '' };
    }
    if (env.envelopeKind !== 'promote.request') {
      return { decision: 'REJECTED', reasonCode: 'PC_NOT_PROMOTE', promotionId: '' };
    }
    if (!env.capabilities.includes('promote.authority')) {
      return { decision: 'REJECTED', reasonCode: 'PC_NO_PROMOTE_CAP', promotionId: '' };
    }
    const payload = env.payload as { candidateId?: string; baseHash?: string; receipt?: VerificationReceipt };
    if (!payload.receipt || !payload.candidateId || !payload.baseHash) {
      return { decision: 'REJECTED', reasonCode: 'PC_MISSING_FIELDS', promotionId: '' };
    }
    // 1. Receipt must be a valid envelope per the protocol schema.
    const r = validateProtocol('verification-receipt-v1', payload.receipt);
    if (!r.ok) {
      return { decision: 'REJECTED', reasonCode: 'PC_RECEIPT_SCHEMA', promotionId: '' };
    }
    // 2. Receipt must be base-bound to the candidate.
    if (payload.receipt.candidateId !== payload.candidateId) {
      return { decision: 'REJECTED', reasonCode: 'PC_CANDIDATE_MISMATCH', promotionId: '' };
    }
    if (payload.receipt.baseHash !== payload.baseHash) {
      return { decision: 'REJECTED', reasonCode: 'PC_BASE_MISMATCH', promotionId: '' };
    }
    // 3. Receipt must be unconsumed.
    if (payload.receipt.consumedAt !== null) {
      return { decision: 'REJECTED', reasonCode: 'PC_CONSUMED', promotionId: '' };
    }
    if (this.consumedReceipts.has(payload.receipt.receiptId)) {
      return { decision: 'REJECTED', reasonCode: 'PC_REPLAY', promotionId: '' };
    }
    // 4. Receipt must be signed by the pinned Praxis key.
    let pub;
    try {
      pub = loadPublicKey(this.opts.praxisPublicKeyHex);
    } catch {
      return { decision: 'REJECTED', reasonCode: 'PC_PUBKEY_INVALID', promotionId: '' };
    }
    const { signature, ...rest } = payload.receipt;
    // Verify against body with consumedAt normalized to null.
    const body = { ...(rest as Record<string, unknown>), consumedAt: null };
    const ok = verify(body, Buffer.from(signature.value, 'hex'), pub);
    if (!ok) return { decision: 'REJECTED', reasonCode: 'PC_SIGNATURE_INVALID', promotionId: '' };
    // 5. Expiry
    if (Date.parse(payload.receipt.expiresAt) <= Date.now()) {
      return { decision: 'REJECTED', reasonCode: 'PC_EXPIRED', promotionId: '' };
    }
    // All checks passed: consume the receipt, return APPLIED.
    this.consumedReceipts.add(payload.receipt.receiptId);
    return {
      decision: 'APPLIED',
      reasonCode: 'PC_OK',
      promotionId: `promo-${payload.receipt.receiptId}`,
    };
  }

  private nonce(): string {
    return Math.random().toString(36).slice(2, 18);
  }

  /** For testing: how many receipts have been consumed. */
  get consumedCount(): number {
    return this.consumedReceipts.size;
  }
}
