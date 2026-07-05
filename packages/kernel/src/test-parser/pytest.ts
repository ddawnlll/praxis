// @praxis/kernel — Pytest output parser

import type { TestResult, TestEntry } from './types';

const PYTEST_PASS = /(.+?)::(.+?)\s+PASSED/;
const PYTEST_FAIL = /(.+?)::(.+?)\s+FAILED/;
const PYTEST_SKIP = /(.+?)::(.+?)\s+SKIPPED/;
const PYTEST_SUMMARY = /(?:(\d+)\s+passed)?.*?(?:(\d+)\s+failed)?.*?in\s+([\d.]+)s/;

export function parsePytestOutput(raw: string): TestResult {
  const tests: TestEntry[] = [];
  let total = 0, passed = 0, failed = 0, skipped = 0;

  const lines = raw.split('\n');
  for (const line of lines) {
    const passMatch = line.match(PYTEST_PASS);
    if (passMatch) {
      tests.push({ name: passMatch[2].trim(), status: 'pass', file: passMatch[1].trim() });
      passed++; total++;
      continue;
    }
    const failMatch = line.match(PYTEST_FAIL);
    if (failMatch) {
      tests.push({ name: failMatch[2].trim(), status: 'fail', file: failMatch[1].trim() });
      failed++; total++;
      continue;
    }
    const skipMatch = line.match(PYTEST_SKIP);
    if (skipMatch) {
      tests.push({ name: skipMatch[2].trim(), status: 'skip', file: skipMatch[1].trim() });
      skipped++; total++;
    }
  }

  const summaryMatch = raw.match(PYTEST_SUMMARY);
  if (!summaryMatch) {
    return {
      framework: 'pytest',
      total, passed, failed, skipped, tests,
      rawOutput: raw,
      parseSuccess: false,
      parseError: 'No pytest summary line found',
    };
  }

  if (summaryMatch[1]) passed = parseInt(summaryMatch[1]);
  if (summaryMatch[2]) failed = parseInt(summaryMatch[2]);
  const durationMs = summaryMatch[3] ? Math.round(parseFloat(summaryMatch[3]) * 1000) : undefined;

  return {
    framework: 'pytest',
    total: passed + failed + skipped,
    passed,
    failed,
    skipped,
    durationMs,
    tests,
    rawOutput: raw,
    parseSuccess: true,
  };
}
