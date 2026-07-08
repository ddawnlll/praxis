// @praxis/kernel — EvidenceGate
// Third gate in the PRAXIS Truth Kernel pipeline.
// Validates evidence ledger integrity: parsing, identity, namespace,
// required evidence presence, and divergence detection.
// Does NOT check semantic correctness, wiring, or command execution.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, AcceptanceCriterion } from '@praxis/contracts';
import { readEvidenceLedgerJsonl } from '../evidence/readEvidenceLedgerJsonl';
import { validateEvidenceLedger } from '../evidence/validateEvidenceLedger';
import {
  type EvidenceRecordV01,
  type EvidenceGateInput,
  type EvidenceGateResult,
  type ChangedFile,
  DETERMINISTIC_SOURCES,
  WEAK_SOURCES,
  DIVERGENCE_TYPES,
  BOOKKEEPING_TYPES,
} from '../evidence/types';
import { EVIDENCE_REASON_CODES } from '../diagnostics';

/**
 * Collect changed files from explicit input and evidence records.
 * Treats `diff`-type records (which carry inline diff content) as
 * implicit file changes — this makes the gate friendlier to agent-generated
 * work where diffs may be embedded in metadata rather than as separate
 * changed_file records.
 */
function collectChangedFiles(
  explicitChangedFiles: ChangedFile[] | undefined,
  records: EvidenceRecordV01[],
): ChangedFile[] {
  const seen = new Set<string>();
  const result: ChangedFile[] = [];

  // Explicit input takes priority
  if (explicitChangedFiles) {
    for (const cf of explicitChangedFiles) {
      if (!seen.has(cf.path)) {
        seen.add(cf.path);
        result.push(cf);
      }
    }
  }

  // Collect from changed_file and diff evidence records
  for (const r of records) {
    if (r.type === 'changed_file' && r.changedFile) {
      if (!seen.has(r.changedFile.path)) {
        seen.add(r.changedFile.path);
        result.push(r.changedFile);
      }
    }
    // diff-type records carry inline diff content — treat as implicit change
    if (r.type === 'diff' && r.path && !seen.has(r.path)) {
      seen.add(r.path);
      result.push({ path: r.path, status: 'modified' });
    }
    // Also check path field as implicit changed file
    if (r.path && !seen.has(r.path) && r.type !== 'changed_file' && r.type !== 'diff') {
      seen.add(r.path);
      result.push({ path: r.path, status: 'unknown' });
    }
  }

  return result;
}

/**
 * Check whether there is any diff evidence available, either as
 * changed_file records, explicit changedFiles input, or diff-type records.
 * This is a more accurate check than just changedFiles.length === 0
 * because agents may embed diffs in metadata rather than using
 * separate changed_file records.
 */
function hasDiffEvidence(
  explicitChangedFiles: ChangedFile[] | undefined,
  records: EvidenceRecordV01[],
): boolean {
  if (explicitChangedFiles && explicitChangedFiles.length > 0) return true;
  return records.some(r => r.type === 'changed_file' || r.type === 'diff');
}

/**
 * Check whether a file path is covered by a glob pattern.
 * v0.1: simple prefix and `**` glob matching. Does not implement full gitignore semantics.
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Normalize to forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');

  // Exact match
  if (normalized === p) return true;

  // ** prefix — match anywhere
  if (p.startsWith('**/')) {
    const suffix = p.slice(3);
    if (normalized.endsWith(suffix) || normalized.endsWith('/' + suffix)) return true;
  }

  // ** suffix — match prefix
  if (p.endsWith('/**')) {
    const prefix = p.slice(0, -3);
    if (normalized.startsWith(prefix + '/') || normalized === prefix) return true;
  }

  // ** in middle
  const doubleStarIdx = p.indexOf('/**/');
  if (doubleStarIdx !== -1) {
    const prefix = p.slice(0, doubleStarIdx);
    const suffix = p.slice(doubleStarIdx + 4);
    if (normalized.startsWith(prefix) && normalized.endsWith(suffix)) {
      return true;
    }
    if (normalized.startsWith(prefix) && normalized.endsWith('/' + suffix)) {
      return true;
    }
  }

  // Simple glob: * matches within a single segment
  const regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex chars
    .replace(/\*/g, '[^/]*')              // * → match non-slash chars
    .replace(/\?/g, '[^/]');              // ? → match single non-slash char
  const regex = new RegExp('^' + regexStr + '$');
  return regex.test(normalized);
}

