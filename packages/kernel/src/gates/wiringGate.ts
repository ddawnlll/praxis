// @praxis/kernel — WiringGate
// Fourth gate in the PRAXIS Truth Kernel pipeline.
// Verifies that declared artifacts exist at their declared paths
// and that export surfaces are present (RegExp pattern matching only, NO AST).
// Read-only gate — no file system mutations.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, IntegrationContract, DeclaredUnit, ExportSurface, Entrypoint, IntegrationPoint } from '@praxis/contracts';
import type {
  WiringGateInput,
  WiringGateResult,
  DeclaredUnitResult,
  ExportSurfaceResult,
  EntrypointResult,
  IntegrationPointResult,
} from '../wiring/types';
import { WIRING_REASON_CODES } from '../diagnostics';

// ---------------------------------------------------------------------------
// RegExp helpers — v0.1 static pattern matching, no AST
// ---------------------------------------------------------------------------

/**
 * Escape special regex characters in a string so it can be used as a
 * literal match inside a regex.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a combined RegExp that matches a named export in TypeScript/JavaScript source.
 *
 * Handles:
 *   export function NAME        export async function NAME
 *   export const NAME            export let NAME            export var NAME
 *   export class NAME            export default function NAME
 *   export default class NAME    export default NAME
 *   export type NAME             export interface NAME
 *   export { NAME }              export { NAME as ALIAS }
 *   export * as NAME
 *   export const { NAME } ...    (destructure)
 */
function buildExportRegex(exportName: string): RegExp {
  const e = escapeRegex(exportName);
  // Branch alternation — any match counts
  const pattern =
    // Direct declaration: export [async] [keyword] NAME
    `export\\s+(?:async\\s+)?(?:function|const|class|default|type|interface|let|var)\\s+${e}\\b` +
    // Named export in braces: export { ..., NAME, ... }
    `|export\\s*\\{[^}]*\\b${e}\\b[^}]*\\}` +
    // Namespace re-export: export * as NAME
    `|export\\s*\\*\\s+as\\s+${e}\\b` +
    // Destructure const export: export const { ..., NAME, ... }
    `|export\\s+const\\s*\\{[^}]*\\b${e}\\b[^}]*\\}`;
  return new RegExp(pattern, 'm');
}

/**
 * Build a combined RegExp that matches a named import in TypeScript/JavaScript source.
 *
 * Handles:
 *   import { NAME } from ...     import { NAME as ALIAS } from ...
 *   import NAME from ...         import * as NAME from ...
 *   import(...) with NAME in path
 */
function buildImportRegex(importName: string): RegExp {
  const e = escapeRegex(importName);
  const pattern =
    // Named import: import { ..., NAME, ... } from
    `import\\s*\\{[^}]*\\b${e}\\b[^}]*\\}\\s*from` +
    // Default import: import NAME from
    `|import\\s+${e}\\s+from` +
    // Namespace import: import * as NAME from
    `|import\\s*\\*\\s*as\\s+${e}\\s+from` +
    // Dynamic import: import('...NAME...')
    `|import\\([^)]*\\b${e}\\b[^)]*\\)`;
  return new RegExp(pattern, 'm');
}

/**
 * Test whether `exportName` appears as an export in `content` (RegExp match only).
 */
function matchExportInContent(exportName: string, content: string): boolean {
  return buildExportRegex(exportName).test(content);
}

/**
 * Test whether `importName` appears as an import in `content` (RegExp match only).
 */
function matchImportInContent(importName: string, content: string): boolean {
  return buildImportRegex(importName).test(content);
}

// ---------------------------------------------------------------------------
// Gate entry point
// ---------------------------------------------------------------------------

/**
 * Run WiringGate — static file-matching wiring verification.
 *
 * Checks (in order):
 * 1. DeclaredUnit: file exists (FAIL if missing), expectedExports via RegExp (HOLD if missing)
 * 2. ExportSurface: file exists (FAIL if missing), requiredExports via RegExp (HOLD if missing)
 * 3. Entrypoint: file exists (HOLD if not)
 * 4. IntegrationPoint: file exists (HOLD if not), expectedImports via RegExp (HOLD if missing)
 * 5. Orphan modules: files in allowedFiles not in any declaredUnit.path → HOLD
 * 6. Wiring mode consistency: mode=none with declaredUnits → HOLD;
 *    mode=required/consumer_or_export with no declarations → HOLD
 */
