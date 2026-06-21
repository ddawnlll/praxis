# WiringGate v0.1 Design

> This document defines WiringGate v0.1-lite — the fourth gate in the PRAXIS Truth Kernel pipeline. It verifies that declared artifacts exist at their expected paths and that export surfaces are present, without performing full AST-level import graph analysis.

## Purpose

WiringGate answers: **"Do the declared artifacts and integration points actually exist in the filesystem as specified?"**

It ensures that:
- Every `declaredUnit` in an `integrationContract` exists at its declared path
- Every `exportSurface` has its `requiredExports` actually present in the source file (via pattern matching, not AST)
- Every `entrypoint` path exists
- No orphan modules exist (files within the task's allowedFiles that aren't in any declaredUnit)
- The wiring mode declared in `integrationContract.mode` is consistent with what exists

## Position in Pipeline

```
SchemaGate → LockGate → EvidenceGate → [WiringGate] → ExecGate → FinalGate
                                        ↑ we are here (P4)
```

This position is intentional: WiringGate runs AFTER EvidenceGate confirms that files exist (evidence of changes), but BEFORE ExecGate runs commands. If wiring is broken, running tests is futile.

## v0.1 Scope: "Static File Matching Only"

WiringGate v0.1 is explicitly limited to static file-level checks. All advanced checks are deferred:

### In v0.1 (Static)

| Check | What It Does | Verification |
|-------|-------------|--------------|
| Declared unit exists | File at `declaredUnit.path` exists | `fs.existsSync()` |
| Export surface exists | File at `exportSurface.path` exists | `fs.existsSync()` |
| Required exports present | `requiredExports` strings found in source file | Simple `grep`-style pattern match (RegExp on file content) |
| Entrypoint exists | File at `entrypoint.path` exists | `fs.existsSync()` |
| Orphan module detection | Files in `allowedFiles` not in any `declaredUnit.path` | Set difference |
| Wiring mode consistency | `mode: none` → no units expected; `mode: consumer_or_export` → exports must exist | Check against declared vs actual |

### Deferred to v0.2+ (Advanced)

| Check | What It Would Do | Why Deferred |
|-------|-----------------|--------------|
| Import graph analysis | Verify import dependencies are satisfied | Requires TypeScript compiler API or heavy parser |
| AST-level export verification | Verify exact exported symbols match declarations | Requires language-specific AST parser |
| Transitive dependency check | Verify dependencies of dependencies exist | Requires full import resolution |
| Usage proof validation | Verify `usageProof.commandRef` actually invokes target | Requires command stdout analysis |
| Runtime probe verification | Verify `runtimeProbe` endpoints respond | Requires actual probing (ExecGate concern) |
| Reachability tracing | Full call graph from entrypoint to all declared units | Requires AST analysis |

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| `plan` | KernelContext (carried forward) | Parsed PlanSpec with tasks that have integrationContract |
| `evidenceRecords` | EvidenceGate | List of evidence records (to confirm files changed) |
| `repoRoot` | KernelContext | Repository root for resolving paths |

## Core Checks

### Check 1: DeclaredUnit Verification

```
FOR EACH task WHERE task.integrationContract is defined:
  FOR EACH declaredUnit IN task.integrationContract.declaredUnits:
    resolvedPath = resolve(task.path, repoRoot)
    
    IF resolvedPath does not exist:
      → FAIL (DECLARED_UNIT_MISSING, declaredUnit.id)
      → "Declared unit not found at path: <path>"
    
    IF declaredUnit.expectedExports is non-empty:
      FOR EACH export IN declaredUnit.expectedExports:
        IF export string NOT found in file content (simple pattern):
          → HOLD (EXPORT_NOT_FOUND, declaredUnit.id, export)
          → "Expected export '${export}' not found in ${path}"
```

**Important:** The export check is a SIMPLE pattern match (RegExp or string inclusion), NOT AST parsing. This means:
- It finds `export function foo` and `export const foo` 
- It may get false positives from strings containing the export name
- It may get false negatives for re-exported symbols (`export { foo } from './bar'`)
- This is ACCEPTABLE for v0.1 — the false positive/negative rate is low enough to catch 80%+ of wiring failures

