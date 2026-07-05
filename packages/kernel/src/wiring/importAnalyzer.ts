// @praxis/kernel — AST Import Graph Analyzer
// TypeScript import/export analysis for WiringGate v0.2.
// Uses regex patterns (ts-morph-level accuracy deferred to v0.5).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

export interface ImportEdge {
  sourceFile: string;
  targetFile: string;
  importKind: 'named' | 'default' | 'namespace' | 'side-effect';
  symbols: string[];
}

export interface ExportSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'default';
  file: string;
  line: number;
}

export interface ImportGraphResult {
  imports: ImportEdge[];
  exports: ExportSymbol[];
  orphanFiles: string[];
  circularDependencies: string[][];
  reachabilityMap: Record<string, string[]>;
}

const IMPORT_RE = /import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"];?/g;
const EXPORT_RE = /export\s+(?:default\s+)?(?:function|class|interface|type|const|let|var|enum)\s+(\w+)/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function analyzeImports(
  sourceFiles: string[],
  repoRoot: string,
): ImportGraphResult {
  const imports: ImportEdge[] = [];
  const exports: ExportSymbol[] = [];
  const orphanFiles: string[] = [];
  const circularDependencies: string[][] = [];
  const reachabilityMap: Record<string, string[]> = {};

  const absFiles = sourceFiles.map(f => resolve(repoRoot, f));
  const fileSet = new Set(absFiles);

  for (const filePath of absFiles) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf-8');
    const relativePath = relative(repoRoot, filePath);
    const reachable: string[] = [];

    const patterns = [IMPORT_RE, DYNAMIC_IMPORT_RE];
    for (const re of patterns) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const spec = match[1];
        if (!spec.startsWith('.')) continue;
        const dir = dirname(filePath);
        const resolved = resolve(dir, spec);
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js', '']) {
          const candidate = resolved + ext;
          if (fileSet.has(candidate)) {
            const targetRel = relative(repoRoot, candidate);
            imports.push({
              sourceFile: relativePath,
              targetFile: targetRel,
              importKind: re === DYNAMIC_IMPORT_RE ? 'side-effect' : 'named',
              symbols: [],
            });
            reachable.push(targetRel);
            break;
          }
        }
      }
    }

    let expMatch: RegExpExecArray | null;
    while ((expMatch = EXPORT_RE.exec(content)) !== null) {
      const kind = expMatch[0].includes('default') ? 'default'
        : expMatch[0].includes('function') ? 'function'
        : expMatch[0].includes('class') ? 'class'
        : expMatch[0].includes('interface') ? 'interface'
        : expMatch[0].includes('type') ? 'type'
        : 'variable';
      exports.push({
        name: expMatch[1],
        kind: kind as ExportSymbol['kind'],
        file: relativePath,
        line: content.slice(0, expMatch.index).split('\n').length,
      });
    }

    reachabilityMap[relativePath] = reachable;
  }

  // Detect circular dependencies via DFS
  const visited = new Set<string>();
  const stack: string[] = [];

  const detectCycle = (file: string): void => {
    if (stack.includes(file)) {
      const cycle = stack.slice(stack.indexOf(file));
      cycle.push(file);
      circularDependencies.push(cycle);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    stack.push(file);
    for (const r of reachabilityMap[file] ?? []) detectCycle(r);
    stack.pop();
  };

  for (const file of Object.keys(reachabilityMap)) detectCycle(file);

  const importedFiles = new Set(imports.map(i => i.targetFile));
  for (const f of absFiles) {
    const rel = relative(repoRoot, f);
    if (!importedFiles.has(rel) && !imports.some(i => i.targetFile === rel)) {
      orphanFiles.push(rel);
    }
  }

  const uniqueCircles = new Set<string>();
  const deduped = circularDependencies.filter(c => {
    const key = [...c].sort().join('->');
    if (uniqueCircles.has(key)) return false;
    uniqueCircles.add(key);
    return true;
  });

  return { imports, exports, orphanFiles, circularDependencies: deduped, reachabilityMap };
}
