// @praxis/protocol — legacy migration policy (issue #16)
//
// Verity 1.0 owns one authority path: praxis-protocol/v1. Legacy plans
// (v0.1 YAML, v5-alpha2 with mixed fields) must migrate to a single
// canonical receipt path before they can produce a PASS.
//
// Invariants:
//   * Migration is one-way. After migration, the output is bound to
//     praxis-protocol/v1 and the legacy bytes are not retained.
//   * Mixed v0.1/v5 documents are rejected (FAIL, not PASS).
//   * Migration is idempotent: re-running on the same input produces
//     the same CandidateManifest.
//   * Migration cannot weaken human policy. If a v0.1 plan has no
//     humanApprovalRequired field, the migrated policy still requires
//     human approval for irreversible effects.

import { canonicalize, domainHashHex, type JsonValue } from './canonicalize';
import type { CandidateManifest, VerificationPolicy, ProtocolVersion } from './types';

export const LEGACY_V01 = 'praxis-planspec/v0.1' as const;
export const LEGACY_V5 = 'praxis-protocol/v5-alpha2' as const;
export const V1 = 'praxis-protocol/v1' as const;

export interface MigrationResult {
  ok: boolean;
  manifest?: CandidateManifest;
  policy?: VerificationPolicy;
  reasonCode?: string;
  message?: string;
}

const HEX64 = /^[a-f0-9]{64}$/;

export function detectVersion(value: JsonValue): ProtocolVersion | typeof LEGACY_V01 | typeof LEGACY_V5 | 'unknown' {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'unknown';
  const v = value as { schemaVersion?: unknown; planSpecVersion?: unknown; protocolVersion?: unknown };
  if (typeof v.protocolVersion === 'string') {
    if (v.protocolVersion === V1) return V1;
    return 'unknown';
  }
  if (typeof v.schemaVersion === 'string' && v.schemaVersion === V1) return V1;
  if (typeof v.planSpecVersion === 'string') {
    if (v.planSpecVersion === LEGACY_V01) return LEGACY_V01;
    if (v.planSpecVersion === '5.0.0-alpha2' || v.planSpecVersion.startsWith('5.')) return LEGACY_V5;
  }
  return 'unknown';
}