### Check 2: ExportSurface Verification

```
FOR EACH task WHERE task.integrationContract.exportSurfaces is defined:
  FOR EACH exportSurface IN task.integrationContract.exportSurfaces:
    resolvedPath = resolve(exportSurface.path, repoRoot)
    
    IF resolvedPath does not exist:
      → FAIL (EXPORT_SURFACE_MISSING, exportSurface.id)
    
    FOR EACH requiredExport IN exportSurface.requiredExports:
      IF requiredExport NOT found in file content:
        → HOLD (REQUIRED_EXPORT_MISSING, exportSurface.id, requiredExport)
```

### Check 3: Entrypoint Verification

```
FOR EACH task WHERE task.integrationContract.entrypoints is defined:
  FOR EACH entrypoint IN task.integrationContract.entrypoints:
    resolvedPath = resolve(entrypoint.path, repoRoot)
    
    IF resolvedPath does not exist:
      → HOLD (ENTRYPOINT_NOT_FOUND, entrypoint.id)
      → "Entrypoint not found at: <path>"
```

### Check 4: Integration Point Verification

```
FOR EACH task WHERE task.integrationContract.integrationPoints is defined:
  FOR EACH integrationPoint IN task.integrationContract.integrationPoints:
    resolvedPath = resolve(integrationPoint.path, repoRoot)
    
    IF resolvedPath does not exist:
      → HOLD (INTEGRATION_POINT_NOT_FOUND, integrationPoint.id)
      → "Integration point not found at: <path>"
    
    IF integrationPoint.expectedImports is non-empty:
      FOR EACH import IN integrationPoint.expectedImports:
        IF import NOT found in file content:
          → HOLD (EXPECTED_IMPORT_MISSING, integrationPoint.id, import)
```

### Check 5: Orphan Module Detection

```
FOR EACH task:
  allowedFiles = task.implementation.allowedFiles ?? []
  declaredPaths = task.integrationContract?.declaredUnits?.map(u => u.path) ?? []
  
  orphanModules = allowedFiles.filter(f => !declaredPaths.includes(f))
  
  IF orphanModules.length > 0 AND task.integrationContract != null:
    → HOLD (ORPHAN_MODULES_DETECTED, orphanModules)
    → "Files exist in allowedFiles but not in any declaredUnit: <paths>"
```

**Note:** Orphan module detection only triggers HOLD, not FAIL. Files may legitimately exist in allowedFiles without being declared units (support files, configs, etc.). The HOLD signals the plan author to either declare them or move them.

### Check 6: Wiring Mode Consistency

```
FOR EACH task:
  IF task.integrationContract.mode === 'none':
    AND task.integrationContract.declaredUnits is non-empty:
    → HOLD (WIRING_MODE_INCONSISTENT, task.id)
    → "mode=none but declaredUnits is non-empty"
  
  IF task.integrationContract.mode IN ['required', 'consumer_or_export']:
    AND task.integrationContract.declaredUnits is empty:
    AND task.integrationContract.integrationPoints is empty:
    AND task.integrationContract.exportSurfaces is empty:
    → HOLD (WIRING_MODE_DECLARED_BUT_EMPTY, task.id)
    → "Wiring mode '${mode}' requires at least one declaration"
```

## Outputs

### WiringGateResult

```
interface WiringGateResult {
  gateName: 'WiringGate'
  verdict: 'PASS' | 'HOLD' | 'FAIL'
  reasonCodes: string[]
  diagnostics: Diagnostic[]
  failedCriteriaIds: string[]
  evidenceRefs: string[]
  repairHint?: string
  
  contextUpdates: {
    declaredUnitsMatched: DeclaredUnitResult[]  // unitId → matched/failed
    exportSurfaceResults: ExportCheck[]          // surfaceId → exports found/missing
    orphanModules: string[]                      // paths of orphaned files
    entrypointResults: EntrypointCheck[]         // entrypointId → exists/not
  }
  
  timestamp: string
  attemptId: string
}
```

## Reason Codes

