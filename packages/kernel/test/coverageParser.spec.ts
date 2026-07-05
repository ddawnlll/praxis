import { describe, test, expect } from 'bun:test';
import { parseCoverageJson, parseCoverageFile } from '../src/coverage/coverageParser';
import { resolve } from 'node:path';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';

const SAMPLE_COVERAGE_JSON = JSON.stringify({
  '/src/app.ts': {
    s: { '0': 1, '1': 1, '2': 0, '3': 1 },
    b: { '0': [1, 0] },
    f: { '0': 1, '1': 0 },
    l: { '0': 1, '1': 1, '2': 0, '3': 1 },
    path: 'src/app.ts',
  },
  '/src/util.ts': {
    s: { '0': 1, '1': 1 },
    b: {},
    f: { '0': 1 },
    l: { '0': 1, '1': 1 },
    path: 'src/util.ts',
  },
});

describe('CoverageParser', () => {
  test('parses valid Istanbul JSON', () => {
    const result = parseCoverageJson(SAMPLE_COVERAGE_JSON);
    expect(result.parseSuccess).toBe(true);
    expect(result.files.length).toBe(2);
    expect(result.total.lines.total).toBe(6);
    expect(result.total.lines.covered).toBe(5);
    expect(result.total.functions.total).toBe(3);
    expect(result.total.functions.covered).toBe(2);
    expect(result.total.branches.total).toBe(2);
    expect(result.total.branches.covered).toBe(1);
  });

  test('parses coverage for individual files', () => {
    const result = parseCoverageJson(SAMPLE_COVERAGE_JSON);
    const appFile = result.files.find(f => f.path === 'src/app.ts');
    expect(appFile).toBeDefined();
    expect(appFile!.lines.total).toBe(4);
    expect(appFile!.lines.covered).toBe(3);
    expect(appFile!.functions.total).toBe(2);
  });

  test('returns empty result for invalid JSON', () => {
    const result = parseCoverageJson('not valid json');
    expect(result.parseSuccess).toBe(false);
    expect(result.files).toEqual([]);
  });

  test('parses coverage from file', () => {
    const tmpPath = resolve(import.meta.dir, '../.praxis-coverage-test.json');
    writeFileSync(tmpPath, SAMPLE_COVERAGE_JSON, 'utf-8');
    const result = parseCoverageFile(tmpPath);
    expect(result.parseSuccess).toBe(true);
    expect(result.rawPath).toBe(tmpPath);
    unlinkSync(tmpPath);
  });

  test('handles missing coverage file', () => {
    const result = parseCoverageFile('/nonexistent/coverage.json');
    expect(result.parseSuccess).toBe(false);
  });
});
