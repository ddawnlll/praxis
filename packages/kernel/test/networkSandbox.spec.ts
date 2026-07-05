import { describe, test, expect } from 'bun:test';
import { checkNetworkAccess, createNetworkPolicy } from '../src/executor/networkSandbox';

describe('NetworkSandbox', () => {
  test('allows all by default', () => {
    expect(checkNetworkAccess('curl http://example.com').allowed).toBe(true);
    expect(checkNetworkAccess('wget http://example.com').allowed).toBe(true);
  });

  test('blocks network commands when policy is none', () => {
    expect(checkNetworkAccess('curl http://example.com', { allow: 'none' }).allowed).toBe(false);
    expect(checkNetworkAccess('wget http://example.com', { allow: 'none' }).allowed).toBe(false);
  });

  test('allows non-network commands when policy is none', () => {
    expect(checkNetworkAccess('echo hello', { allow: 'none' }).allowed).toBe(true);
    expect(checkNetworkAccess('ls -la', { allow: 'none' }).allowed).toBe(true);
  });

  test('blocks external hosts when policy is loopback', () => {
    const policy = { allow: 'loopback' as const };
    expect(checkNetworkAccess('curl http://example.com', policy).allowed).toBe(false);
  });

  test('allows localhost when policy is loopback', () => {
    const policy = { allow: 'loopback' as const };
    expect(checkNetworkAccess('curl http://localhost:3457', policy).allowed).toBe(true);
    expect(checkNetworkAccess('curl http://127.0.0.1:3457', policy).allowed).toBe(true);
  });

  test('createNetworkPolicy merges with defaults', () => {
    const policy = createNetworkPolicy({ allow: 'none' });
    expect(policy.allow).toBe('none');
    expect(policy.allowedHosts).toBeUndefined();
  });

  test('detects various network tools', () => {
    expect(checkNetworkAccess('ssh user@host', { allow: 'none' }).allowed).toBe(false);
    expect(checkNetworkAccess('nc -zv host 80', { allow: 'none' }).allowed).toBe(false);
  });
});