/**
 * Check if a file path is within allowed files (matches any allowed pattern
 * and does NOT match any forbidden pattern).
 */
function isFileAllowed(
  filePath: string,
  allowedFiles: string[],
  forbiddenFiles: string[],
): { allowed: boolean; forbidden: boolean } {
  let allowed = false;

  for (const pattern of allowedFiles) {
    if (matchesGlob(filePath, pattern)) {
      allowed = true;
      break;
    }
  }

  for (const pattern of forbiddenFiles) {
    if (matchesGlob(filePath, pattern)) {
      return { allowed, forbidden: true };
    }
  }

  return { allowed, forbidden: false };
}

/**
 * Check whether the plan expects implementation work (i.e., has tasks
 * that produce code artifacts).
 */
function planExpectsImplementation(plan: PlanSpecV01): boolean {
  return plan.tasks.some(t => {
    const ac = t.artifactPolicy;
    return ac.class !== 'documentation' && ac.class !== 'config';
  });
}

/**
 * Run EvidenceGate.
 *
 * Checks (in order):
 * 1. Evidence ledger exists and parses
 * 2. attemptId and planId match
 * 3. Changed files respect namespace (allowedFiles/forbiddenFiles)
 * 4. Diff evidence is present when implementation is expected
 * 5. Required evidence types are mapped to criteria
 * 6. Divergence records are absent
 * 7. Deterministic evidence is present where required
 */
