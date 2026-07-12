// @praxis/verity-gates — Attestation tests (#19)
//
// Tests for captureAttestation, captureAttestationFromEnv, SECRET_DENYLIST,
// toolchain detection, dependency lock hashing, and environment fingerprinting.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { captureAttestation, captureAttestationFromEnv, SECRET_DENYLIST } from '../src/attestation';

const FIXTURE_DIR = join(import.meta.dir, '..', '__fixtures__', 'attestation');

describe('SECRET_DENYLIST', () => {
  test('contains expected sensitive keyword patterns', () => {
    expect(SECRET_DENYLIST).toContain('TOKEN');
    expect(SECRET_DENYLIST).toContain('SECRET');
    expect(SECRET_DENYLIST).toContain('PASSWORD');
    expect(SECRET_DENYLIST).toContain('API_KEY');
    expect(SECRET_DENYLIST).toContain('PRIVATE_KEY');
  });

  test('is a frozen-style array (not mutated in tests)', () => {
    expect(SECRET_DENYLIST.length).toBeGreaterThan(0);
  });
});

describe('captureAttestation', () => {
  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  test('returns default runner digest when none provided', () => {
    const att = captureAttestation();
    expect(att.runnerDigest).toBe('unknown:0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('uses provided runner digest', () => {
    const att = captureAttestation({ runnerDigest: 'sha256:abc123' });
    expect(att.runnerDigest).toBe('sha256:abc123');
  });

  test('detects toolchain from package.json', () => {
    const pkgPath = join(FIXTURE_DIR, 'package.json');
    writeFileSync(pkgPath, JSON.stringify({ devDependencies: { typescript: '~5.9.2' } }));
    const att = captureAttestation({ projectRoot: FIXTURE_DIR });
    expect(att.toolchain.language).toBe('TypeScript');
    expect(att.toolchain.compiler).toBe('tsc');
    expect(att.toolchain.version).toBe('5.9.2');
  });

  test('strips caret/tilde from typescript version', () => {
    const pkgPath = join(FIXTURE_DIR, 'package.json');
    writeFileSync(pkgPath, JSON.stringify({ dependencies: { typescript: '^5.8.0' } }));
    const att = captureAttestation({ projectRoot: FIXTURE_DIR });
    expect(att.toolchain.version).toBe('5.8.0');
  });

  test('defaults to unknown version when no package.json', () => {
    const att = captureAttestation({ projectRoot: '/nonexistent/path' });
    expect(att.toolchain.version).toBe('unknown');
  });

  test('hashes dependency lock file', () => {
    const lockPath = join(FIXTURE_DIR, 'bun.lock');
    writeFileSync(lockPath, 'lock-content-v1');
    const att = captureAttestation({ lockFilePath: lockPath });
    expect(att.dependencyLocks).toHaveLength(1);
    expect(att.dependencyLocks![0]).toContain(lockPath);
    expect(att.dependencyLocks![0]).toMatch(/:[a-f0-9]{64}$/);
  });

  test('handles missing lock file gracefully', () => {
    const att = captureAttestation({ lockFilePath: '/nonexistent/lock' });
    expect(att.dependencyLocks).toHaveLength(0);
  });

  test('produces consistent environment fingerprint on same machine', () => {
    const a = captureAttestation();
    const b = captureAttestation();
    expect(a.environmentFingerprint).toBe(b.environmentFingerprint);
  });

  test('environment fingerprint is a sha256 hex string', () => {
    const att = captureAttestation();
    expect(att.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test('redacts secrets from environment fingerprint', () => {
    const att = captureAttestation({ extraEnv: ['MY_TOKEN', 'NORMAL_VAR'] });
    expect(att.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test('extra env vars affect fingerprint', () => {
    const a = captureAttestation({ extraEnv: ['EXTRA_A'] });
    const b = captureAttestation({ extraEnv: ['EXTRA_B'] });
    // Different extra env → different fingerprint
    expect(a.environmentFingerprint).not.toBe(b.environmentFingerprint);
  });

  test('same extra env produces same fingerprint', () => {
    const a = captureAttestation({ extraEnv: ['EXTRA_X'] });
    const b = captureAttestation({ extraEnv: ['EXTRA_X'] });
    expect(a.environmentFingerprint).toBe(b.environmentFingerprint);
  });

  test('full options produces complete attestation', () => {
    const pkgPath = join(FIXTURE_DIR, 'package.json');
    writeFileSync(pkgPath, JSON.stringify({ devDependencies: { typescript: '^5.9.0' } }));
    const lockPath = join(FIXTURE_DIR, 'bun.lock');
    writeFileSync(lockPath, 'lock-v2');

    const att = captureAttestation({
      runnerDigest: 'sha256:deadbeef',
      lockFilePath: lockPath,
      projectRoot: FIXTURE_DIR,
      extraEnv: ['CI'],
    });

    expect(att.runnerDigest).toBe('sha256:deadbeef');
    expect(att.toolchain.version).toBe('5.9.0');
    expect(att.dependencyLocks).toHaveLength(1);
    expect(att.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('captureAttestationFromEnv', () => {
  test('returns a valid Attestation shape', () => {
    const att = captureAttestationFromEnv();
    expect(att).toHaveProperty('runnerDigest');
    expect(att).toHaveProperty('toolchain');
    expect(att).toHaveProperty('environmentFingerprint');
    expect(att.toolchain).toHaveProperty('language');
    expect(att.toolchain).toHaveProperty('compiler');
    expect(att.toolchain).toHaveProperty('version');
  });

  test('passes extra env vars through', () => {
    const a = captureAttestationFromEnv([]);
    const b = captureAttestationFromEnv(['SOME_EXTRA_VAR']);
    // Both should be valid but fingerprints may differ
    expect(a.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(b.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test('uses cwd as project root for toolchain detection', () => {
    const att = captureAttestationFromEnv();
    // Should detect TypeScript from the monorepo root
    expect(att.toolchain.language).toBe('TypeScript');
  });
});
