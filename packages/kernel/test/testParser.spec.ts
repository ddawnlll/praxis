// @praxis/kernel — TestOutputParser Tests

import { describe, test, expect } from 'bun:test';
import { parseVitestOutput } from '../src/test-parser/vitest';
import { parseJestOutput } from '../src/test-parser/jest';
import { parsePytestOutput } from '../src/test-parser/pytest';
import { detectFramework, parseTestOutput } from '../src/test-parser/index';

describe('parseVitestOutput', () => {
  test('parses vitest pass output', () => {
    const output = ` ✓ src/feature.test.ts (1 test) 2ms
 ✓ src/util.test.ts (2 tests) 5ms
Test Files  2 passed (2)
     Tests  3 passed (3)`;
    const result = parseVitestOutput(output);
    expect(result.parseSuccess).toBe(true);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.tests.length).toBeGreaterThanOrEqual(2);
  });

  test('parses vitest with failures', () => {
    const output = ` ✓ src/pass.test.ts (1 test) 2ms
 × src/fail.test.ts (1 test) 3ms
Test Files  1 passed, 1 failed (2)
     Tests  1 passed, 1 failed (2)`;
    const result = parseVitestOutput(output);
    expect(result.total).toBe(2);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.tests.length).toBeGreaterThanOrEqual(2);
  });

  test('returns error for empty input', () => {
    const result = parseVitestOutput('');
    expect(result.parseSuccess).toBe(false);
    expect(result.total).toBe(0);
  });
});

describe('parseJestOutput', () => {
  test('parses jest pass output', () => {
    const output = ` PASS  test/file.test.ts
  ✓ works correctly (2 ms)
  ✓ handles edge case (1 ms)
Tests:       2 passed, 2 total`;
    const result = parseJestOutput(output);
    expect(result.parseSuccess).toBe(true);
    expect(result.passed).toBe(2);
    expect(result.tests.length).toBe(2);
  });

  test('parses jest with failures', () => {
    const output = ` FAIL  test/bad.test.ts
  ✕ should not fail (3 ms)
Tests:       1 failed, 1 total`;
    const result = parseJestOutput(output);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});

describe('parsePytestOutput', () => {
  test('parses pytest pass output', () => {
    const output = `collected 2 items
test_file.py::test_one PASSED
test_file.py::test_two PASSED
2 passed in 0.05s`;
    const result = parsePytestOutput(output);
    expect(result.parseSuccess).toBe(true);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.durationMs).toBe(50);
  });

  test('parses pytest with failures', () => {
    const output = `collected 2 items
test_file.py::test_one PASSED
test_file.py::test_bad FAILED
1 passed, 1 failed in 0.12s`;
    const result = parsePytestOutput(output);
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(1);
  });
});

describe('detectFramework', () => {
  test('detects vitest from output', () => {
    expect(detectFramework('Test Files  1 passed (1)')).toBe('vitest');
  });
  test('detects jest from output', () => {
    expect(detectFramework('Tests:       2 passed, 2 total')).toBe('jest');
  });
  test('detects pytest from output', () => {
    expect(detectFramework('collected 3 items')).toBe('pytest');
  });
  test('returns unknown for garbage', () => {
    expect(detectFramework('')).toBe('unknown');
  });
});

describe('parseTestOutput', () => {
  test('auto-detects and parses vitest', () => {
    const result = parseTestOutput(' ✓ test.ts (1 test) 2ms\nTests  1 passed (1)');
    expect(result.framework).toBe('vitest');
  });
  test('uses explicit framework override', () => {
    const result = parseTestOutput('garbage', 'vitest');
    expect(result.framework).toBe('vitest');
  });
  test('returns unknown for unrecognized output', () => {
    const result = parseTestOutput('some random output');
    expect(result.parseSuccess).toBe(false);
    expect(result.parseError).toContain('unknown');
  });
});
