// @praxis/protocol — migration tests (issue #16)

import { describe, test, expect } from 'bun:test';
import { migrate, migrateV01, detectMixed, detectVersion, MigrationError } from '../src/v1/migration';

describe('migration detectVersion', () => {
  test('v0.1 detected', () => {
    expect(detectVersion({ planSpecVersion: 'praxis-planspec/v0.1' })).toBe('praxis-planspec/v0.1');
  });
  test('v5-alpha2 detected', () => {
    expect(detectVersion({ planSpecVersion: '5.0.0-alpha2' })).toBe('praxis-protocol/v5-alpha2');
  });
  test('v1 detected', () => {
    expect(detectVersion({ protocolVersion: 'praxis-protocol/v1' })).toBe('praxis-protocol/v1');
  });
  test('unknown version', () => {
    expect(detectVersion({})).toBe('unknown');
  });
});

describe('migration detectMixed', () => {
  test('pure v0.1 is not mixed', () => {
    expect(detectMixed({ planSpecVersion: 'praxis-planspec/v0.1' })).toBe(false);
  });
  test('mixed v0.1 + v5 fields is mixed', () => {
    expect(detectMixed({ planSpecVersion: 'praxis-planspec/v0.1', enforcementRegistry: [] })).toBe(true);
  });
  test('v5 with v01 keys is mixed', () => {
    expect(detectMixed({ planSpecVersion: '5.0.0-alpha2', v01_workflow: {} })).toBe(true);
  });
  test('pure v5 is not mixed', () => {
    expect(detectMixed({ planSpecVersion: '5.0.0-alpha2', enforcementRegistry: [] })).toBe(false);
  });
});

describe('migration migrateV01', () => {
  const baseV01 = {
    planSpecVersion: 'praxis-planspec/v0.1',
    planId: 'plan-1',
    intent: 'do a thing',
  };
  test('produces a v1 manifest + policy', () => {
    const r = migrateV01(baseV01 as any);
    expect(r.manifest.schemaVersion).toBe('praxis-protocol/v1');
    expect(r.policy.schemaVersion).toBe('praxis-protocol/v1');
    expect(r.manifest.baseHash).toMatch(/^[a-f0-9]{64}$/);
  });
  test('human approval defaults to TRUE when v0.1 omits it', () => {
    const r = migrateV01(baseV01 as any);
    expect(r.policy.authority.humanApprovalRequired).toBe(true);
  });
  test('human approval is preserved when v0.1 sets false', () => {
    const r = migrateV01({ ...baseV01, authority: { humanApprovalRequired: false } } as any);
    expect(r.policy.authority.humanApprovalRequired).toBe(false);
  });
  test('rejects missing planId', () => {
    expect(() => migrateV01({ planSpecVersion: 'praxis-planspec/v0.1', intent: 'x' } as any)).toThrow(MigrationError);
  });
  test('rejects missing intent', () => {
    expect(() => migrateV01({ planSpecVersion: 'praxis-planspec/v0.1', planId: 'x' } as any)).toThrow(MigrationError);
  });
  test('rejects wrong planSpecVersion', () => {
    expect(() => migrateV01({ planSpecVersion: 'other', planId: 'x', intent: 'y' } as any)).toThrow(MigrationError);
  });
  test('idempotent: same input → same output', () => {
    const a = migrateV01(baseV01 as any);
    const b = migrateV01(baseV01 as any);
    expect(a.manifest.candidateId).toBe(b.manifest.candidateId);
    expect(a.manifest.baseHash).toBe(b.manifest.baseHash);
    expect(a.policy.policyId).toBe(b.policy.policyId);
  });
  test('different inputs produce different outputs', () => {
    const a = migrateV01(baseV01 as any);
    const b = migrateV01({ ...baseV01, intent: 'different intent' } as any);
    expect(a.manifest.baseHash).not.toBe(b.manifest.baseHash);
  });
  test('forbidden files become forbidden globs', () => {
    const r = migrateV01({ ...baseV01, forbiddenFiles: ['a', 'b'] } as any);
    expect(r.policy.scope?.forbiddenGlobs).toEqual(['a', 'b']);
  });
  test('idempotency key is bound to base hash', () => {
    const r = migrateV01(baseV01 as any);
    expect(r.manifest.idempotencyKey).toContain(r.manifest.baseHash.slice(0, 12));
  });
});

describe('migration migrate() entry', () => {
  test('v1 input passes through', () => {
    const env = {
      schemaVersion: 'praxis-protocol/v1',
      candidateId: 'c-1',
      policyId: 'p-1',
      baseHash: 'a'.repeat(64),
      intent: 'x',
      submittedBy: { identityId: 'A', keyId: 'a'.repeat(16) },
      submittedAt: '2026-07-11T00:00:00Z',
    };
    const r = migrate(env as any);
    expect(r.ok).toBe(true);
    expect(r.manifest).toEqual(env);
  });
  test('mixed input is rejected', () => {
    const r = migrate({ planSpecVersion: 'praxis-planspec/v0.1', enforcementRegistry: [] } as any);
    expect(r.ok).toBe(false);
    expect(r.reasonCode).toBe('MIXED_LEGACY_VERSION');
  });
  test('unknown version is rejected', () => {
    const r = migrate({ planSpecVersion: 'something-else' } as any);
    expect(r.ok).toBe(false);
    expect(r.reasonCode).toBe('LEGACY_VERSION_UNSUPPORTED');
  });
  test('v0.1 input is migrated to v1', () => {
    const r = migrate({ planSpecVersion: 'praxis-planspec/v0.1', planId: 'p1', intent: 'x' } as any);
    expect(r.ok).toBe(true);
    expect(r.manifest?.schemaVersion).toBe('praxis-protocol/v1');
  });
});
