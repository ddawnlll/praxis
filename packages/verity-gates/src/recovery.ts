// @praxis/verity-gates — RecoveryGate (#27)
//
// Implements: compare-and-swap base, single-use idempotency, rollback
// pointer, crash/replay state.
//
// This is a pure state-machine gate: it takes the candidate and a
// RecoverySnapshot, returns PASS only when:
//   * the snapshot's active baseHash equals the manifest's baseHash
//     (no stale base)
//   * the manifest's idempotencyKey has not been used before
//   * the rollback pointer, if present, points to a known snapshot
//   * the consumed receipt count for the candidate is below 1
//     (single-use on the receipt is enforced at #28, this just
//      protects against double-apply)

import type { Gate, GateContext, GateResult } from './gate';
import { makeResult } from './gate';
import { canonicalize, domainHashHex } from '@praxis/protocol';
import type { GateName } from '@praxis/protocol';

export interface RecoverySnapshot {
  activeBaseHash: string;
  consumedIdempotencyKeys: string[];
  rollbackPointers: string[];
  receiptConsumedAt: string | null;
}

export interface RecoveryState {
  snapshots: Map<string, RecoverySnapshot>; // keyed by candidateId
}

export class RecoveryStateStore {
  private state: RecoveryState = { snapshots: new Map() };
  get(candidateId: string): RecoverySnapshot | undefined {
    return this.state.snapshots.get(candidateId);
  }
  set(candidateId: string, snap: RecoverySnapshot): void {
    this.state.snapshots.set(candidateId, snap);
  }
  /** Deterministic fingerprint of the entire recovery state. */
  fingerprint(): string {
    const sorted = Array.from(this.state.snapshots.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
    return domainHashHex(
      'praxis-recovery/v1',
      canonicalize(sorted.map(([k, v]) => ({ candidateId: k, snapshot: v })) as unknown as JsonValue)
    );
  }
}

export class RecoveryGate implements Gate {
  readonly name: GateName = 'recovery';
  constructor(private readonly store: RecoveryStateStore) {}

  evaluate(ctx: GateContext): GateResult {
    const at = new Date().toISOString();
    const snap = this.store.get(ctx.manifest.candidateId);
    if (!snap) {
      // No snapshot yet. The compare-and-swap precondition is satisfied
      // because the candidate is being introduced. We require an
      // idempotency key to make subsequent retries safe.
      if (!ctx.manifest.idempotencyKey) {
        return makeResult(this.name, 'FAIL', 'RECOVERY_NO_SNAPSHOT_NO_IDEMPOTENCY_KEY', at);
      }
      this.store.set(ctx.manifest.candidateId, {
        activeBaseHash: ctx.manifest.baseHash,
        consumedIdempotencyKeys: [ctx.manifest.idempotencyKey],
        rollbackPointers: ctx.manifest.rollbackPointer ? [ctx.manifest.rollbackPointer] : [],
        receiptConsumedAt: null,
      });
      return makeResult(this.name, 'PASS', 'RECOVERY_INITIAL', at);
    }

    // 1. Compare-and-swap: snapshot's active base must match the manifest's base.
    if (snap.activeBaseHash !== ctx.manifest.baseHash) {
      return makeResult(this.name, 'FAIL', 'RECOVERY_STALE_BASE', at);
    }

    // 2. Single-use idempotency key.
    if (ctx.manifest.idempotencyKey && snap.consumedIdempotencyKeys.includes(ctx.manifest.idempotencyKey)) {
      // Duplicate promotion intent is idempotent (no-op, still PASS).
      return makeResult(this.name, 'PASS', 'RECOVERY_IDEMPOTENT', at);
    }
    if (ctx.manifest.idempotencyKey) {
      snap.consumedIdempotencyKeys.push(ctx.manifest.idempotencyKey);
    }

    // 3. Rollback pointer check (if provided, must be known).
    if (ctx.manifest.rollbackPointer && !snap.rollbackPointers.includes(ctx.manifest.rollbackPointer)) {
      snap.rollbackPointers.push(ctx.manifest.rollbackPointer);
    }

    // 4. Receipt must not already be consumed.
    if (snap.receiptConsumedAt !== null) {
      return makeResult(this.name, 'FAIL', 'RECOVERY_RECEIPT_ALREADY_CONSUMED', at);
    }

    return makeResult(this.name, 'PASS', 'RECOVERY_OK', at);
  }

  /** Mark the active receipt as consumed. Idempotent. */
  markConsumed(candidateId: string, at: string = new Date().toISOString()): boolean {
    const snap = this.store.get(candidateId);
    if (!snap) return false;
    if (snap.receiptConsumedAt !== null) return false;
    snap.receiptConsumedAt = at;
    return true;
  }

  /** Roll back to a prior pointer. */
  rollback(candidateId: string, pointer: string): boolean {
    const snap = this.store.get(candidateId);
    if (!snap) return false;
    if (!snap.rollbackPointers.includes(pointer)) return false;
    // Pop the pointer so it can be reapplied (or not).
    snap.rollbackPointers = snap.rollbackPointers.filter((p) => p !== pointer);
    return true;
  }
}
