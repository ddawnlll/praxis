import type { TestResult } from './types';

export function parseVitestOutput(raw: string): TestResult {
  const tests: TestResult['tests'] = [];
  let passed = 0, failed = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('✓')) {
      tests.push({ name: trimmed.replace(/^✓\s+/, '').split(/\s+\(/)[0].trim(), status: 'pass' });
      passed++;
    } else if (trimmed.startsWith('×') || trimmed.startsWith('✗')) {
      tests.push({ name: trimmed.replace(/^[×✗]\s+/, '').split(/\s+\(/)[0].trim(), status: 'fail' });
      failed++;
    }
  }

  let total = passed + failed;
  // Extract total from summary line: "Tests  3 passed (3)" or "Tests  1 passed, 1 failed (2)"
  const sumMatch = raw.match(/Tests\s+.*?\((\d+)\)/);
  if (sumMatch) {
    total = parseInt(sumMatch[1]);
    const passedMatch = raw.match(/Tests\s+(\d+)\s+passed/);
    if (passedMatch) passed = parseInt(passedMatch[1]);
  }

  return {
    framework: 'vitest', total, passed, failed, skipped: 0, tests,
    rawOutput: raw,
    parseSuccess: tests.length > 0 || total > 0,
  };
}
