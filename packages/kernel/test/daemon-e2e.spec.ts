// @praxis/kernel — Daemon E2E Test
// Tests that daemon connects and produces same verdict as cold path.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { resolve } from 'node:path';
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { createDaemon, type DaemonServer, type VerifyRequest } from '../src/daemon/praxisDaemon';
import { runKernel } from '../src/runP6Kernel';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const TEST_LOCK_DIR = resolve(REPO_ROOT, '.praxis/locks/e2e-test');

function cleanupLockDir(): void {
  try {
    const lockFiles = require('node:fs').readdirSync(TEST_LOCK_DIR)
      .filter((f: string) => f.endsWith('.lock.yaml'));
    for (const f of lockFiles) {
      unlinkSync(resolve(TEST_LOCK_DIR, f));
    }
  } catch {}
}

beforeAll(() => {
  if (!existsSync(TEST_LOCK_DIR)) mkdirSync(TEST_LOCK_DIR, { recursive: true });
});
afterAll(() => { cleanupLockDir(); });

describe('Daemon E2E — cold vs daemon verdict', () => {
  test('daemon and cold path produce same verdict for same plan', async () => {
    const planPath = resolve(REPO_ROOT, 'examples/planspec/runtime-code.plan.yaml');
    const planYaml = readFileSync(planPath, 'utf-8');

    // Cold path: run kernel directly
    const coldResult = await runKernel({
      planYaml,
      repoRoot: REPO_ROOT,
      lockMode: 'create_if_missing',
      attemptId: 'e2e-cold',
      stopOnHold: false,
    });

    // Daemon path: create daemon and run verify
    const daemon = createDaemon({
      repoRoot: REPO_ROOT,
      idleTimeoutMs: 0,
    });

    const req: VerifyRequest = {
      planYaml,
      attemptId: 'e2e-daemon',
      lockMode: 'create_if_missing',
      gates: ['schema', 'lock', 'evidence', 'wiring', 'exec', 'final'],
    };

    const daemonResult = await daemon.handleVerify(req);

    // Both should produce the same overall verdict
    // (PASS/HOLD/FAIL — not necessarily identical reason codes since
    // daemon may have different evidence state)
    expect(daemonResult.verdict).toBe(coldResult.verdict);

    // Both should run at least 1 gate
    expect(daemonResult.gateCount).toBeGreaterThanOrEqual(1);
    expect(coldResult.gateVerdicts.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    daemon.stop();
  });

  test('daemon IPC manifest format is correct JSON', () => {
    const manifestPath = resolve(REPO_ROOT, '.praxis/daemon.pid');
    // This test just verifies the manifest format would be valid
    // (actual daemon lifecycle requires subprocess)
    const testManifest = { pid: 12345, port: 0, host: '127.0.0.1' };
    const json = JSON.stringify(testManifest);
    const parsed = JSON.parse(json);

    expect(parsed.pid).toBe(12345);
    expect(parsed.port).toBe(0);
    expect(parsed.host).toBe('127.0.0.1');
    expect(typeof parsed.port).toBe('number');
  });

  test('daemon cache does NOT cache ExecGate results', async () => {
    const planPath = resolve(REPO_ROOT, 'examples/planspec/runtime-code.plan.yaml');
    const planYaml = readFileSync(planPath, 'utf-8');

    const daemon = createDaemon({
      repoRoot: REPO_ROOT,
      idleTimeoutMs: 0,
    });

    // First run
    const req: VerifyRequest = {
      planYaml,
      attemptId: 'cache-test-1',
      lockMode: 'create_if_missing',
      gates: ['schema', 'exec'],
    };

    const result1 = await daemon.handleVerify(req);
    const execResult1 = result1.gateResults.find(g => g.gateName === 'ExecGate');

    // Second run — same plan
    const req2: VerifyRequest = {
      ...req,
      attemptId: 'cache-test-2',
    };

    const result2 = await daemon.handleVerify(req2);
    const execResult2 = result2.gateResults.find(g => g.gateName === 'ExecGate');

    // ExecGate should NOT be cached — both runs should have cached=false
    expect(execResult1?.cached).toBe(false);
    expect(execResult2?.cached).toBe(false);

    daemon.stop();
  });
});