export function runWiringGate(input: WiringGateInput): WiringGateResult {
  const { plan, hashes, attemptId, repoRoot, evidenceRecords, lock } = input;
  const timestamp = new Date().toISOString();

  const reasonCodes: string[] = [];
  const allDiagnostics: Diagnostic[] = [];

  // --- Per-check detail accumulators ---
  const declaredUnitResults: DeclaredUnitResult[] = [];
  const exportSurfaceResults: ExportSurfaceResult[] = [];
  const entrypointResults: EntrypointResult[] = [];
  const integrationPointResults: IntegrationPointResult[] = [];
  const exportsMissing: string[] = [];
  const entrypointsMissing: string[] = [];
  const integrationPointsMissing: string[] = [];
  const orphanModules: string[] = [];

  let declaredUnitsChecked = 0;
  let declaredUnitsMatched = 0;
  let modeInconsistent = false;

  // --- Iterate all tasks ---
  for (const task of plan.tasks) {
    const ic = task.integrationContract;

    // --- Skip tasks without integrationContract — nothing to wire-check ---
    if (!ic) continue;

    // ==================================================================
    // Check 1: DeclaredUnit verification
    // ==================================================================
    if (ic.declaredUnits && ic.declaredUnits.length > 0) {
      for (const du of ic.declaredUnits) {
        declaredUnitsChecked++;
        const resolvedPath = resolve(repoRoot, du.path);

        const duResult: DeclaredUnitResult = {
          unitId: du.id,
          path: du.path,
          exists: false,
          expectedExports: du.expectedExports ?? [],
          matchedExports: [],
          missingExports: [],
        };

        // --- File existence ---
        if (!existsSync(resolvedPath)) {
          reasonCodes.push(WIRING_REASON_CODES.DECLARED_UNIT_MISSING);
          allDiagnostics.push({
            code: 'DECLARED_UNIT_MISSING',
            severity: 'error',
            message: `Declared unit "${du.id}" not found at path: ${du.path}`,
          });
          declaredUnitResults.push(duResult);
          continue;
        }

        duResult.exists = true;

        // --- Export pattern matching ---
        if (du.expectedExports && du.expectedExports.length > 0) {
          let fileContent: string;
          try {
            fileContent = readFileSync(resolvedPath, 'utf-8');
          } catch (readErr) {
            const msg = readErr instanceof Error ? readErr.message : String(readErr);
            // Cannot read file — treat all exports as missing
            for (const exp of du.expectedExports) {
              duResult.missingExports.push(exp);
              exportsMissing.push(`${du.id}:${exp}`);
            }
            reasonCodes.push(WIRING_REASON_CODES.EXPORT_NOT_FOUND);
            allDiagnostics.push({
              code: 'EXPORT_NOT_FOUND',
              severity: 'warning',
              message: `Cannot read declared unit "${du.path}" to check exports: ${msg}`,
            });
            declaredUnitResults.push(duResult);
            continue;
          }

          for (const exp of du.expectedExports) {
            if (matchExportInContent(exp, fileContent)) {
              duResult.matchedExports.push(exp);
            } else {
              duResult.missingExports.push(exp);
              exportsMissing.push(`${du.id}:${exp}`);
            }
          }

          if (duResult.missingExports.length > 0) {
            reasonCodes.push(WIRING_REASON_CODES.EXPORT_NOT_FOUND);
            allDiagnostics.push({
              code: 'EXPORT_NOT_FOUND',
              severity: 'warning',
              message: `Expected export(s) not found in "${du.path}" (unit "${du.id}"): ${duResult.missingExports.join(', ')}`,
            });
          }
        }

        // Unit matched if it exists AND all expectedExports were matched
        if (duResult.missingExports.length === 0) {
          declaredUnitsMatched++;
        }

        declaredUnitResults.push(duResult);
      }
    }

    // ==================================================================
    // Check 2: ExportSurface verification
    // ==================================================================
    if (ic.exportSurfaces && ic.exportSurfaces.length > 0) {
      for (const es of ic.exportSurfaces) {
        const resolvedPath = resolve(repoRoot, es.path);

        const esResult: ExportSurfaceResult = {
          surfaceId: es.id,
          path: es.path,
          exists: false,
          requiredExports: es.requiredExports,
          matchedExports: [],
          missingExports: [],
        };

        // --- File existence ---
        if (!existsSync(resolvedPath)) {
          reasonCodes.push(WIRING_REASON_CODES.EXPORT_SURFACE_MISSING);
          allDiagnostics.push({
            code: 'EXPORT_SURFACE_MISSING',
            severity: 'error',
            message: `Export surface "${es.id}" not found at path: ${es.path}`,
          });
          exportSurfaceResults.push(esResult);
          continue;
        }

        esResult.exists = true;

        // --- Export pattern matching ---
        let fileContent: string;
        try {
          fileContent = readFileSync(resolvedPath, 'utf-8');
        } catch (readErr) {
          const msg = readErr instanceof Error ? readErr.message : String(readErr);
          for (const exp of es.requiredExports) {
            esResult.missingExports.push(exp);
            exportsMissing.push(`${es.id}:${exp}`);
          }
          reasonCodes.push(WIRING_REASON_CODES.REQUIRED_EXPORT_MISSING);
          allDiagnostics.push({
            code: 'REQUIRED_EXPORT_MISSING',
            severity: 'warning',
            message: `Cannot read export surface "${es.path}" to check exports: ${msg}`,
          });
          exportSurfaceResults.push(esResult);
          continue;
        }

        for (const exp of es.requiredExports) {
          if (matchExportInContent(exp, fileContent)) {
            esResult.matchedExports.push(exp);
          } else {
            esResult.missingExports.push(exp);
            exportsMissing.push(`${es.id}:${exp}`);
          }
        }

        if (esResult.missingExports.length > 0) {
          reasonCodes.push(WIRING_REASON_CODES.REQUIRED_EXPORT_MISSING);
          allDiagnostics.push({
            code: 'REQUIRED_EXPORT_MISSING',
            severity: 'warning',
            message: `Required export(s) not found in export surface "${es.path}" (surface "${es.id}"): ${esResult.missingExports.join(', ')}`,
          });
        }

        exportSurfaceResults.push(esResult);
      }
    }

    // ==================================================================
    // Check 3: Entrypoint verification
    // ==================================================================
    if (ic.entrypoints && ic.entrypoints.length > 0) {
      for (const ep of ic.entrypoints) {
        const resolvedPath = resolve(repoRoot, ep.path);

        const epResult: EntrypointResult = {
          entrypointId: ep.id,
          path: ep.path,
          exists: false,
        };

        if (!existsSync(resolvedPath)) {
          entrypointsMissing.push(ep.id);
          reasonCodes.push(WIRING_REASON_CODES.ENTRYPOINT_NOT_FOUND);
          allDiagnostics.push({
            code: 'ENTRYPOINT_NOT_FOUND',
            severity: 'warning',
            message: `Entrypoint "${ep.id}" not found at path: ${ep.path}`,
          });
        } else {
          epResult.exists = true;
        }

        entrypointResults.push(epResult);
      }
    }

    // ==================================================================
    // Check 4: IntegrationPoint verification
    // ==================================================================
    if (ic.integrationPoints && ic.integrationPoints.length > 0) {
      for (const ip of ic.integrationPoints) {
        const resolvedPath = resolve(repoRoot, ip.path);

        const ipResult: IntegrationPointResult = {
          pointId: ip.id,
          path: ip.path,
          exists: false,
          expectedImports: ip.expectedImports ?? [],
          matchedImports: [],
          missingImports: [],
        };

        // --- File existence ---
        if (!existsSync(resolvedPath)) {
          integrationPointsMissing.push(ip.id);
          reasonCodes.push(WIRING_REASON_CODES.INTEGRATION_POINT_NOT_FOUND);
          allDiagnostics.push({
            code: 'INTEGRATION_POINT_NOT_FOUND',
            severity: 'warning',
            message: `Integration point "${ip.id}" not found at path: ${ip.path}`,
          });
          integrationPointResults.push(ipResult);
          continue;
        }

        ipResult.exists = true;

        // --- Import pattern matching ---
        if (ip.expectedImports && ip.expectedImports.length > 0) {
          let fileContent: string;
          try {
            fileContent = readFileSync(resolvedPath, 'utf-8');
          } catch (readErr) {
            const msg = readErr instanceof Error ? readErr.message : String(readErr);
            for (const imp of ip.expectedImports) {
              ipResult.missingImports.push(imp);
            }
            reasonCodes.push(WIRING_REASON_CODES.EXPECTED_IMPORT_MISSING);
            allDiagnostics.push({
              code: 'EXPECTED_IMPORT_MISSING',
              severity: 'warning',
              message: `Cannot read integration point "${ip.path}" to check imports: ${msg}`,
            });
            integrationPointResults.push(ipResult);
            continue;
          }

          for (const imp of ip.expectedImports) {
            if (matchImportInContent(imp, fileContent)) {
              ipResult.matchedImports.push(imp);
            } else {
              ipResult.missingImports.push(imp);
            }
          }

          if (ipResult.missingImports.length > 0) {
            reasonCodes.push(WIRING_REASON_CODES.EXPECTED_IMPORT_MISSING);
            allDiagnostics.push({
              code: 'EXPECTED_IMPORT_MISSING',
              severity: 'warning',
              message: `Expected import(s) not found in "${ip.path}" (point "${ip.id}"): ${ipResult.missingImports.join(', ')}`,
            });
          }
        }

        integrationPointResults.push(ipResult);
      }
    }

    // ==================================================================
    // Check 6: Wiring mode consistency
    // ==================================================================
    if (ic.mode === 'none') {
      if (ic.declaredUnits && ic.declaredUnits.length > 0) {
        modeInconsistent = true;
        reasonCodes.push(WIRING_REASON_CODES.WIRING_MODE_INCONSISTENT);
        allDiagnostics.push({
          code: 'WIRING_MODE_INCONSISTENT',
          severity: 'warning',
          message: `Task "${task.id}": integrationContract.mode is "none" but declaredUnits is non-empty (${ic.declaredUnits.length} unit(s)). Either remove declaredUnits or change mode.`,
        });
      }
    }

    if (ic.mode === 'required' || ic.mode === 'consumer_or_export') {
      const hasDeclarations =
        (ic.declaredUnits && ic.declaredUnits.length > 0) ||
        (ic.integrationPoints && ic.integrationPoints.length > 0) ||
        (ic.exportSurfaces && ic.exportSurfaces.length > 0);

      if (!hasDeclarations) {
        modeInconsistent = true;
        reasonCodes.push(WIRING_REASON_CODES.WIRING_MODE_DECLARED_BUT_EMPTY);
        allDiagnostics.push({
          code: 'WIRING_MODE_DECLARED_BUT_EMPTY',
          severity: 'warning',
          message: `Task "${task.id}": integrationContract.mode is "${ic.mode}" which requires at least one declaredUnit, integrationPoint, or exportSurface, but none were found.`,
        });
      }
    }

    // ==================================================================
    // Check 5: Orphan module detection (per-task)
    // ==================================================================
    const allowedFiles = task.implementation.allowedFiles ?? [];
    if (allowedFiles.length > 0) {
      const declaredPaths = new Set(
        (ic.declaredUnits ?? []).map(u => u.path),
      );
      // Also consider integrationPoints, exportSurfaces, and entrypoints
      // as "declared" so they are not flagged as orphans.
      for (const ip of ic.integrationPoints ?? []) {
        declaredPaths.add(ip.path);
      }
      for (const es of ic.exportSurfaces ?? []) {
        declaredPaths.add(es.path);
      }
      for (const ep of ic.entrypoints ?? []) {
        declaredPaths.add(ep.path);
      }

      for (const f of allowedFiles) {
        if (!declaredPaths.has(f) && !orphanModules.includes(f)) {
          orphanModules.push(f);
        }
      }
    }
  }

  // --- Emit orphan diagnostic ---
  if (orphanModules.length > 0) {
    reasonCodes.push(WIRING_REASON_CODES.ORPHAN_MODULES_DETECTED);
    allDiagnostics.push({
      code: 'ORPHAN_MODULES_DETECTED',
      severity: 'warning',
      message: `Orphan modules detected (in task.allowedFiles but not in any declaredUnit/integrationPoint/exportSurface/entrypoint): ${orphanModules.join(', ')}`,
    });
  }

  // -----------------------------------------------------------------------
  // Verdict determination
  // -----------------------------------------------------------------------
  const FAIL_CODES: ReadonlySet<string> = new Set([
    WIRING_REASON_CODES.DECLARED_UNIT_MISSING,
    WIRING_REASON_CODES.EXPORT_SURFACE_MISSING,
  ]);

  const uniqueCodes = [...new Set(reasonCodes)];

  const hasFail = uniqueCodes.some(c => FAIL_CODES.has(c));

  if (hasFail) {
    return buildResult(
      'FAIL', uniqueCodes, allDiagnostics, attemptId, timestamp,
      declaredUnitsChecked, declaredUnitsMatched, exportsMissing,
      orphanModules, entrypointsMissing, integrationPointsMissing,
      modeInconsistent, declaredUnitResults, exportSurfaceResults,
      entrypointResults, integrationPointResults, plan, hashes, lock,
      'One or more declared files are missing. Restore missing files, fix paths in the plan, or remove the declaration.',
    );
  }

  if (uniqueCodes.length > 0) {
    return buildResult(
      'HOLD', uniqueCodes, allDiagnostics, attemptId, timestamp,
      declaredUnitsChecked, declaredUnitsMatched, exportsMissing,
      orphanModules, entrypointsMissing, integrationPointsMissing,
      modeInconsistent, declaredUnitResults, exportSurfaceResults,
      entrypointResults, integrationPointResults, plan, hashes, lock,
      'Wiring checks found issues. Add missing exports/imports, declare orphan modules, or update the plan\'s integration contract.',
    );
  }

  // All checks passed
  return buildResult(
    'PASS', [WIRING_REASON_CODES.WIRING_PASS], allDiagnostics, attemptId, timestamp,
    declaredUnitsChecked, declaredUnitsMatched, exportsMissing,
    orphanModules, entrypointsMissing, integrationPointsMissing,
    modeInconsistent, declaredUnitResults, exportSurfaceResults,
    entrypointResults, integrationPointResults, plan, hashes, lock,
    undefined,
  );
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function buildResult(
  verdict: 'PASS' | 'HOLD' | 'FAIL',
  reasonCodes: string[],
  diagnostics: Diagnostic[],
  attemptId: string,
  timestamp: string,
  declaredUnitsChecked: number,
  declaredUnitsMatched: number,
  exportsMissing: string[],
  orphanModules: string[],
  entrypointsMissing: string[],
  integrationPointsMissing: string[],
  modeInconsistent: boolean,
  declaredUnitResults: DeclaredUnitResult[],
  exportSurfaceResults: ExportSurfaceResult[],
  entrypointResults: EntrypointResult[],
  integrationPointResults: IntegrationPointResult[],
  plan?: PlanSpecV01,
  hashes?: WiringGateInput['hashes'],
  lock?: WiringGateInput['lock'],
  repairHint?: string,
): WiringGateResult {
  return {
    gateName: 'WiringGate',
    verdict,
    reasonCodes,
    diagnostics,
    failedCriteriaIds: [],
    evidenceRefs: [],
    attemptId,
    timestamp,
    repairHint,
    declaredUnitsChecked,
    declaredUnitsMatched,
    exportsMissing: [...new Set(exportsMissing)],
    orphanModules: [...new Set(orphanModules)],
    entrypointsMissing: [...new Set(entrypointsMissing)],
    integrationPointsMissing: [...new Set(integrationPointsMissing)],
    modeInconsistent,
    declaredUnitResults,
    exportSurfaceResults,
    entrypointResults,
    integrationPointResults,
    plan,
    hashes,
    lock,
  };
}
