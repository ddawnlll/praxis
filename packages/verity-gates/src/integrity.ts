// @praxis/verity-gates — IntegrityGate (#21)
//
// Verifies: bundle.merkleRoot is consistent with bundle.records (RFC-6962
// merkle, computed by @praxis/ledger). When a signature is present in the
// envelope, verifies the signature against the manifest + the trust store.
// Fail-closed: any inconsistency is FAIL.

import type { Gate, GateContext, GateResult } from './gate';
import { makeResult } from './gate';
import { rootFromRecords } from '@praxis/ledger';
import { canonicalize, loadPublicKey, verify, type TrustStore } from '@praxis/protocol';
import type { GateName } from '@praxis/protocol';

export interface IntegrityOptions {
  trustStore?: TrustStore;
  /** Optional: signature (hex) over the canonical manifest. */
  signature?: string;
}

function recordBytesForMerkle(r: { recordId: string; capturedAt: string; payload: unknown }): Buffer {
  return Buffer.from(canonicalize({
    recordId: r.recordId,
    capturedAt: r.capturedAt,
    payload: r.payload,
  }));
}

export class IntegrityGate implements Gate {
  readonly name: GateName = 'integrity';
  constructor(private readonly opts: IntegrityOptions = {}) {}

  evaluate(ctx: GateContext): GateResult {
    const at = new Date().toISOString();

    if (!ctx.bundle) {
      return makeResult(this.name, 'FAIL', 'INTEGRITY_BUNDLE_MISSING', at);
    }
    // Recompute Merkle root from records and compare to bundle.merkleRoot.
    const records = ctx.bundle.records;
    const expected = rootFromRecords(records.map((r) => recordBytesForMerkle(r as { recordId: string; capturedAt: string; payload: unknown }))).toString('hex');
    if (expected !== ctx.bundle.merkleRoot) {
      return makeResult(this.name, 'FAIL', `INTEGRITY_MERKLE_MISMATCH:${expected.slice(0, 8)}vs${ctx.bundle.merkleRoot.slice(0, 8)}`, at);
    }
    // Attestation requires runner digest in 'algo:sha256' format.
    if (!/^[a-z0-9]+:[a-f0-9]{64}$/.test(ctx.bundle.attestation.runnerDigest)) {
      return makeResult(this.name, 'FAIL', 'INTEGRITY_RUNNER_DIGEST_FORMAT', at);
    }
    // Optional signature verification (over canonical manifest)
    if (this.opts.signature && this.opts.trustStore) {
      const sender = ctx.envelope?.sender;
      if (!sender) {
        return makeResult(this.name, 'FAIL', 'INTEGRITY_SIGNATURE_NO_SENDER', at);
      }
      const resolved = this.opts.trustStore.resolve(sender.keyId);
      if (!resolved) {
        return makeResult(this.name, 'FAIL', 'INTEGRITY_TRUST_UNRESOLVED', at);
      }
      let pub;
      try {
        pub = loadPublicKey(resolved.entry.publicKeyHex);
      } catch {
        return makeResult(this.name, 'FAIL', 'INTEGRITY_PUBLIC_KEY_INVALID', at);
      }
      const ok = verify(ctx.manifest, Buffer.from(this.opts.signature, 'hex'), pub);
      if (!ok) {
        return makeResult(this.name, 'FAIL', 'INTEGRITY_SIGNATURE_INVALID', at);
      }
    }
    return makeResult(this.name, 'PASS', 'INTEGRITY_OK', at);
  }
}
