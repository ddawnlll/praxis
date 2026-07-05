// @praxis/kernel — Coverage Parser
// Parses Istanbul/c8 JSON coverage reports and extracts per-file metrics.

import { readFileSync, existsSync } from 'node:fs';

export interface CoverageResult {
  total: CoverageTotals;
  files: FileCoverage[];
  parseSuccess: boolean;
  rawPath?: string;
}

export interface CoverageTotals {
  lines: { total: number; covered: number; skipped: number; pct: number };
  branches: { total: number; covered: number; skipped: number; pct: number };
  functions: { total: number; covered: number; skipped: number; pct: number };
  statements: { total: number; covered: number; skipped: number; pct: number };
}

export interface FileCoverage {
  path: string;
  lines: CoverageMetrics;
  branches: CoverageMetrics;
  functions: CoverageMetrics;
}

interface CoverageMetrics {
  total: number;
  covered: number;
  pct: number;
}

interface IstanbulJson {
  [filePath: string]: {
    s?: Record<string, number>;
    b?: Record<string, number[]>;
    f?: Record<string, number>;
    l?: Record<string, number>;
    path?: string;
  };
}

export function parseCoverageJson(raw: string): CoverageResult {
  try {
    const data = JSON.parse(raw) as IstanbulJson;
    const files: FileCoverage[] = [];
    let tLines = 0, cLines = 0, tBranches = 0, cBranches = 0, tFuncs = 0, cFuncs = 0, tStmts = 0, cStmts = 0;

    for (const [filePath, fileData] of Object.entries(data)) {
      if (!fileData || typeof fileData !== 'object') continue;
      const path = fileData.path ?? filePath;

      // Lines
      const lineTotals = countMap(fileData.l ?? {});
      const lineCovered = countCovered(fileData.l ?? {});
      // Branches
      const branchTotals = countBranchTotals(fileData.b ?? {});
      const branchCovered = countBranchCovered(fileData.b ?? {});
      // Functions
      const funcTotals = countMap(fileData.f ?? {});
      const funcCovered = countCovered(fileData.f ?? {});
      // Statements
      const stmtTotals = countMap(fileData.s ?? {});
      const stmtCovered = countCovered(fileData.s ?? {});

      files.push({
        path,
        lines: { total: lineTotals, covered: lineCovered, pct: lineTotals > 0 ? round((lineCovered / lineTotals) * 100) : 0 },
        branches: { total: branchTotals, covered: branchCovered, pct: branchTotals > 0 ? round((branchCovered / branchTotals) * 100) : 0 },
        functions: { total: funcTotals, covered: funcCovered, pct: funcTotals > 0 ? round((funcCovered / funcTotals) * 100) : 0 },
      });

      tLines += lineTotals; cLines += lineCovered;
      tBranches += branchTotals; cBranches += branchCovered;
      tFuncs += funcTotals; cFuncs += funcCovered;
      tStmts += stmtTotals; cStmts += stmtCovered;
    }

    return {
      total: {
        lines: { total: tLines, covered: cLines, skipped: 0, pct: tLines > 0 ? round((cLines / tLines) * 100) : 0 },
        branches: { total: tBranches, covered: cBranches, skipped: 0, pct: tBranches > 0 ? round((cBranches / tBranches) * 100) : 0 },
        functions: { total: tFuncs, covered: cFuncs, skipped: 0, pct: tFuncs > 0 ? round((cFuncs / tFuncs) * 100) : 0 },
        statements: { total: tStmts, covered: cStmts, skipped: 0, pct: tStmts > 0 ? round((cStmts / tStmts) * 100) : 0 },
      },
      files,
      parseSuccess: true,
    };
  } catch (e) {
    return {
      total: { lines: { total: 0, covered: 0, skipped: 0, pct: 0 }, branches: { total: 0, covered: 0, skipped: 0, pct: 0 }, functions: { total: 0, covered: 0, skipped: 0, pct: 0 }, statements: { total: 0, covered: 0, skipped: 0, pct: 0 } },
      files: [],
      parseSuccess: false,
    };
  }
}

export function parseCoverageFile(filePath: string): CoverageResult {
  if (!existsSync(filePath)) return { ...emptyResult(), parseSuccess: false, rawPath: filePath };
  const raw = readFileSync(filePath, 'utf-8');
  return { ...parseCoverageJson(raw), rawPath: filePath };
}

function emptyResult(): CoverageResult {
  return {
    total: { lines: { total: 0, covered: 0, skipped: 0, pct: 0 }, branches: { total: 0, covered: 0, skipped: 0, pct: 0 }, functions: { total: 0, covered: 0, skipped: 0, pct: 0 }, statements: { total: 0, covered: 0, skipped: 0, pct: 0 } },
    files: [],
    parseSuccess: false,
  };
}

function countMap(m: Record<string, number>): number { return Object.keys(m).length; }
function countCovered(m: Record<string, number>): number { return Object.values(m).filter(v => v > 0).length; }
function countBranchTotals(b: Record<string, number[]>): number { return Object.values(b).reduce((a, arr) => a + arr.length, 0); }
function countBranchCovered(b: Record<string, number[]>): number { return Object.values(b).reduce((a, arr) => a + arr.filter(v => v > 0).length, 0); }
function round(n: number): number { return Math.round(n * 10) / 10; }
