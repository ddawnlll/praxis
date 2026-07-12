// @praxis/ledger — Merkle tree
//
// Domain-separated SHA-256 Merkle tree with deterministic odd-leaf handling
// (RFC 6962-style). Used for EvidenceBundle.merkleRoot computation and
// inclusion-proof verification.
//
// Concurrency: this module is pure. Concurrency control lives in the
// Ledger class.

import { createHash } from 'node:crypto';

export const MERKLE_LEAF_PREFIX = Buffer.from([0x00]);
export const MERKLE_NODE_PREFIX = Buffer.from([0x01]);

function hashLeaf(data: Buffer): Buffer {
  const h = createHash('sha256');
  h.update('praxis-merkle/v1');
  h.update('\0');
  h.update(MERKLE_LEAF_PREFIX);
  h.update(data);
  return h.digest();
}

function hashNode(left: Buffer, right: Buffer): Buffer {
  const h = createHash('sha256');
  h.update('praxis-merkle/v1');
  h.update('\0');
  h.update(MERKLE_NODE_PREFIX);
  h.update(left);
  h.update(right);
  return h.digest();
}

export interface MerkleProofStep {
  side: 'left' | 'right';
  hash: string; // hex
}

export interface MerkleProof {
  leafHash: string;
  steps: MerkleProofStep[];
  root: string;
}

export function leafHash(data: Buffer): Buffer {
  return hashLeaf(data);
}

/**
 * Compute the Merkle root for a list of leaf hashes (already computed).
 * Duplicates the last leaf when a level has an odd number of nodes
 * (RFC 6962). Order is preserved.
 */
export function rootFromHashes(leafHashes: Buffer[]): Buffer {
  if (leafHashes.length === 0) {
    return createHash('sha256').update('praxis-merkle/v1\0EMPTY').digest();
  }
  let level = leafHashes.slice();
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        next.push(hashNode(level[i], level[i]));
      } else {
        next.push(hashNode(level[i], level[i + 1]));
      }
    }
    level = next;
  }
  return level[0];
}

/** Convenience: build root from raw record bytes. */
export function rootFromRecords(records: Buffer[]): Buffer {
  if (records.length === 0) {
    return rootFromHashes([]);
  }
  return rootFromHashes(records.map((r) => hashLeaf(r)));
}

/** Compute the inclusion proof for the leaf at `index`. */
export function inclusionProof(leafHashes: Buffer[], index: number): MerkleProof {
  if (leafHashes.length === 0) throw new Error('Cannot prove inclusion in an empty tree');
  if (index < 0 || index >= leafHashes.length) {
    throw new Error(`Leaf index out of range: ${index}`);
  }
  const steps: MerkleProofStep[] = [];
  let level = leafHashes.slice();
  let i = index;
  while (level.length > 1) {
    // RFC 6962: only duplicate the last leaf when the level has an ODD number
    // of nodes. On even levels the last node has a real sibling.
    const isLastOdd = level.length % 2 === 1 && i === level.length - 1;
    const sibling = isLastOdd ? level[i] : level[i ^ 1];
    steps.push({ side: (i & 1) === 0 ? 'right' : 'left', hash: sibling.toString('hex') });
    const next: Buffer[] = [];
    for (let j = 0; j < level.length; j += 2) {
      if (j + 1 >= level.length) {
        next.push(hashNode(level[j], level[j]));
      } else {
        next.push(hashNode(level[j], level[j + 1]));
      }
    }
    level = next;
    i = Math.floor(i / 2);
  }
  return {
    leafHash: leafHashes[index].toString('hex'),
    steps,
    root: level[0].toString('hex'),
  };
}

export function verifyProof(proof: MerkleProof, rootHex: string): boolean {
  let current = Buffer.from(proof.leafHash, 'hex');
  for (const step of proof.steps) {
    const sib = Buffer.from(step.hash, 'hex');
    if (step.side === 'left') {
      current = hashNode(sib, current);
    } else {
      current = hashNode(current, sib);
    }
  }
  return current.toString('hex') === rootHex && rootHex === proof.root;
}
