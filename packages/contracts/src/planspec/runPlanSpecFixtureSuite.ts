// @praxis/contracts — Fixture Runner
// Validates all example and fixture PlanSpec files and returns a suite result.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { validatePlanSpec } from './validatePlanSpec';

export interface FixtureResult {
  /** Relative path to the fixture file. */
  path: string;
  /** Whether validation passed (ok=true). */
  passed: boolean;
  /** Whether this fixture was expected to pass. */
  expectedPass: boolean;
  /** Whether the observed result matches expectation. */
  match: boolean;
  /** Number of errors in validation. */
  errorCount: number;
  /** Number of warnings in validation. */
  warningCount: number;
  /** Error messages (truncated). */
  errors: string[];
}

export interface FixtureSuiteResult {
  /** True if all fixtures behaved as expected. */
  ok: boolean;
  /** Total fixtures processed. */
  total: number;
  /** Number that passed validation. */
  passed: number;
  /** Number that failed validation. */
  failed: number;
  /** Individual results. */
  results: FixtureResult[];
}

interface FixtureEntry {
  path: string;
  expectedPass: boolean;
}

/**
 * Run the full fixture suite.
 *
 * @param repoRoot — path to repo root containing examples/ and fixtures/ directories.
 */
export function runPlanSpecFixtureSuite(repoRoot?: string): FixtureSuiteResult {
  const root = repoRoot ?? process.cwd();

  // Collect all fixture entries
  const entries: FixtureEntry[] = [];

  // Examples — all should pass
  const examplesDir = resolve(root, 'examples', 'planspec');
  for (const f of listYamlFiles(examplesDir)) {
    entries.push({ path: f, expectedPass: true });
  }

  // PASS fixtures — should pass
  const passDir = resolve(root, 'fixtures', 'planspec', 'pass');
  for (const f of listYamlFiles(passDir)) {
    entries.push({ path: f, expectedPass: true });
  }

  // HOLD fixtures — should NOT pass (schema or semantic error expected)
  const holdDir = resolve(root, 'fixtures', 'planspec', 'hold');
  for (const f of listYamlFiles(holdDir)) {
    entries.push({ path: f, expectedPass: false });
  }

  // FAIL fixtures — should NOT pass
  const failDir = resolve(root, 'fixtures', 'planspec', 'fail');
  for (const f of listYamlFiles(failDir)) {
    entries.push({ path: f, expectedPass: false });
  }

  // Run validation for each
  const results: FixtureResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const entry of entries) {
    let raw: string;
    let validationResult: ReturnType<typeof validatePlanSpec>;

    try {
      raw = readFileSync(entry.path, 'utf-8');
    } catch (e) {
      results.push({
        path: relative(root, entry.path),
        passed: false,
        expectedPass: entry.expectedPass,
        match: !entry.expectedPass, // Expected fail, got fail = match
        errorCount: 1,
        warningCount: 0,
        errors: [`Failed to read: ${e instanceof Error ? e.message : String(e)}`],
      });
      totalFailed++;
      continue;
    }

    validationResult = validatePlanSpec(raw, root);

    const passed = validationResult.ok;
    const match = passed === entry.expectedPass;

    if (passed) totalPassed++;
    else totalFailed++;

    results.push({
      path: relative(root, entry.path),
      passed,
      expectedPass: entry.expectedPass,
      match,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length,
      errors: validationResult.errors.map(e => e.message).slice(0, 5),
    });
  }

  const allMatch = results.every(r => r.match);

  return {
    ok: allMatch,
    total: results.length,
    passed: totalPassed,
    failed: totalFailed,
    results,
  };
}

/** List all .yaml and .yml files in a directory (non-recursive). */
function listYamlFiles(dir: string): string[] {
  try {
    const files = readdirSync(dir);
    return files
      .filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f: string) => resolve(dir, f))
      .filter((f: string) => {
        try {
          return statSync(f).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}
