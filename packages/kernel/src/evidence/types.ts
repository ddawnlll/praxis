// @praxis/kernel — Evidence Types
// EvidenceRecordV01, ChangedFile, EvidenceLedgerReadResult, EvidenceGateInput types.

import type { Diagnostic } from '@praxis/contracts';
import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type { GateVerdictValue, PlanLockV01 } from '../types';

/** Canonical evidence version for v0.1. */
export const EVIDENCE_VERSION_V01 = 'praxis-evidence/v0.1' as const;

/** Supported evidence types — normalized, no colon-description enum values. */
export type EvidenceTypeV01 =
  | 'diff'
  | 'source'
  | 'wiring'
  | 'command'
  | 'test_output'
  | 'runtime_probe'
  | 'schema_validation'
  | 'manual_review'
  | 'llm_advisory'
  | 'report'
  | 'changed_file'
  | 'divergence_file'
  | 'divergence_tool'
  | 'divergence_output';

/** Evidence source identifiers. */
export type EvidenceSourceV01 =
  | 'kernel'
  | 'contracts'
  | 'hook'
  | 'cli'
  | 'agent_claim'
  | 'manual'
  | 'test'
  | 'external';

/**
 * Evidence accountability rung — how trustworthy is this evidence source?
 *
 * - AGENT_AUTHORED (lowest): the agent authored this evidence (e.g. self-report,
 *   narrative claim). Can never alone produce PASS/PASS.
 * - OS_RECORDED (medium): the OS/runtime recorded this automatically (e.g.
 *   exit codes, file hashes, process output). Deterministic and verifiable.
 * - THIRD_PARTY (highest): an independent third party attested this evidence
 *   (e.g. CI system, signed external attestation, cryptographic receipt).
 */
export type EvidenceRungV01 =
  | 'AGENT_AUTHORED'
  | 'OS_RECORDED'
  | 'THIRD_PARTY';

/** Changed file status. */
export type ChangedFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'unknown';

/** A single changed file record. */
export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  oldPath?: string;
  evidenceTypes?: EvidenceTypeV01[];
}

/** A single evidence record in the JSONL ledger. Matches ACCP P3 spec. */
export interface EvidenceRecordV01 {
  evidenceVersion: typeof EVIDENCE_VERSION_V01;
  recordId: string;
  attemptId: string;
  planId: string;
  timestamp: string;
  type: EvidenceTypeV01;
  source: EvidenceSourceV01;
  /** Accountability rung — auto-derived from source if not explicitly set. */
  rung?: EvidenceRungV01;
  taskId?: string;
  criterionId?: string;
  path?: string;
  paths?: string[];
  changedFile?: ChangedFile;
  status?: string;
  summary?: string;
  hash?: string;
  metadata?: Record<string, unknown>;
}

/** Result of reading an evidence ledger JSONL file. */
export interface EvidenceLedgerReadResult {
  ok: boolean;
  records: EvidenceRecordV01[];
  diagnostics: Diagnostic[];
  /** Number of blank lines skipped during parse. */
  blankLinesSkipped: number;
  /** Total lines processed (including blank). */
  totalLines: number;
}

/** Deterministic evidence sources. */
export const DETERMINISTIC_SOURCES: ReadonlySet<EvidenceSourceV01> = new Set([
  'kernel',
  'contracts',
  'hook',
  'cli',
  'test',
]);

/** Weak/claim-only evidence sources. */
export const WEAK_SOURCES: ReadonlySet<EvidenceSourceV01> = new Set([
  'agent_claim',
  'manual',
]);

/** Divergence evidence types — presence causes FAIL. */
export const DIVERGENCE_TYPES: ReadonlySet<EvidenceTypeV01> = new Set([
  'divergence_file',
  'divergence_tool',
  'divergence_output',
]);

/** Bookkeeping evidence types that are always allowed even if not in plan.evidence.requiredEvidenceTypes. */
export const BOOKKEEPING_TYPES: ReadonlySet<EvidenceTypeV01> = new Set([
  'changed_file',
  'divergence_file',
  'divergence_tool',
  'divergence_output',
]);

/**
 * Map an evidence source to its accountability rung.
 *
 * - AGENT_AUTHORED: agent_claim, manual — the agent wrote this evidence.
 * - OS_RECORDED: kernel, contracts, hook, cli, test — deterministic system records.
 * - THIRD_PARTY: external — independently attested by a third party.
 */
