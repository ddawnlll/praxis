import type { TestResult } from './types';

export function parseJestOutput(raw: string): TestResult {
  const tests: TestResult['tests'] = [];
  let total = 0, passed = 0, failed = 0, skipped = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('✓')) {
      tests.push({ name: trimmed.replace(/^✓\s+/, '').split(/\s+\(/)[0].trim(), status: 'pass' });
      passed++;
    } else if (trimmed.startsWith('✕')) {
      tests.push({ name: trimmed.replace(/^✕\s+/, '').split(/\s+\(/)[0].trim(), status: 'fail' });
      failed++;
    }
  }

  total = passed + failed;
  const m = raw.match(/Tests:\s*(?:(\d+)\s+passed)?.*?(?:(\d+)\s+failed)?.*?(\d+)\s+total/);
  if (m) {
    passed = m[1] ? parseInt(m[1]) : passed;
    failed = m[2] ? parseInt(m[2]) : failed;
    total = parseInt(m[3]);
  }

  return {
    framework: 'jest', total, passed, failed, skipped, tests,
    rawOutput: raw,
    parseSuccess: tests.length > 0 || total > 0,
  };
}
