// @praxis/kernel — WiringGate Types
// WiringGateInput, WiringGateResult, and auxiliary result types for WiringGate v0.1.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type { GateVerdictValue, PlanLockV01 } from '../types';
import type { EvidenceRecordV01 } from '../evidence/types';

/** Input for WiringGate. */
export interface WiringGateInput {
  /** Parsed PlanSpec v0.1 with tasks that may have integrationContract. */
  plan: PlanSpecV01;
  /** PlanHashes carried forward from SchemaGate/LockGate. */
  hashes: PlanHashes;
  /** Unique attempt identifier. */
  attemptId: string;
  /** Repository root for resolving relative file paths. */
  repoRoot: string;
  /** Evidence records from EvidenceGate (context, not validated here). */
  evidenceRecords?: EvidenceRecordV01[];
  /** PlanLock carried forward from LockGate. */
  lock?: PlanLockV01;
}

/** Result of a single declared unit check. */
export interface DeclaredUnitResult {
  /** declaredUnit.id from the integration contract. */
  unitId: string;
  /** Resolved file path. */
  path: string;
  /** Whether the file exists at the declared path. */
  exists: boolean;
  /** Exports searched for (from expectedExports). */
  expectedExports: string[];
  /** Exports that were matched via RegExp pattern. */
  matchedExports: string[];
  /** Exports that were NOT matched. */
  missingExports: string[];
}

/** Result of a single export surface check. */
export interface ExportSurfaceResult {
  /** exportSurface.id from the integration contract. */
  surfaceId: string;
  /** Resolved file path. */
  path: string;
  /** Whether the file exists. */
  exists: boolean;
  /** Required exports from the contract. */
  requiredExports: string[];
  /** Exports that were matched via RegExp pattern. */
  matchedExports: string[];
  /** Exports that were NOT matched. */
  missingExports: string[];
}

/** Result of a single entrypoint check. */
export interface EntrypointResult {
  /** entrypoint.id from the integration contract. */
  entrypointId: string;
  /** Resolved file path. */
  path: string;
  /** Whether the file exists. */
  exists: boolean;
}

/** Result of a single integration point check. */
export interface IntegrationPointResult {
  /** integrationPoint.id from the integration contract. */
  pointId: string;
  /** Resolved file path. */
  path: string;
  /** Whether the file exists. */
  exists: boolean;
  /** Expected imports from the contract. */
  expectedImports: string[];
  /** Imports that were matched via RegExp pattern. */
  matchedImports: string[];
  /** Imports that were NOT matched. */
  missingImports: string[];
}

/** WiringGate result — extends the GateVerdict shape with wiring-specific diagnostics. */
export interface WiringGateResult {
  gateName: 'WiringGate';
  verdict: GateVerdictValue;
  reasonCodes: string[];
  diagnostics: Diagnostic[];
  failedCriteriaIds: string[];
  evidenceRefs: string[];
  attemptId: string;
  timestamp: string;
  repairHint?: string;

  // --- WiringGate-specific fields ---

  /** Number of declared units checked. */
  declaredUnitsChecked: number;
  /** Number of declared units that passed all checks (exists + all exports matched). */
  declaredUnitsMatched: number;
  /** Collects all missing export names across declaredUnits and exportSurfaces. */
  exportsMissing: string[];
  /** Paths of orphan modules (files in allowedFiles but not in any declaredUnit.path). */
  orphanModules: string[];
  /** Entrypoint IDs whose file paths were not found. */
  entrypointsMissing: string[];
  /** Integration point IDs whose file paths were not found. */
  integrationPointsMissing: string[];
  /** Whether the wiring mode is inconsistent with actual declarations. */
  modeInconsistent: boolean;

  // --- Per-check detail results ---

  /** Detailed results for each declared unit. */
  declaredUnitResults: DeclaredUnitResult[];
  /** Detailed results for each export surface. */
  exportSurfaceResults: ExportSurfaceResult[];
  /** Detailed results for each entrypoint. */
  entrypointResults: EntrypointResult[];
  /** Detailed results for each integration point. */
  integrationPointResults: IntegrationPointResult[];

  // --- Carry-forward fields for downstream gates ---

  /** Plan carried forward. */
  plan?: PlanSpecV01;
  /** Hashes carried forward. */
  hashes?: PlanHashes;
  /** Lock carried forward. */
  lock?: PlanLockV01;
}
