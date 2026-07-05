import type { TestResult } from './types';
import { parseVitestOutput } from './vitest';
import { parseJestOutput } from './jest';
import { parsePytestOutput } from './pytest';

export type { TestResult, TestEntry } from './types';

export function detectFramework(raw: string): 'vitest' | 'jest' | 'pytest' | 'go_test' | 'unknown' {
  if (/Test Files/i.test(raw) || (/[✓×✗]/.test(raw) && /Tests\s+\d+/.test(raw))) return 'vitest';
  if (/^(FAIL|PASS)\s/m.test(raw) || /^Tests:\s+\d+/m.test(raw)) return 'jest';
  if (/collected \d+ items/i.test(raw) || /::\w+\s+(PASSED|FAILED)/.test(raw)) return 'pytest';
  if (/^(ok|--- (PASS|FAIL))/m.test(raw)) return 'go_test';
  return 'unknown';
}

export function parseTestOutput(raw: string, framework?: string): TestResult {
  const fw = framework ?? detectFramework(raw);
  switch (fw) {
    case 'vitest': return parseVitestOutput(raw);
    case 'jest': return parseJestOutput(raw);
    case 'pytest': return parsePytestOutput(raw);
    default: return {
      framework: 'unknown',
      total: 0, passed: 0, failed: 0, skipped: 0,
      tests: [],
      rawOutput: raw,
      parseSuccess: false,
      parseError: `Unknown test framework: ${fw}. Supported: vitest, jest, pytest`,
    };
  }
}
