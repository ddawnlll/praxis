// @praxis/cli — CLI Integration Tests
// Tests CLI commands by spawning the CLI as a subprocess via bun.
// Follows the pattern of running `bun run src/cli.ts <command>` and checking output.

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { $ } from 'bun';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync, readFileSync } from 'node:fs';

const CLI_SRC = resolve(import.meta.dir, '../src/cli.ts');
const REPO_ROOT = resolve(import.meta.dir, '../../..');
const TMP_DIR = resolve(REPO_ROOT, '.praxis/tmp-cli-test');

function tmpPath(name: string): string {
  return resolve(TMP_DIR, name);
}

function cleanTmp() {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

function ensureTmp() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await $`bun run ${CLI_SRC} ${args}`.cwd(REPO_ROOT).quiet();
    return {
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
      exitCode: result.exitCode,
    };
  } catch (err: any) {
    // Bun throws on non-zero exit
    const stdout = err.stdout?.toString().trim() ?? '';
    const stderr = err.stderr?.toString().trim() ?? '';
    const exitCode = err.exitCode ?? 3;
    return { stdout, stderr, exitCode };
  }
}

beforeAll(() => {
  ensureTmp();
});

afterAll(() => {
  cleanTmp();
});

describe('CLI — help and version', () => {
  test('help shows usage info', async () => {
    const { stdout, exitCode } = await runCli('help');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PRAXIS CLI');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('init');
    expect(stdout).toContain('verify');
    expect(stdout).toContain('plan validate');
  });

  test('help via --help flag', async () => {
    const { stdout, exitCode } = await runCli('--help');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PRAXIS CLI');
  });

  test('no args shows help', async () => {
    const { stdout, exitCode } = await runCli();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PRAXIS CLI');
  });

  test('version shows version string', async () => {
    const { stdout, exitCode } = await runCli('version');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('praxis 0.1.0');
  });
});

describe('CLI — init', () => {
  const planPath = tmpPath('test-plan.yaml');

  afterEach(() => {
    try { unlinkSync(planPath); } catch {}
  });

  test('creates a new plan file', async () => {
    const { stdout, exitCode } = await runCli('init', '--plan', planPath);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Plan initialized');
    expect(existsSync(planPath)).toBe(true);
  });

  test('refuses to overwrite existing plan', async () => {
    ensureTmp();
    writeFileSync(planPath, 'existing', 'utf-8');
    const { stdout, exitCode } = await runCli('init', '--plan', planPath);
    expect(exitCode).toBe(3);
    expect(stdout).toContain('already exists');
  });
});

describe('CLI — plan validate', () => {
  test('validates a valid plan file', async () => {
    const planPath = resolve(REPO_ROOT, 'examples/planspec/runtime-code.plan.yaml');
    const { stdout, exitCode } = await runCli('plan', 'validate', '--plan', planPath);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PASS');
  });

  test('fails on non-existent plan file', async () => {
    const { stdout, exitCode } = await runCli('plan', 'validate', '--plan', '/nonexistent/plan.yaml');
    expect(exitCode).toBe(3);
    expect(stdout).toContain('not found');
  });
});

describe('CLI — plan lock', () => {
  const lockPlanPath = tmpPath('lock-test-plan.yaml');
  const lockPath = resolve(REPO_ROOT, '.praxis/locks/test-cli.lock.yaml');

  beforeAll(() => {
    ensureTmp();
    // Copy a valid plan for locking
    const srcPlan = resolve(REPO_ROOT, 'examples/planspec/runtime-code.plan.yaml');
    const content = readFileSync(srcPlan, 'utf-8');
    writeFileSync(lockPlanPath, content, 'utf-8');
  });

  afterAll(() => {
    try { unlinkSync(lockPlanPath); } catch {}
    try { unlinkSync(lockPath); } catch {}
  });

  test('locks a valid plan', async () => {
    const { stdout, exitCode } = await runCli('plan', 'lock', '--plan', lockPlanPath);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PASS');
  });
});

describe('CLI — status', () => {
  test('shows no runs status when no runs exist', async () => {
    const { stdout, exitCode } = await runCli('status');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('NO_RUNS');
  });

  test('shows run status with run-id', async () => {
    const { stdout, exitCode } = await runCli('status', '--run-id', 'nonexistent');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Run nonexistent');
    expect(stdout).toContain('No verdict file found');
  });
});
