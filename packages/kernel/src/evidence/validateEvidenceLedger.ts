// @praxis/kernel — validateEvidenceLedger
// Validates evidence records against plan identity, task/AC ids, evidence types,
// and changed-file namespace rules.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01 } from '@praxis/contracts';
import {
  type EvidenceRecordV01,
  type ChangedFile,
  DETERMINISTIC_SOURCES,
  WEAK_SOURCES,
  DIVERGENCE_TYPES,
  BOOKKEEPING_TYPES,
} from './types';

/** Result of evidence validation checks. */
export interface EvidenceValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Records that reference unknown task IDs. */
  unknownTaskIds: string[];
  /** Records that reference unknown criterion IDs. */
  unknownCriterionIds: string[];
  /** Records with unsupported evidence types. */
  unsupportedTypes: string[];
  /** Divergence records found. */
  divergenceRecords: string[];
  /** Required evidence types that are missing per criterion. */
  missingRequiredEvidence: Array<{ criterionId: string; missingTypes: string[] }>;
  /** Criterion IDs that have only weak-source evidence for deterministic requirements. */
  deterministicEvidenceMissing: string[];
}

/**
 * Validate evidence records against plan constraints.
 *
 * Checks performed:
 * - attemptId and planId match
 * - taskId references existing tasks
 * - criterionId references existing acceptance criteria
 * - evidence type is supported
 * - divergence records are flagged
 * - required evidence types are present per criterion
 * - deterministic evidence requirements are met
 */
export function validateEvidenceLedger(
  records: EvidenceRecordV01[],
  plan: PlanSpecV01,
  attemptId: string,
): EvidenceValidationResult {
  const diagnostics: Diagnostic[] = [];
  const unknownTaskIds: string[] = [];
  const unknownCriterionIds: string[] = [];
  const unsupportedTypes: string[] = [];
  const divergenceRecords: string[] = [];

  // Build lookup sets
  const taskIds = new Set(plan.tasks.map(t => t.id));
  const criterionIds = new Set<string>();
  for (const task of plan.tasks) {
    for (const ac of task.acceptanceCriteria) {
      criterionIds.add(ac.id);
    }
  }

  // Valid evidence types: required + bookkeeping
  const validTypes = new Set<string>([
    ...plan.evidence.requiredEvidenceTypes,
    ...BOOKKEEPING_TYPES,
  ]);

  for (const record of records) {
    // Check attemptId
    if (record.attemptId !== attemptId) {
      diagnostics.push({
        code: 'ATTEMPT_ID_MISMATCH',
        severity: 'error',
        message: `Evidence record ${record.recordId}: attemptId "${record.attemptId}" does not match kernel attemptId "${attemptId}".`,
      });
    }

    // Check planId
    if (record.planId !== plan.metadata.planId) {
      diagnostics.push({
        code: 'PLAN_ID_MISMATCH',
        severity: 'error',
        message: `Evidence record ${record.recordId}: planId "${record.planId}" does not match plan.metadata.planId "${plan.metadata.planId}".`,
      });
    }

    // Check taskId reference
    if (record.taskId && !taskIds.has(record.taskId)) {
      unknownTaskIds.push(record.recordId);
      diagnostics.push({
        code: 'UNKNOWN_TASK_ID',
        severity: 'error',
        message: `Evidence record ${record.recordId}: references unknown taskId "${record.taskId}".`,
      });
    }

    // Check criterionId reference
    if (record.criterionId && !criterionIds.has(record.criterionId)) {
      unknownCriterionIds.push(record.recordId);
      diagnostics.push({
        code: 'UNKNOWN_CRITERION_ID',
        severity: 'error',
        message: `Evidence record ${record.recordId}: references unknown criterionId "${record.criterionId}".`,
      });
    }

    // Check evidence type
    if (!validTypes.has(record.type)) {
      unsupportedTypes.push(record.recordId);
      diagnostics.push({
        code: 'UNSUPPORTED_EVIDENCE_TYPE',
        severity: 'error',
        message: `Evidence record ${record.recordId}: type "${record.type}" is not supported. `
          + `Must be one of plan.evidence.requiredEvidenceTypes or bookkeeping types: ${[...BOOKKEEPING_TYPES].join(', ')}.`,
      });
    }

    // Check divergence
    if (DIVERGENCE_TYPES.has(record.type)) {
      divergenceRecords.push(record.recordId);
      diagnostics.push({
        code: 'DIVERGENCE_DETECTED',
        severity: 'error',
        message: `Evidence record ${record.recordId}: divergence record of type "${record.type}".`,
      });
    }
  }

  // Check required evidence mapping
  const missingRequiredEvidence: EvidenceValidationResult['missingRequiredEvidence'] = [];
  const deterministicEvidenceMissing: string[] = [];

  for (const task of plan.tasks) {
    for (const ac of task.acceptanceCriteria) {
      if (ac.level !== 'required') continue;

      const missingTypes: string[] = [];
      for (const reqType of ac.requiredEvidence) {
        const hasRecord = records.some(
          r => r.criterionId === ac.id && r.type === reqType,
        );
        if (!hasRecord) {
          missingTypes.push(reqType);
        }
      }

      if (missingTypes.length > 0) {
        missingRequiredEvidence.push({
          criterionId: ac.id,
          missingTypes,
        });
      }

      // Check deterministic evidence requirement
      if (ac.verification.deterministic) {
        const hasDeterministicRecord = records.some(
          r =>
            r.criterionId === ac.id &&
            DETERMINISTIC_SOURCES.has(r.source) &&
            !WEAK_SOURCES.has(r.source),
        );
        if (!hasDeterministicRecord) {
          const hasWeakRecord = records.some(
            r => r.criterionId === ac.id,
          );
          if (hasWeakRecord) {
            deterministicEvidenceMissing.push(ac.id);
            diagnostics.push({
              code: 'DETERMINISTIC_EVIDENCE_MISSING',
              severity: 'warning',
              message: `Criterion "${ac.id}" requires deterministic evidence but only weak/agent-claim sources found. `
                + `Accepted deterministic sources: ${[...DETERMINISTIC_SOURCES].join(', ')}. `
                + `Accepted weak sources (excluded from deterministic check): ${[...WEAK_SOURCES].join(', ')}.`,
            });
          }
        }
      }
    }
  }

  const hasErrors = diagnostics.some(d => d.severity === 'error');

  return {
    ok: !hasErrors,
    diagnostics,
    unknownTaskIds,
    unknownCriterionIds,
    unsupportedTypes,
    divergenceRecords,
    missingRequiredEvidence,
    deterministicEvidenceMissing,
  };
}
