export interface TestResult {
  framework: 'vitest' | 'jest' | 'pytest' | 'go_test' | 'unknown';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
  tests: TestEntry[];
  rawOutput: string;
  parseSuccess: boolean;
  parseError?: string;
}

export interface TestEntry {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs?: number;
  file?: string;
  line?: number;
}
