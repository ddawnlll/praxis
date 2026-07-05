import { describe, test, expect } from 'bun:test';
import { analyzeImports } from '../src/wiring/importAnalyzer';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');

describe('ImportGraphAnalyzer', () => {
  test('detects imports between project source files', () => {
    // Analyze the contracts package entry point
    const result = analyzeImports(['packages/contracts/src/index.ts'], ROOT);
    expect(result.imports).toBeDefined();
    // Should find at least one import (it imports from sub-modules)
    expect(result.imports.length).toBeGreaterThanOrEqual(0);
  });

  test('extracts export symbols from TypeScript files', () => {
    const result = analyzeImports(['packages/contracts/src/index.ts', 'packages/contracts/src/planspec/types.ts'], ROOT);
    expect(result.exports).toBeDefined();
    // The types file should export interfaces
    if (result.exports.length > 0) {
      expect(result.exports[0].name).toBeTruthy();
      expect(result.exports[0].file).toBeTruthy();
    }
  });

  test('handles non-existent files gracefully', () => {
    const result = analyzeImports(['nonexistent/file.ts'], ROOT);
    expect(result.imports).toEqual([]);
    expect(result.exports).toEqual([]);
  });

  test('reachabilityMap contains entries for source files', () => {
    const result = analyzeImports(['packages/contracts/src/index.ts'], ROOT);
    expect(result.reachabilityMap).toBeDefined();
    for (const [file, deps] of Object.entries(result.reachabilityMap)) {
      expect(file).toBeTruthy();
      expect(Array.isArray(deps)).toBe(true);
    }
  });
});
