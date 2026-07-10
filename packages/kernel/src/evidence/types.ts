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
  | 'test';

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
