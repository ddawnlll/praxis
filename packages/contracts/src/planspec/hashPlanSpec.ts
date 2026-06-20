// @praxis/contracts — Hasher
// Computes SHA-256 hashes for the full plan and individual field groups.

import { createHash } from 'node:crypto';
import type { PlanSpecV01 } from './types';
import { canonicalizePlanSpec } from './canonicalizePlanSpec';

/** Field-group SHA-256 hashes for a validated PlanSpec. */
export interface PlanHashes {
  planHash: string;
  acceptanceCriteriaHash: string;
  artifactPolicyHash: string;
  integrationContractHash: string;
  commandPolicyHash: string;
  allowedFilesHash: string;
  forbiddenFilesHash: string;
}

/**
 * Compute all PlanHashes for a validated PlanSpec.
 * Hashes are deterministic because canonicalizePlanSpec sorts keys.
 */
export function hashPlanSpec(plan: PlanSpecV01): PlanHashes {
  const hashSource = (obj: unknown): string => {
    const sorted = sortKeysDeep(obj);
    const json = JSON.stringify(sorted, null, 0);
    return createHash('sha256').update(json).digest('hex');
  };

  // Full plan hash
  const planHash = createHash('sha256')
    .update(canonicalizePlanSpec(plan))
    .digest('hex');

  // Acceptance criteria hash — all ACs across all tasks
  const acceptanceCriteriaHash = hashSource(
    plan.tasks.map(t => ({
      taskId: t.id,
      criteria: t.acceptanceCriteria.map(ac => ({
        id: ac.id,
        description: ac.description,
        level: ac.level,
        humanApproved: ac.humanApproved,
        criteriaSource: ac.criteriaSource,
        verification: {
          type: ac.verification.type,
          deterministic: ac.verification.deterministic,
          canSatisfyFinalGate: ac.verification.canSatisfyFinalGate,
          advisoryOnly: ac.verification.advisoryOnly,
        },
        requiredEvidence: [...ac.requiredEvidence].sort(),
      })),
    })),
  );

  // Artifact policy hash
  const artifactPolicyHash = hashSource(
    plan.tasks.map(t => ({
      taskId: t.id,
      artifactPolicy: t.artifactPolicy,
    })),
  );

  // Integration contract hash
  const integrationContractHash = hashSource(
    plan.tasks
      .filter(t => t.integrationContract)
      .map(t => ({
        taskId: t.id,
        integrationContract: {
          mode: t.integrationContract!.mode,
          reason: t.integrationContract!.reason,
        },
      })),
  );

  // Command policy hash
  const commandPolicyHash = hashSource({
    exactAllowedCommands: plan.commands.exactAllowedCommands.map(c => ({
      id: c.id,
      kind: c.kind,
      command: c.command,
      timeoutSeconds: c.timeoutSeconds,
      evidenceRequired: c.evidenceRequired,
    })),
    hardDeniedCommands: plan.commands.hardDeniedCommands.map(c => ({
      command: c.command,
      reason: c.reason,
    })),
  });

  // Allowed files hash
  const allowedFilesHash = hashSource([...plan.workspace.allowedFiles].sort());

  // Forbidden files hash
  const forbiddenFilesHash = hashSource([...plan.workspace.forbiddenFiles].sort());

  return {
    planHash,
    acceptanceCriteriaHash,
    artifactPolicyHash,
    integrationContractHash,
    commandPolicyHash,
    allowedFilesHash,
    forbiddenFilesHash,
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortKeysDeep(obj[k]);
    }
    return sorted;
  }
  return value;
}
