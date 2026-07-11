// @praxis/protocol — canonical serialization tests

import { describe, test, expect } from 'bun:test';
import { canonicalize, toCanonicalString, domainHash, domainHashHex } from '../src/v1/canonicalize';
import { createHash } from 'node:crypto';

describe('canonicalize', () => {
  test('object keys are sorted', () => {
    expect(toCanonicalString({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  test('nested object keys are sorted', () => {
    expect(toCanonicalString({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });
  test('arrays preserve order', () => {
    expect(toCanonicalString([3, 1, 2])).toBe('[3,1,2]');
  });
  test('undefined values in objects are dropped', () => {
    // @ts-expect-error -- undefined in objects is the runtime contract being tested
    expect(toCanonicalString({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });
  test('null values in objects are kept', () => {
    expect(toCanonicalString({ a: 1, b: null })).toBe('{"a":1,"b":null}');
  });
  test('null in array is kept', () => {
    expect(toCanonicalString([1, null, 2])).toBe('[1,null,2]');
  });
  test('strings are escaped per JSON', () => {
    expect(toCanonicalString({ a: 'hello "world"' })).toBe('{"a":"hello \\"world\\""}');
  });
  test('surrogate pairs are preserved', () => {
    expect(toCanonicalString({ a: '😀' })).toBe('{"a":"😀"}');
  });
  test('non-finite numbers throw', () => {
    expect(() => toCanonicalString({ a: Number.NaN })).toThrow();
    expect(() => toCanonicalString({ a: Infinity })).toThrow();
  });
  test('integer vs float formatting follows ECMA', () => {
    expect(toCanonicalString({ a: 1 })).toBe('{"a":1}');
    expect(toCanonicalString({ a: 1.5 })).toBe('{"a":1.5}');
    expect(toCanonicalString({ a: 1e5 })).toBe('{"a":100000}');
  });
  test('equivalent objects produce identical bytes', () => {
    const a = canonicalize({ a: 1, b: 2, c: { x: 'x', y: 'y' } });
    const b = canonicalize({ c: { y: 'y', x: 'x' }, b: 2, a: 1 });
    expect(a.equals(b)).toBe(true);
  });
  test('rejects unsupported types', () => {
    // @ts-expect-error
    expect(() => toCanonicalString({ a: () => {} })).toThrow();
  });
  test('domainHash is deterministic and domain-separated', () => {
    const v = { a: 1 };
    const h1 = domainHash('domainA', v).toString('hex');
    const h2 = domainHash('domainA', v).toString('hex');
    const h3 = domainHash('domainB', v).toString('hex');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
  test('domainHash matches manual sha256(canonical + domain)', () => {
    const v = { b: 2, a: 1 };
    const expected = createHash('sha256').update('manual').update('\0').update(canonicalize(v)).digest('hex');
    expect(domainHashHex('manual', v)).toBe(expected);
  });
});
