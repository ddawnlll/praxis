// @praxis/kernel — createPlanLock
// Creates a PlanLockV01 YAML-serializable object.

import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type { PlanLockV01 } from '../types';

/**
 * Create a PlanLockV01 from PlanSpec metadata and computed hashes.
 */
export function createPlanLock(
  plan: PlanSpecV01,
  hashes: PlanHashes,
  options?: {
    planPath?: string;
    schemaPath?: string;
    contractsPackageVersion?: string;
  },
): PlanLockV01 {
  const now = new Date().toISOString();

  return {
    lockVersion: 'praxis-plan-lock/v0.1',
    planSpecVersion: '0.1.0',
    kind: 'ImplementationPlan',
    profile: 'praxis-v0.1',
    planId: plan.metadata.planId,
    title: plan.metadata.title,
    createdAt: plan.metadata.createdAt,
    updatedAt: now,
    hashes,
    source: {
      planPath: options?.planPath,
      schemaPath: options?.schemaPath ?? 'schemas/planspec.v0.1.schema.yaml',
      contractsPackageVersion: options?.contractsPackageVersion,
    },
  };
}