| Code | Verdict | Condition |
|------|---------|-----------|
| `WIRING_PASS` | PASS | All wiring checks pass |
| `DECLARED_UNIT_MISSING` | FAIL | Declared unit path does not exist |
| `EXPORT_NOT_FOUND` | HOLD | Expected export string not found in declared unit |
| `EXPORT_SURFACE_MISSING` | FAIL | Export surface path does not exist |
| `REQUIRED_EXPORT_MISSING` | HOLD | Required export not found in export surface |
| `ENTRYPOINT_NOT_FOUND` | HOLD | Entrypoint path does not exist |
| `INTEGRATION_POINT_NOT_FOUND` | HOLD | Integration point path does not exist |
| `EXPECTED_IMPORT_MISSING` | HOLD | Expected import pattern not found |
| `ORPHAN_MODULES_DETECTED` | HOLD | Files undeclared in any declaredUnit |
| `WIRING_MODE_INCONSISTENT` | HOLD | Wiring mode contradicts declarations |
| `WIRING_MODE_DECLARED_BUT_EMPTY` | HOLD | Wiring mode requires declarations but none exist |

## Verdict Ladder

```
All units exist, exports found, no orphans     → PASS
All units exist, some exports/imports missing   → HOLD
Orphan modules detected                          → HOLD
Entrypoint not found                             → HOLD
Integration point not found                      → HOLD
Declared unit file missing                       → FAIL
Export surface file missing                      → FAIL
Wiring mode inconsistency                        → HOLD
```

## HOLD vs FAIL Semantics

| Verdict | Meaning | Recovery |
|---------|---------|----------|
| PASS | All declared artifacts exist at expected paths | Proceed to ExecGate |
| HOLD | Artifacts exist but some exports/imports missing, or orphans detected | Repair: add missing exports, declare orphan units, or update plan |
| FAIL | Required file missing entirely | Repair: restore missing file, update plan, or fix declaredUnit path |

HOLD means "wiring partially exists but is incomplete."  
FAIL means "a declared contract is broken — the file doesn't exist at all."

## Integration with PlanSpec Schema

WiringGate consumes these PlanSpec fields:

```
task.integrationContract (required if artifactPolicy.class in [runtime_code, cli_command])
  ├── .mode              — 'none' | 'required' | 'consumer_or_export' | 'runner_discovery' | 'runtime_probe' | 'manual_only'
  ├── .declaredUnits[]   — File paths and their expected exports
  ├── .integrationPoints[] — Files where integration is expected
  ├── .entrypoints[]     — Entry point files
  ├── .exportSurfaces[]  — Files that export to consumers
  ├── .usageProofs[]     — (Deferred to v0.2 for full validation)
  └── .runtimeProbes[]   — (Deferred to v0.2 — ExecGate concern)
```

## Example Scenarios

| Scenario | Result |
|----------|--------|
| All declared units exist with expected exports | PASS |
| Library code with export surface — all exports present | PASS |
| Declared unit path doesn't exist after execution | FAIL |
| Export surface exists but missing required export | HOLD |
| Entrypoint file exists but integration point missing | HOLD |
| Orphan files detected in allowedFiles | HOLD |
| Test-only task (no integrationContract needed) | PASS (skipped) |
| Documentation task (no integrationContract needed) | PASS (skipped) |
| Runtime code with mode=none but declaredUnits present | HOLD |

## Safety Rules

1. WiringGate MUST NOT modify any file system — read-only
2. WiringGate MUST NOT import or execute any declared unit — analysis only
3. WiringGate MUST handle missing integrationContract gracefully — skip, don't fail
4. WiringGate MUST NOT parse or evaluate source code — pattern matching only
5. WiringGate MUST work in the absence of language-specific tooling (no TypeScript compiler required)
6. WiringGate MUST respect the task's artifact policy — documentation tasks don't need wiring

## Advanced WIRING (v0.2+)

For reference, the full WiringGate design for v0.2+ would add:

```
AST-level export verification          — TypeScript compiler API
Import graph resolution                — Full dependency tree
Transitive dependency satisfaction     — All deps resolvable
Usage proof execution                  — Run usageProof commands
Runtime probe execution                — Run runtimeProbe commands
Reachability tracing from entrypoint   — Call graph analysis
Cycle detection                        — No circular dependencies
```

These are explicitly out of scope for v0.1 and documented here to prevent scope creep.
