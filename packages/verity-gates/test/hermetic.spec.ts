// @praxis/verity-gates — HermeticExecGate + OciRunner + Isolation tests (#26)
//
// Tests for mock OCI runner, isolation policy validation,
// hermetic exec gate with adapters, and Docker runner interface.

import { describe, test, expect } from 'bun:test';
import { mockOciRunner, DockerOciRunner } from '../src/ociRunner';
import { defaultIsolationPolicy, verifyIsolationPolicy } from '../src/isolation';
import { HermeticExecGate, TestAdapter } from '../src/hermeticExec';
import type { GateContext } from '../src/gate';

function makeCtx(): GateContext {
  return { policy: {} as any, manifest: {} as any, metadata: {} };
}

describe('mockOciRunner', () => {
  test('has correct name', () => {
    expect(mockOciRunner.name).toBe('mock-oci');
  });

  test('run returns mocked output with command echoed', async () => {
    const result = await mockOciRunner.run({
      image: 'node',
      imageDigest: 'sha256:' + 'a'.repeat(64),
      command: ['echo', 'hello'],
      mounts: [],
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('echo hello');
    expect(result.stdout).toContain('node');
    expect(result.stderr).toBe('');
  });

  test('output digest is sha256 hex', async () => {
    const result = await mockOciRunner.run({
      image: 'node',
      imageDigest: 'sha256:' + 'a'.repeat(64),
      command: ['test'],
      mounts: [],
    });
    expect(result.outputDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test('output digest is deterministic for same input', async () => {
    const opts = {
      image: 'node',
      imageDigest: 'sha256:' + 'a'.repeat(64),
      command: ['echo', 'hello'],
      mounts: [],
    };
    const a = await mockOciRunner.run(opts);
    const b = await mockOciRunner.run(opts);
    expect(a.outputDigest).toBe(b.outputDigest);
  });

  test('checkImage always returns true', async () => {
    const ok = await mockOciRunner.checkImage({
      image: 'any-image',
      imageDigest: 'sha256:' + 'b'.repeat(64),
      command: [],
      mounts: [],
    });
    expect(ok).toBe(true);
  });

  test('handles mounts in run options', async () => {
    const result = await mockOciRunner.run({
      image: 'node',
      imageDigest: 'sha256:' + 'a'.repeat(64),
      command: ['ls'],
      mounts: [{ source: '/host', target: '/container', readonly: true }],
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('DockerOciRunner', () => {
  test('has correct name', () => {
    const runner = new DockerOciRunner();
    expect(runner.name).toBe('docker');
  });

  test('accepts custom docker binary', () => {
    const runner = new DockerOciRunner('/usr/local/bin/docker');
    expect(runner.dockerBinary).toBe('/usr/local/bin/docker');
  });

  test('checkImage returns false when docker not available', async () => {
    const runner = new DockerOciRunner('nonexistent-docker-binary');
    const ok = await runner.checkImage({
      image: 'node',
      imageDigest: 'sha256:' + 'a'.repeat(64),
      command: [],
      mounts: [],
    });
    expect(ok).toBe(false);
  });
});

describe('defaultIsolationPolicy', () => {
  test('returns a valid policy', () => {
    const p = defaultIsolationPolicy();
    expect(p.network.defaultPolicy).toBe('deny');
    expect(p.process.noNewPrivileges).toBe(true);
    expect(p.process.killTreeOnTimeout).toBe(true);
  });

  test('returns a deep copy (mutating one does not affect default)', () => {
    const a = defaultIsolationPolicy();
    const b = defaultIsolationPolicy();
    a.resources.maxCpuCores = 999;
    expect(b.resources.maxCpuCores).not.toBe(999);
  });

  test('has reasonable defaults', () => {
    const p = defaultIsolationPolicy();
    expect(p.resources.maxCpuCores).toBeGreaterThanOrEqual(1);
    expect(p.resources.maxMemoryMb).toBeGreaterThanOrEqual(256);
    expect(p.resources.maxPids).toBeGreaterThanOrEqual(4);
    expect(p.resources.timeoutMs).toBeGreaterThanOrEqual(1000);
  });
});

describe('verifyIsolationPolicy', () => {
  test('PASS for default policy', () => {
    const result = verifyIsolationPolicy(defaultIsolationPolicy());
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('FAIL for invalid network defaultPolicy', () => {
    const p = defaultIsolationPolicy();
    (p.network as any).defaultPolicy = 'invalid';
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('defaultPolicy'))).toBe(true);
  });

  test('FAIL for maxCpuCores too low', () => {
    const p = defaultIsolationPolicy();
    p.resources.maxCpuCores = 0.01;
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('maxCpuCores'))).toBe(true);
  });

  test('FAIL for maxMemoryMb too low', () => {
    const p = defaultIsolationPolicy();
    p.resources.maxMemoryMb = 2;
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('maxMemoryMb'))).toBe(true);
  });

  test('FAIL for maxPids too low', () => {
    const p = defaultIsolationPolicy();
    p.resources.maxPids = 1;
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('maxPids'))).toBe(true);
  });

  test('FAIL for maxOutputBytes too low', () => {
    const p = defaultIsolationPolicy();
    p.resources.maxOutputBytes = 100;
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('maxOutputBytes'))).toBe(true);
  });

  test('FAIL for timeoutMs too low', () => {
    const p = defaultIsolationPolicy();
    p.resources.timeoutMs = 50;
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('timeoutMs'))).toBe(true);
  });

  test('PASS for valid custom policy', () => {
    const p = defaultIsolationPolicy();
    p.resources.maxCpuCores = 4;
    p.resources.maxMemoryMb = 2048;
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(true);
  });

  test('collects multiple violations', () => {
    const p = defaultIsolationPolicy();
    p.resources.maxCpuCores = 0;
    p.resources.maxMemoryMb = 1;
    p.resources.maxPids = 0;
    const result = verifyIsolationPolicy(p);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});

describe('HermeticExecGate', () => {
  test('FAIL when no adapters match', () => {
    const gate = new HermeticExecGate({
      runner: mockOciRunner,
      isolationPolicy: defaultIsolationPolicy(),
      adapters: [],
    });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/HERMETIC_NO_ADAPTERS_MATCHED/);
  });

  test('PASS when TestAdapter runs successfully', () => {
    const gate = new HermeticExecGate({
      runner: mockOciRunner,
      isolationPolicy: defaultIsolationPolicy(),
      adapters: [new TestAdapter('echo test')],
    });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('PASS');
    expect(result.reasonCode).toBe('HERMETIC_OK');
  });

  test('FAIL when adapter returns non-zero exit code', () => {
    // Create a custom adapter that always fails
    const failAdapter = {
      name: 'failing-test',
      compile: () => ({
        image: 'node',
        imageDigest: 'sha256:' + 'a'.repeat(64),
        command: ['false'],
        mounts: [],
        timeoutMs: 5000,
      }),
      parse: () => ({ ok: false, failures: ['exit code 1'], evidence: {} }),
    };
    const gate = new HermeticExecGate({
      runner: mockOciRunner,
      isolationPolicy: defaultIsolationPolicy(),
      adapters: [failAdapter as any],
    });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/HERMETIC_ADAPTER_FAILED/);
  });
});

describe('TestAdapter', () => {
  test('has correct name', () => {
    expect(new TestAdapter('echo hi').name).toBe('test');
  });

  test('compile produces valid OciRunOptions', () => {
    const adapter = new TestAdapter('bun test');
    const opts = adapter.compile(makeCtx(), defaultIsolationPolicy());
    expect(opts).not.toBeNull();
    expect(opts!.command).toEqual(['bun', 'test']);
    expect(opts!.image).toBe('praxis-runner');
    expect(opts!.nonRoot).toBe(true);
    expect(opts!.timeoutMs).toBe(60000);
  });

  test('parse returns ok for exit code 0', () => {
    const adapter = new TestAdapter('echo');
    const result = adapter.parse({
      stdout: 'all tests passed',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      outputDigest: 'a'.repeat(64),
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  test('parse returns fail for non-zero exit code', () => {
    const adapter = new TestAdapter('echo');
    const result = adapter.parse({
      stdout: '',
      stderr: 'error',
      exitCode: 1,
      timedOut: false,
      outputDigest: 'b'.repeat(64),
    });
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
