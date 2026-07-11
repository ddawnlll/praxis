// @praxis/ledger — Merkle tree tests

import { describe, test, expect } from 'bun:test';
import {
  rootFromHashes,
  rootFromRecords,
  leafHash,
  inclusionProof,
  verifyProof,
  MERKLE_LEAF_PREFIX,
  MERKLE_NODE_PREFIX,
} from '../src/merkle';
import { createHash } from 'node:crypto';

describe('Merkle', () => {
  test('leafHash is domain-separated', () => {
    const a = leafHash(Buffer.from('x'));
    const b = createHash('sha256').update('praxis-merkle/v1\0').update(MERKLE_LEAF_PREFIX).update(Buffer.from('x')).digest();
    expect(a.equals(b)).toBe(true);
  });
  test('empty root is deterministic', () => {
    const r1 = rootFromRecords([]);
    const r2 = rootFromHashes([]);
    expect(r1.equals(r2)).toBe(true);
  });
  test('single record root equals its leaf', () => {
    const r = rootFromRecords([Buffer.from('only')]);
    expect(r.equals(leafHash(Buffer.from('only')))).toBe(true);
  });
  test('two records produce a node hash of leaves', () => {
    const a = leafHash(Buffer.from('a'));
    const b = leafHash(Buffer.from('b'));
    const expected = createHash('sha256').update('praxis-merkle/v1\0').update(MERKLE_NODE_PREFIX).update(a).update(b).digest();
    expect(rootFromRecords([Buffer.from('a'), Buffer.from('b')]).equals(expected)).toBe(true);
  });
  test('any record mutation changes the root', () => {
    const r1 = rootFromRecords([Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]);
    const r2 = rootFromRecords([Buffer.from('a'), Buffer.from('B'), Buffer.from('c')]);
    expect(r1.equals(r2)).toBe(false);
    const r3 = rootFromRecords([Buffer.from('a'), Buffer.from('b')]);
    expect(r1.equals(r3)).toBe(false);
  });
  test('inclusion proof verifies', () => {
    const data = ['a', 'b', 'c', 'd', 'e'].map(Buffer.from);
    const hashes = data.map((d) => leafHash(d));
    const root = rootFromHashes(hashes);
    for (let i = 0; i < data.length; i++) {
      const proof = inclusionProof(hashes, i);
      expect(proof.leafHash).toBe(hashes[i].toString('hex'));
      expect(proof.root).toBe(root.toString('hex'));
      expect(verifyProof(proof, root.toString('hex'))).toBe(true);
    }
  });
  test('inclusion proof rejects tampered leaf', () => {
    const data = ['a', 'b', 'c'].map(Buffer.from);
    const hashes = data.map((d) => leafHash(d));
    const root = rootFromHashes(hashes);
    const proof = inclusionProof(hashes, 1);
    proof.leafHash = leafHash(Buffer.from('B')).toString('hex');
    expect(verifyProof(proof, root.toString('hex'))).toBe(false);
  });
  test('odd-count level duplicates the last leaf', () => {
    // With 3 leaves: hashes [a,b,c], level becomes [h(a,b), h(c,c)]
    const a = leafHash(Buffer.from('a'));
    const b = leafHash(Buffer.from('b'));
    const c = leafHash(Buffer.from('c'));
    const ab = createHash('sha256').update('praxis-merkle/v1\0').update(MERKLE_NODE_PREFIX).update(a).update(b).digest();
    const cc = createHash('sha256').update('praxis-merkle/v1\0').update(MERKLE_NODE_PREFIX).update(c).update(c).digest();
    const expected = createHash('sha256').update('praxis-merkle/v1\0').update(MERKLE_NODE_PREFIX).update(ab).update(cc).digest();
    expect(rootFromHashes([a, b, c]).equals(expected)).toBe(true);
  });
  test('proofs are deterministic and stable across runs', () => {
    const hashes = ['x', 'y', 'z', 'w'].map((s) => leafHash(Buffer.from(s)));
    const p1 = inclusionProof(hashes, 2);
    const p2 = inclusionProof(hashes, 2);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });
});