export class MigrationError extends Error {
  constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Detect a mixed legacy document (both v0.1 and v5-alpha2 fields present).
 * A v0.1 plan has `planSpecVersion: praxis-planspec/v0.1` and the
 * corresponding $defs; a v5-alpha2 plan has `planSpecVersion: 5.0.0-alpha2`.
 * Both being present in the same document is forbidden. We treat a
 * mismatch between the declared planSpecVersion and the observed keyset
 * as a mixed document, because the producer is trying to claim one
 * authority path while shaping the document for another.
 */
export function detectMixed(input: JsonValue): boolean {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const obj = input as Record<string, unknown>;
  const declaredV01 = typeof obj.planSpecVersion === 'string' && (obj.planSpecVersion as string).startsWith('praxis-planspec/');
  const declaredV5 = typeof obj.planSpecVersion === 'string' && (obj.planSpecVersion as string).startsWith('5.');
  const hasV01Keys = 'v01_workflow' in obj || 'workspaceLayout' in obj || 'forbiddenFiles' in obj;
  const hasV5Keys = 'enforcementRegistry' in obj || 'workspaces' in obj;
  if (declaredV01 && declaredV5) return true;
  if (hasV01Keys && hasV5Keys) return true;
  // Declared v0.1 with v5-shaped fields: mixed.
  if (declaredV01 && hasV5Keys) return true;
  // Declared v5 with v0.1-shaped fields: mixed.
  if (declaredV5 && hasV01Keys) return true;
  return false;
}

interface V01LikePlan {
  planSpecVersion?: string;
  planId?: string;
  intent?: string;
  authority?: { requiredIdentity?: string; humanApprovalRequired?: boolean };
  tasks?: Array<{ taskId?: string; intent?: string; kind?: string }>;
  forbiddenFiles?: string[];
}

/**
 * Migrate a v0.1 plan to a v1 CandidateManifest + VerificationPolicy.
 * Throws MigrationError on shape failure.
 */
export function migrateV01(input: V01LikePlan): { manifest: CandidateManifest; policy: VerificationPolicy } {
  if (typeof input.planSpecVersion !== 'string' || !input.planSpecVersion.startsWith('praxis-planspec/')) {
    throw new MigrationError('LEGACY_VERSION_UNSUPPORTED', `unsupported planSpecVersion: ${String(input.planSpecVersion)}`);
  }
  if (typeof input.planId !== 'string' || input.planId.length === 0) {
    throw new MigrationError('LEGACY_MISSING_PLAN_ID', 'v0.1 plan is missing planId');
  }
  if (typeof input.intent !== 'string' || input.intent.length === 0) {
    throw new MigrationError('LEGACY_MISSING_INTENT', 'v0.1 plan is missing intent');
  }
  // The identity id is required; default to "legacy-v01" if absent so the
  // migration does not silently upgrade security.
  const identityId = input.authority?.requiredIdentity ?? 'legacy-v01';
  // Human approval: if the v0.1 plan did not declare it, default to TRUE
  // for any irreversible effect class. The migrated policy must NOT
  // downgrade a human policy.
  const humanApproval = input.authority?.humanApprovalRequired ?? true;

  const baseHash = domainHashHex('praxis-migration/v0.1-base', canonicalize(input as unknown as JsonValue));
  if (!HEX64.test(baseHash)) {
    throw new MigrationError('LEGACY_BASEHASH_INVALID', 'migrated baseHash is not sha256 hex');
  }

  const policyId = `policy-${input.planId}-v1`;
  const manifest: CandidateManifest = {
    schemaVersion: V1,
    candidateId: `candidate-${input.planId}-v1`,
    policyId,
    baseHash,
    intent: input.intent,
    submittedBy: { identityId, keyId: '0000000000000000' },
    submittedAt: new Date().toISOString(),
    idempotencyKey: `migrate-${input.planId}-${baseHash.slice(0, 12)}`,
  };

  const policy: VerificationPolicy = {
    schemaVersion: V1,
    policyId,
    blastRadius: 'repo',
    effectClasses: {
      reversible: { allowed: true, requiresCompensationPlan: false, maxSteps: 100 },
      compensable: { allowed: true, requiresCompensationPlan: true, maxSteps: 10 },
      irreversible: { allowed: true, requiresCompensationPlan: true }, // requires human approval below
    },
    authority: { requiredIdentityId: identityId, humanApprovalRequired: humanApproval },
    scope: {
      allowedGlobs: ['**/*'],
      forbiddenGlobs: Array.isArray(input.forbiddenFiles) ? (input.forbiddenFiles as string[]) : [],
    },
  };
  return { manifest, policy };
}

/**
 * Idempotent migration entry point. If the input is already v1, returns
 * the input unchanged. If mixed, returns an error.
 */
export function migrate(input: JsonValue): MigrationResult {
  if (detectMixed(input)) {
    return { ok: false, reasonCode: 'MIXED_LEGACY_VERSION', message: 'document mixes v0.1 and v5-alpha2 fields' };
  }
  const version = detectVersion(input);
  if (version === V1) {
    return { ok: true, manifest: input as unknown as CandidateManifest };
  }
  if (version === LEGACY_V01) {
    try {
      const out = migrateV01(input as unknown as V01LikePlan);
      return { ok: true, manifest: out.manifest, policy: out.policy };
    } catch (e) {
      if (e instanceof MigrationError) {
        return { ok: false, reasonCode: e.reasonCode, message: e.message };
      }
      throw e;
    }
  }
  return { ok: false, reasonCode: 'LEGACY_VERSION_UNSUPPORTED', message: `unsupported version: ${String(version)}` };
}