export function runEvidenceGate(input: EvidenceGateInput): EvidenceGateResult {
  const attemptId = input.attemptId;
  const plan = input.plan;
  const timestamp = new Date().toISOString();

  const reasonCodes: string[] = [];
  const allDiagnostics: Diagnostic[] = [];
  const forbiddenFilesTouched: string[] = [];
  const namespaceViolations: string[] = [];
  const failedCriteriaIds: string[] = [];
  const evidenceRefs: string[] = [];

  let evidenceRecords: EvidenceRecordV01[] = [];
  let diffEmpty = false;

  // --- Step 1: Read evidence ledger ---
  if (input.evidenceRecords && input.evidenceRecords.length > 0) {
    evidenceRecords = input.evidenceRecords;
  } else if (input.evidenceRecords && input.evidenceRecords.length === 0 && planExpectsImplementation(plan)) {
    // Explicitly empty evidence records for an implementation plan
    reasonCodes.push(EVIDENCE_REASON_CODES.EVIDENCE_LEDGER_MISSING);
    return buildResult(
      'HOLD', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
      attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
      namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
      'No evidence records provided. Execute the plan first.',
    );
  } else if (input.evidenceLedgerPath) {
    const readResult = readEvidenceLedgerJsonl(input.evidenceLedgerPath);
    allDiagnostics.push(...readResult.diagnostics);

    if (!readResult.ok) {
      // Parse error → FAIL
      reasonCodes.push(EVIDENCE_REASON_CODES.EVIDENCE_LEDGER_PARSE_ERROR);
      return buildResult(
        'FAIL', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
        attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
        namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
        'Evidence ledger parse error. Check file format and retry.',
      );
    }

    if (readResult.records.length === 0 && planExpectsImplementation(plan)) {
      reasonCodes.push(EVIDENCE_REASON_CODES.EVIDENCE_LEDGER_MISSING);
      return buildResult(
        'HOLD', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
        attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
        namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
        'No evidence records found. Execute the plan first.',
      );
    }

    evidenceRecords = readResult.records;
  } else {
    // No evidence source provided
    if (planExpectsImplementation(plan)) {
      reasonCodes.push(EVIDENCE_REASON_CODES.EVIDENCE_LEDGER_MISSING);
      return buildResult(
        'HOLD', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
        attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
        namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
        'No evidence ledger provided. Execute the plan or provide evidence records.',
      );
    }
  }

  // Collect evidence refs
  for (const r of evidenceRecords) {
    evidenceRefs.push(r.recordId);
  }

  // --- Step 2: Validate evidence records ---
  const validation = validateEvidenceLedger(evidenceRecords, plan, attemptId);
  allDiagnostics.push(...validation.diagnostics);

  // Map validation diagnostics to reason codes
  const validationCodes = new Set<string>();
  for (const d of validation.diagnostics) {
    if (d.code === 'ATTEMPT_ID_MISMATCH') validationCodes.add(EVIDENCE_REASON_CODES.ATTEMPT_ID_MISMATCH);
    if (d.code === 'PLAN_ID_MISMATCH') validationCodes.add(EVIDENCE_REASON_CODES.PLAN_ID_MISMATCH);
    if (d.code === 'UNKNOWN_TASK_ID') validationCodes.add(EVIDENCE_REASON_CODES.UNKNOWN_TASK_ID);
    if (d.code === 'UNKNOWN_CRITERION_ID') validationCodes.add(EVIDENCE_REASON_CODES.UNKNOWN_CRITERION_ID);
    if (d.code === 'UNSUPPORTED_EVIDENCE_TYPE') validationCodes.add(EVIDENCE_REASON_CODES.UNSUPPORTED_EVIDENCE_TYPE);
    if (d.code === 'DIVERGENCE_DETECTED') validationCodes.add(EVIDENCE_REASON_CODES.DIVERGENCE_DETECTED);
  }
  reasonCodes.push(...validationCodes);

  if (!validation.ok) {
    failedCriteriaIds.push(...validation.unknownCriterionIds);
    return buildResult(
      'FAIL', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
      attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
      namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
      'Evidence validation failed. See diagnostics for details.',
    );
  }

  // --- Step 3: Changed file namespace check ---
  const changedFiles = collectChangedFiles(input.changedFiles, evidenceRecords);

  // Check for diff evidence more thoroughly: look for diff-type records
  // and changed_file records, not just the parsed ChangedFile list.
  // This avoids false DIFF_EMPTY when agents embed diffs in metadata
  // rather than using dedicated changed_file records.
  if (!hasDiffEvidence(input.changedFiles, evidenceRecords) && planExpectsImplementation(plan)) {
    diffEmpty = true;
    reasonCodes.push(EVIDENCE_REASON_CODES.DIFF_EMPTY);
    allDiagnostics.push({
      code: 'DIFF_EMPTY',
      severity: 'info',
      message: 'No diff or changed_file evidence found for an implementation plan. '
        + 'This is expected if the agent is still working or the plan produces '
        + 'documentation/config-only artifacts. '
        + 'To satisfy this gate, include changed_file or diff-type evidence records.',
    });
  }

  for (const cf of changedFiles) {
    const { allowed, forbidden } = isFileAllowed(
      cf.path,
      plan.workspace.allowedFiles,
      plan.workspace.forbiddenFiles,
    );

    if (forbidden) {
      forbiddenFilesTouched.push(cf.path);
      reasonCodes.push(EVIDENCE_REASON_CODES.FORBIDDEN_FILE_CHANGED);
    }

    if (!allowed && !forbidden) {
      namespaceViolations.push(cf.path);
      reasonCodes.push(EVIDENCE_REASON_CODES.CHANGED_FILE_OUTSIDE_ALLOWED_FILES);
    }
  }

  if (forbiddenFilesTouched.length > 0 || namespaceViolations.length > 0) {
    return buildResult(
      'FAIL', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
      attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
      namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
      forbiddenFilesTouched.length > 0
        ? 'Forbidden files were modified. Human review required.'
        : 'Files changed outside allowed namespace. Check workspace boundaries.',
    );
  }

  // --- Step 4: Required evidence mapping ---
  if (validation.missingRequiredEvidence.length > 0) {
    reasonCodes.push(EVIDENCE_REASON_CODES.REQUIRED_EVIDENCE_TYPE_MISSING);
    for (const m of validation.missingRequiredEvidence) {
      failedCriteriaIds.push(m.criterionId);
    }
  }

  // --- Step 5: Deterministic evidence check ---
  if (validation.deterministicEvidenceMissing.length > 0) {
    reasonCodes.push(EVIDENCE_REASON_CODES.DETERMINISTIC_EVIDENCE_MISSING);
    failedCriteriaIds.push(...validation.deterministicEvidenceMissing);
  }

  // --- Step 6: Determine verdict ---
  const FAIL_CODES: readonly string[] = [
    EVIDENCE_REASON_CODES.ATTEMPT_ID_MISMATCH,
    EVIDENCE_REASON_CODES.PLAN_ID_MISMATCH,
    EVIDENCE_REASON_CODES.FORBIDDEN_FILE_CHANGED,
    EVIDENCE_REASON_CODES.CHANGED_FILE_OUTSIDE_ALLOWED_FILES,
    EVIDENCE_REASON_CODES.UNKNOWN_TASK_ID,
    EVIDENCE_REASON_CODES.UNKNOWN_CRITERION_ID,
    EVIDENCE_REASON_CODES.UNSUPPORTED_EVIDENCE_TYPE,
    EVIDENCE_REASON_CODES.DIVERGENCE_DETECTED,
    EVIDENCE_REASON_CODES.EVIDENCE_LEDGER_PARSE_ERROR,
  ];
  const hasFail = reasonCodes.some(c => FAIL_CODES.includes(c));

  if (hasFail) {
    return buildResult(
      'FAIL', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
      attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
      namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
      'Evidence integrity check failed. Do not trust downstream gate results.',
    );
  }

  const hasHold = reasonCodes.length > 0; // Any remaining reason code is a HOLD
  if (hasHold) {
    return buildResult(
      'HOLD', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
      attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
      namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
      'Evidence exists but is incomplete or missing required types. Improve evidence capture.',
    );
  }

  // All clear
  reasonCodes.push(EVIDENCE_REASON_CODES.EVIDENCE_PASS);
  return buildResult(
    'PASS', reasonCodes, allDiagnostics, failedCriteriaIds, evidenceRefs,
    attemptId, timestamp, evidenceRecords, forbiddenFilesTouched,
    namespaceViolations, diffEmpty, plan, input.hashes, input.lock,
  );
}