export function sourceToRung(source: EvidenceSourceV01): EvidenceRungV01 {
  switch (source) {
    case 'kernel':
    case 'contracts':
    case 'hook':
    case 'cli':
    case 'test':
      return 'OS_RECORDED';
    case 'agent_claim':
    case 'manual':
      return 'AGENT_AUTHORED';
    case 'external':
      return 'THIRD_PARTY';
  }
}

/**
 * Resolve the effective rung for an evidence record.
 * Returns the explicit `rung` field if set, otherwise derives from source.
 */
export function resolveRung(record: EvidenceRecordV01): EvidenceRungV01 {
  if (record.rung) return record.rung;
  return sourceToRung(record.source);
}

/**
 * believe_under_floor — structural evidence sufficiency rule.
 *
 * OS_RECORDED veya THIRD_PARTY seviyesinde en az bir evidence kaydı
 * olmadan, PASS kararı verilemez. Sadece AGENT_AUTHORED evidence
 * varsa, en fazla HOLD alınabilir.
 *
 * Returns:
 *   - canBelieve: true if at least one OS_RECORDED or THIRD_PARTY record exists
 *   - reason: why belief is denied (if applicable)
 */
export function believeUnderFloor(
  records: EvidenceRecordV01[],
): { canBelieve: boolean; reason?: string } {
  let hasAuthoritative = false;
  let hasAgentOnly = false;

  for (const r of records) {
    const rung = resolveRung(r);
    if (rung === 'OS_RECORDED' || rung === 'THIRD_PARTY') {
      hasAuthoritative = true;
    }
    if (rung === 'AGENT_AUTHORED') {
      hasAgentOnly = true;
    }
  }

  if (hasAuthoritative) {
    return { canBelieve: true };
  }

  if (hasAgentOnly) {
    return {
      canBelieve: false,
      reason: 'Only AGENT_AUTHORED evidence found. At least one OS_RECORDED or THIRD_PARTY record is required for PASS. This prevents self-reported claims from being treated as verified.',
    };
  }

  // No evidence at all — can't believe but also not a rejection
  return { canBelieve: false, reason: 'No evidence records found.' };
}

/** Input for EvidenceGate. */
export interface EvidenceGateInput {
  plan: PlanSpecV01;
  hashes: PlanHashes;
  attemptId: string;
  evidenceLedgerPath?: string;
  evidenceRecords?: EvidenceRecordV01[];
  changedFiles?: ChangedFile[];
  repoRoot?: string;
  lock?: PlanLockV01;
  /** Optional HMAC secret for PEL-1 attestation verification.
   *  When provided, deterministic-source evidence records must have valid
   *  DSSE envelope signatures. Unattested deterministic records produce HOLD. */
  attestationSecret?: string;
}

/** EvidenceGate result extends the GateVerdict shape. */
export interface EvidenceGateResult {
  gateName: 'EvidenceGate';
  verdict: GateVerdictValue;
  reasonCodes: string[];
  failedCriteriaIds: string[];
  evidenceRefs: string[];
  attemptId: string;
  timestamp: string;
  repairHint?: string;
  diagnostics: Diagnostic[];
  /** Number of evidence records parsed. */
  evidenceCount: number;
  /** List of files that triggered namespace violations. */
  forbiddenFilesTouched: string[];
  /** Files changed outside allowed namespace. */
  namespaceViolations: string[];
  /** Whether diff evidence is empty for implementation tasks. */
  diffEmpty: boolean;
  /** Plan carried forward for downstream gates. */
  plan?: PlanSpecV01;
  /** Hashes carried forward. */
  hashes?: PlanHashes;
  /** Lock carried forward. */
  lock?: PlanLockV01;
  /** Parsed evidence records (for downstream consumption). */
  evidenceRecords?: EvidenceRecordV01[];
}

/** Result of runP3Kernel. */
export interface KernelP3Result {
  ok: boolean;
  verdict: GateVerdictValue;
  attemptId: string;
  gateVerdicts: (import('../types').GateVerdict | EvidenceGateResult)[];
  startedAt: string;
  finishedAt: string;
  plan?: PlanSpecV01;
  hashes?: PlanHashes;
  lock?: PlanLockV01;
  evidence?: EvidenceGateResult;
  diagnostics: Diagnostic[];
}
