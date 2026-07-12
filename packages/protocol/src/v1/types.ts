// @praxis/protocol — praxis-protocol/v1 type definitions
//
// All types are derived directly from the JSON Schemas in
// packages/protocol/src/schemas/. They are TypeScript mirrors only —
// the schema is the source of truth, validated by Ajv at every entry point.

export type ProtocolVersion = 'praxis-protocol/v1';

export type EnvelopeKind =
  | 'capability.handshake'
  | 'verify.request'
  | 'verify.response'
  | 'promote.request'
  | 'promote.response'
  | 'receipt.audit'
  | 'kill.signal'
  | 'shadow.report';

export type Capability =
  | 'verify.cold'
  | 'verify.daemon'
  | 'promote.authority'
  | 'receipt.issue'
  | 'receipt.consume'
  | 'kill.authority'
  | 'shadow.observe'
  | 'policy.hepheastus.v0.6';

export type BlastRadius = 'sandbox' | 'repo' | 'workspace' | 'staging' | 'production';

export type Verdict = 'PASS' | 'HOLD' | 'FAIL';

export type GateName =
  | 'admission'
  | 'integrity'
  | 'scope'
  | 'architecture'
  | 'effect'
  | 'recovery'
  | 'finalReceipt'
  | 'hermeticExec';

export type EvidenceKind =
  | 'command.stdout'
  | 'command.stderr'
  | 'command.exit'
  | 'command.timedOut'
  | 'test.result'
  | 'coverage.line'
  | 'lint.report'
  | 'typecheck.report'
  | 'fs.diff'
  | 'policy.decision'
  | 'kill.signal'
  | 'promotion.event';

export interface Identity {
  identityId: string;
  keyId: string;
}

export interface ProtocolEnvelope<P = unknown> {
  protocolVersion: ProtocolVersion;
  envelopeKind: EnvelopeKind;
  sender: Identity;
  capabilities: Capability[];
  issuedAt: string;
  expiresAt: string | null;
  nonce: string;
  payload: P;
}

export interface EffectRule {
  allowed: boolean;
  requiresCompensationPlan: boolean;
  maxSteps?: number | null;
}

export interface VerificationPolicy {
  schemaVersion: ProtocolVersion;
  policyId: string;
  blastRadius: BlastRadius;
  effectClasses: {
    reversible: EffectRule;
    compensable: EffectRule;
    irreversible: EffectRule;
  };
  authority: {
    requiredIdentityId: string;
    humanApprovalRequired: boolean;
  };
  scope?: {
    allowedGlobs?: string[];
    forbiddenGlobs?: string[];
  };
  commands?: {
    exactAllowed?: string[];
    hardDenied?: string[];
  };
}

export interface CandidateManifest {
  schemaVersion: ProtocolVersion;
  candidateId: string;
  policyId: string;
  baseHash: string; // sha256 hex, 64 chars
  intent: string;
  submittedBy: Identity;
  submittedAt: string;
  idempotencyKey?: string | null;
  rollbackPointer?: string | null;
  labels?: Record<string, string>;
}

export interface EvidenceRecord {
  recordId: string;
  kind: EvidenceKind;
  capturedAt: string;
  commandId?: string | null;
  payload: Record<string, unknown>;
}

export interface Attestation {
  runnerDigest: string; // "<algo>:<sha256>"
  toolchain: {
    language: string;
    compiler: string;
    version: string;
  };
  dependencyLocks?: string[];
  environmentFingerprint?: string;
}

export interface EvidenceBundle {
  schemaVersion: ProtocolVersion;
  candidateId: string;
  merkleRoot: string; // sha256 hex
  attestation: Attestation;
  records: EvidenceRecord[];
}

export interface GateResult {
  gate: GateName;
  verdict: Verdict;
  reasonCode: string;
  producedAt: string;
}

export interface ReceiptSignature {
  algorithm: 'ed25519';
  value: string; // hex, 128 chars (64 bytes)
  signedPayloadDigest: string; // sha256 hex of the signed canonical payload
}

export interface VerificationReceipt {
  schemaVersion: ProtocolVersion;
  receiptId: string;
  candidateId: string;
  policyId: string;
  baseHash: string;
  merkleRoot: string;
  gateResults: GateResult[];
  issuedAt: string;
  expiresAt: string;
  singleUseKeyId: string;
  consumedAt?: string | null;
  issuer: Identity;
  signature: ReceiptSignature;
}