function buildResult(
  verdict: 'PASS' | 'HOLD' | 'FAIL',
  reasonCodes: string[],
  diagnostics: Diagnostic[],
  failedCriteriaIds: string[],
  evidenceRefs: string[],
  attemptId: string,
  timestamp: string,
  evidenceRecords: EvidenceRecordV01[],
  forbiddenFilesTouched: string[],
  namespaceViolations: string[],
  diffEmpty: boolean,
  plan?: PlanSpecV01,
  hashes?: EvidenceGateInput['hashes'],
  lock?: EvidenceGateInput['lock'],
  repairHint?: string,
): EvidenceGateResult {
  const uniqueCodes = [...new Set(reasonCodes)];
  return {
    gateName: 'EvidenceGate',
    verdict,
    reasonCodes: uniqueCodes.length > 0 ? uniqueCodes : [EVIDENCE_REASON_CODES.EVIDENCE_PASS],
    failedCriteriaIds: [...new Set(failedCriteriaIds)],
    evidenceRefs,
    attemptId,
    timestamp,
    repairHint,
    diagnostics,
    evidenceCount: evidenceRecords.length,
    forbiddenFilesTouched: [...new Set(forbiddenFilesTouched)],
    namespaceViolations: [...new Set(namespaceViolations)],
    diffEmpty,
    plan,
    hashes,
    lock,
    evidenceRecords,
  };
}
