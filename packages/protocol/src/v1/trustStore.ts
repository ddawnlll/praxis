// @praxis/protocol — trust store and key rotation.
//
// The trust store is a deterministic, in-memory snapshot of which keys are
// trusted for which identity, with expiry and revocation metadata. It can be
// serialized to JSON (for cold-path verifiers) and reloaded.

import { createHash, KeyObject } from 'node:crypto';
import { loadPublicKey } from './signing';
import { keyId } from './signing';

export interface TrustEntry {
  identityId: string;
  publicKeyHex: string;
  keyId: string;
  notBefore: string; // ISO-8601
  notAfter: string;  // ISO-8601
  revoked: boolean;
  revokedAt: string | null;
  // Optional human-readable label
  label?: string;
}

export interface TrustStoreSnapshot {
  schemaVersion: 'praxis-trust-store/v1';
  createdAt: string;
  entries: TrustEntry[];
}

export class TrustStore {
  private byKeyId = new Map<string, TrustEntry>();
  private byIdentity = new Map<string, TrustEntry[]>();

  static empty(): TrustStore {
    return new TrustStore();
  }

  static fromSnapshot(snap: TrustStoreSnapshot): TrustStore {
    const ts = new TrustStore();
    for (const e of snap.entries) ts.add(e);
    return ts;
  }

  add(entry: TrustEntry): void {
    if (!entry.identityId || !entry.publicKeyHex) {
      throw new Error('Trust entry must have identityId and publicKeyHex');
    }
    // Recompute keyId from the public key to ensure consistency.
    const pub = loadPublicKey(entry.publicKeyHex);
    entry.keyId = keyId(pub);
    this.byKeyId.set(entry.keyId, entry);
    const list = this.byIdentity.get(entry.identityId) ?? [];
    list.push(entry);
    this.byIdentity.set(entry.identityId, list);
  }

  /** Returns the public key object for a given keyId if trusted at `at`. */
  resolve(keyIdValue: string, at: Date = new Date()): { publicKey: KeyObject; entry: TrustEntry } | null {
    const e = this.byKeyId.get(keyIdValue);
    if (!e) return null;
    if (e.revoked) return null;
    if (at < new Date(e.notBefore)) return null;
    if (at > new Date(e.notAfter)) return null;
    return { publicKey: loadPublicKey(e.publicKeyHex), entry: e };
  }

  /** All non-revoked keys for an identity at time `at`. */
  resolveIdentity(identityId: string, at: Date = new Date()): TrustEntry[] {
    const list = this.byIdentity.get(identityId) ?? [];
    return list.filter((e) => !e.revoked && at >= new Date(e.notBefore) && at <= new Date(e.notAfter));
  }

  /** Mark a key as revoked. Subsequent resolve() returns null. */
  revoke(keyIdValue: string, at: Date = new Date()): boolean {
    const e = this.byKeyId.get(keyIdValue);
    if (!e) return false;
    e.revoked = true;
    e.revokedAt = at.toISOString();
    return true;
  }

  snapshot(createdAt: string = new Date().toISOString()): TrustStoreSnapshot {
    return {
      schemaVersion: 'praxis-trust-store/v1',
      createdAt,
      entries: Array.from(this.byKeyId.values()),
    };
  }

  size(): number {
    return this.byKeyId.size;
  }
}

/** Deterministic content hash of a trust-store snapshot. */
export function snapshotHash(snap: TrustStoreSnapshot): string {
  const h = createHash('sha256');
  h.update('praxis-trust-store/v1');
  h.update('\0');
  // Sort entries by keyId for determinism.
  const sorted = [...snap.entries].sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
  for (const e of sorted) {
    h.update(`${e.identityId}|${e.keyId}|${e.notBefore}|${e.notAfter}|${e.revoked ? '1' : '0'}|${e.revokedAt ?? ''}|${e.publicKeyHex}\n`);
  }
  return h.digest('hex');
}
