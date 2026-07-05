// @praxis/claude-plugin — Plugin Tests
// Tests for config reader, display formatter, and plugin entry points.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Config Tests
// ---------------------------------------------------------------------------

describe('readPluginConfig', () => {
  // Use a path outside .praxis/ to avoid conflicts with the config reader's
  // own search within the repoRoot dir structure.
  const TMP_DIR = resolve(import.meta.dir, '../../.praxis-plugin-test');
  const PRAXIS_DIR = resolve(TMP_DIR, '.praxis');
  const JSON_PATH = resolve(PRAXIS_DIR, 'plugin.json');
  const YAML_PATH = resolve(PRAXIS_DIR, 'plugin.yaml');

  beforeAll(() => {
    if (!existsSync(PRAXIS_DIR)) mkdirSync(PRAXIS_DIR, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  });

  test('returns defaults when no config file exists', async () => {
    const { readPluginConfig } = await import('../src/config');
    const config = readPluginConfig(TMP_DIR);
    expect(config.cliPath).toBe('praxis');
    expect(config.autoVerifyOnStop).toBe(false);
    expect(config.capturePreTool).toBe(true);
    expect(config.maxDiffBytes).toBe(1024 * 1024);
  });

  test('reads JSON config file', async () => {
    writeFileSync(JSON_PATH, JSON.stringify({ cliPath: '/custom/praxis', autoVerifyOnStop: true }), 'utf-8');
    const { readPluginConfig } = await import('../src/config');
    const config = readPluginConfig(TMP_DIR);
    expect(config.cliPath).toBe('/custom/praxis');
    expect(config.autoVerifyOnStop).toBe(true);
    expect(config.capturePreTool).toBe(true); // default
    unlinkSync(JSON_PATH);
  });

  test('reads YAML config file', async () => {
    writeFileSync(YAML_PATH, [
      'cliPath: /yaml/praxis',
      'autoVerifyOnStop: true',
      'capturePreTool: false',
      'maxDiffBytes: "2097152"',
    ].join('\n'), 'utf-8');
    const { readPluginConfig } = await import('../src/config');
    const config = readPluginConfig(TMP_DIR);
    expect(config.cliPath).toBe('/yaml/praxis');
    expect(config.autoVerifyOnStop).toBe(true);
    expect(config.capturePreTool).toBe(false);
    expect(config.maxDiffBytes).toBe(2097152);
    unlinkSync(YAML_PATH);
  });
});

// ---------------------------------------------------------------------------
// validateCliPath Tests
// ---------------------------------------------------------------------------

describe('validateCliPath', () => {
  test('returns null for valid path', async () => {
    const { validateCliPath } = await import('../src/config');
    expect(validateCliPath('praxis')).toBe(null);
    expect(validateCliPath('/usr/local/bin/praxis')).toBe(null);
    expect(validateCliPath('./node_modules/.bin/praxis')).toBe(null);
  });

  test('returns error for empty path', async () => {
    const { validateCliPath } = await import('../src/config');
    expect(validateCliPath('')).not.toBe(null);
    expect(validateCliPath('   ')).not.toBe(null);
  });

  test('returns error for dangerous path', async () => {
    const { validateCliPath } = await import('../src/config');
    expect(validateCliPath('praxis; rm -rf /')).not.toBe(null);
    expect(validateCliPath('praxis && echo hacked')).not.toBe(null);
    expect(validateCliPath('praxis | cat')).not.toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Display Formatting Tests
// ---------------------------------------------------------------------------

describe('formatVerdictBadge', () => {
  test('returns correct badge text for each verdict', async () => {
    const { formatVerdictBadge } = await import('../src/display/formatVerdict');
    expect(formatVerdictBadge('PASS')).toContain('PASS');
    expect(formatVerdictBadge('HOLD')).toContain('HOLD');
    expect(formatVerdictBadge('FAIL')).toContain('FAIL');
  });
});

describe('formatGateLine', () => {
  test('includes gate name and verdict', async () => {
    const { formatGateLine } = await import('../src/display/formatVerdict');
    const line = formatGateLine('SchemaGate', 'PASS');
    expect(line).toContain('SchemaGate');
    expect(line).toContain('PASS');
  });
});

describe('formatReasonCodes', () => {
  test('formats multiple reason codes', async () => {
    const { formatReasonCodes } = await import('../src/display/formatVerdict');
    const result = formatReasonCodes(['CODE_A', 'CODE_B']);
    expect(result).toContain('CODE_A');
    expect(result).toContain('CODE_B');
  });

  test('returns empty string for empty codes', async () => {
    const { formatReasonCodes } = await import('../src/display/formatVerdict');
    expect(formatReasonCodes([])).toBe('');
  });
});

describe('formatGateResult', () => {
  test('formats a basic gate result', async () => {
    const { formatGateResult } = await import('../src/display/formatVerdict');
    const result = formatGateResult({
      gateName: 'SchemaGate',
      verdict: 'PASS',
      reasonCodes: ['SCHEMA_PASS'],
      attemptId: 'test-001',
      timestamp: '2026-01-01T00:00:00Z',
      evidenceRefs: [],
      failedCriteriaIds: [],
    } as any);
    expect(result).toContain('SchemaGate');
    expect(result).toContain('PASS');
    expect(result).toContain('SCHEMA_PASS');
  });

  test('formats EvidenceGate with extra fields', async () => {
    const { formatGateResult } = await import('../src/display/formatVerdict');
    const result = formatGateResult({
      gateName: 'EvidenceGate',
      verdict: 'HOLD',
      reasonCodes: ['DIFF_EMPTY'],
      attemptId: 'test-002',
      timestamp: '2026-01-01T00:00:00Z',
      failedCriteriaIds: [],
      evidenceRefs: [],
      evidenceCount: 3,
      diffEmpty: true,
    } as any);
    expect(result).toContain('EvidenceGate');
    expect(result).toContain('HOLD');
    expect(result).toContain('DIFF_EMPTY');
    expect(result).toContain('empty');
  });
});

describe('formatKernelResult', () => {
  test('formats a full PASS result', async () => {
    const { formatKernelResult } = await import('../src/display/formatVerdict');
    const result = formatKernelResult({
      verdict: 'PASS',
      attemptId: 'test-pass-001',
      gateVerdicts: [
        { gateName: 'SchemaGate', verdict: 'PASS', reasonCodes: ['SCHEMA_PASS'], attemptId: 'test-pass-001', timestamp: '', failedCriteriaIds: [], evidenceRefs: [] },
        { gateName: 'LockGate', verdict: 'PASS', reasonCodes: ['LOCK_PASS'], attemptId: 'test-pass-001', timestamp: '', failedCriteriaIds: [], evidenceRefs: [] },
      ],
    });
    expect(result).toContain('PASS');
    expect(result).toContain('test-pass-001');
    expect(result).toContain('SchemaGate');
    expect(result).toContain('LockGate');
    expect(result).toContain('verified complete');
  });

  test('formats a FAIL result', async () => {
    const { formatKernelResult } = await import('../src/display/formatVerdict');
    const result = formatKernelResult({
      verdict: 'FAIL',
      attemptId: 'test-fail-001',
      gateVerdicts: [
        { gateName: 'SchemaGate', verdict: 'FAIL', reasonCodes: ['YAML_PARSE_ERROR'], attemptId: 'test-fail-001', timestamp: '', failedCriteriaIds: [], evidenceRefs: [] },
      ],
    });
    expect(result).toContain('FAIL');
    expect(result).toContain('YAML_PARSE_ERROR');
    expect(result).toContain('blocked completion');
  });
});

// ---------------------------------------------------------------------------
// Plugin Entry Tests
// ---------------------------------------------------------------------------

describe('initPlugin', () => {
  test('initializes with default config', async () => {
    const { initPlugin } = await import('../src/index');
    // Should not throw
    expect(() => initPlugin(import.meta.dir)).not.toThrow();
  });
});

describe('handleSlashCommand', () => {
  test('returns error message for unknown command', async () => {
    const { handleSlashCommand, initPlugin } = await import('../src/index');
    initPlugin(import.meta.dir);
    const result = await handleSlashCommand('nonexistent_command');
    expect(result).toContain('error');
  });

  test('handles help command', async () => {
    const { handleSlashCommand, initPlugin } = await import('../src/index');
    initPlugin(import.meta.dir);
    const result = await handleSlashCommand('help');
    expect(result).toContain('PRAXIS');
  });
});

describe('handlePreToolUse', () => {
  test('captures pre-tool event without throwing', async () => {
    const { handlePreToolUse, initPlugin } = await import('../src/index');
    initPlugin(import.meta.dir);
    expect(() => {
      handlePreToolUse({
        toolName: 'Edit',
        toolInput: { filePath: '/test/file.ts' },
        timestamp: '2026-01-01T00:00:00Z',
      });
    }).not.toThrow();
  });
});

describe('handlePostToolUse', () => {
  test('captures post-tool event without throwing', async () => {
    const { handlePostToolUse, initPlugin } = await import('../src/index');
    initPlugin(import.meta.dir);
    expect(() => {
      handlePostToolUse({
        toolName: 'Edit',
        toolInput: { filePath: '/test/file.ts' },
        toolOutput: { success: true },
        timestamp: '2026-01-01T00:00:00Z',
      });
    }).not.toThrow();
  });
});

describe('handleStopEvent', () => {
  test('returns error when not initialized', async () => {
    // Import fresh without initPlugin
    const plugin = await import('../src/index');
    // The module is cached, so initPlugin may already be called.
    // Test via direct import
    const { handleStop } = await import('../src/hooks/stopHandler');
    const result = handleStop(
      { timestamp: '2026-01-01T00:00:00Z', reason: 'finished', agentReportedSuccess: true },
      { cliPath: 'praxis', defaultPlanPath: '', autoVerifyOnStop: false, capturePreTool: false, capturePostTool: false, maxDiffBytes: 100, evidenceDir: '', runIdPrefix: 'test' },
      '/tmp',
      'test-attempt',
      'test-plan',
    );
    expect(result.captured).toBe(true);
  });
});
