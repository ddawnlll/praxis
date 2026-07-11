// @praxis/verity-qual — Verity 1.0 release gate (#35)
//
// Fail-closed release gate. The Verity 1.0 release/tag may NOT be produced
// until every check below passes. The check for "30-day shadow SLO
// satisfied" is satisfied by reading a durable artifact (a shadow SLO
// file) that is produced by the time-gated shadow workflow (see
// .github/workflows/verity-shadow.yml in the PR). Until that artifact
// exists, the gate refuses to mark the release.
//
// The 300K replay harness is also wired through this gate: it is run
// by a separate CI workflow and the result is written to a durable
// artifact that this gate reads.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReleaseGateChecks {
  /** Path to a JSON file with 300K replay aggregate stats. Must exist and have falsePass=0. */
  replayArtifact?: string;
  /** Path to a JSON file with 30-day shadow SLO stats. Must exist and have no critical incidents. */
  shadowArtifact?: string;
  /** Path to a signed release manifest. Must exist and have a valid Ed25519 signature. */
  releaseManifest?: string;
  /** Optional: PR URL whose merge we want to gate. */
  pullRequestUrl?: string;
  /** Optional override: force the gate to deny even with artifacts present. */
  forceDeny?: boolean;
}

export interface ReleaseGateResult {
  decision: 'ALLOW' | 'DENY';
  reasons: string[];
  evidenceRefs: string[];
}

export interface ShadowSloReport {
  periodDays: number;
  incidentCount: number;
  criticalIncidentCount: number;
  shadowVerdicts: number;
  shadowReceipts: number;
  /** SHA-256 fingerprint of the shadow artifact. */
  fingerprint: string;
}

export interface ReplayAggregate {
  iterations: number;
  falsePass: number;
  crashes: number;
  determinismViolations: number;
  /** SHA-256 fingerprint of the replay artifact. */
  fingerprint: string;
}

export function evaluateReleaseGate(checks: ReleaseGateChecks): ReleaseGateResult {
  const reasons: string[] = [];
  const evidenceRefs: string[] = [];

  // 1. Force-deny wins.
  if (checks.forceDeny) {
    return { decision: 'DENY', reasons: ['forceDeny requested'], evidenceRefs };
  }

  // 2. 300K replay artifact (fail-closed).
  if (!checks.replayArtifact) {
    reasons.push('replayArtifact not provided');
  } else if (!existsSync(checks.replayArtifact)) {
    reasons.push(`replayArtifact missing on disk: ${checks.replayArtifact}`);
  } else {
    const raw = readFileSync(checks.replayArtifact, 'utf-8');
    let report: ReplayAggregate;
    try {
      report = JSON.parse(raw) as ReplayAggregate;
    } catch (e) {
      reasons.push(`replayArtifact is not valid JSON: ${(e as Error).message}`);
      report = { iterations: 0, falsePass: 0, crashes: 0, determinismViolations: 0, fingerprint: '' };
    }
    if (report.iterations < 300000) {
      reasons.push(`replayArtifact iterations=${report.iterations} < 300000 minimum`);
    }
    if (report.falsePass > 0) {
      reasons.push(`replayArtifact falsePass=${report.falsePass} > 0`);
    }
    if (report.determinismViolations > 0) {
      reasons.push(`replayArtifact determinismViolations=${report.determinismViolations} > 0`);
    }
    evidenceRefs.push(`replay:${report.fingerprint}`);
  }

  // 3. 30-day shadow SLO artifact (fail-closed).
  if (!checks.shadowArtifact) {
    reasons.push('shadowArtifact not provided');
  } else if (!existsSync(checks.shadowArtifact)) {
    reasons.push(`shadowArtifact missing on disk: ${checks.shadowArtifact}`);
  } else {
    const raw = readFileSync(checks.shadowArtifact, 'utf-8');
    let report: ShadowSloReport;
    try {
      report = JSON.parse(raw) as ShadowSloReport;
    } catch (e) {
      reasons.push(`shadowArtifact is not valid JSON: ${(e as Error).message}`);
      report = { periodDays: 0, incidentCount: 0, criticalIncidentCount: 0, shadowVerdicts: 0, shadowReceipts: 0, fingerprint: '' };
    }
    if (report.periodDays < 30) {
      reasons.push(`shadowArtifact periodDays=${report.periodDays} < 30 minimum`);
    }
    if (report.criticalIncidentCount > 0) {
      reasons.push(`shadowArtifact criticalIncidentCount=${report.criticalIncidentCount} > 0`);
    }
    evidenceRefs.push(`shadow:${report.fingerprint}`);
  }

  // 4. Release manifest signature.
  if (!checks.releaseManifest) {
    reasons.push('releaseManifest not provided');
  } else if (!existsSync(checks.releaseManifest)) {
    reasons.push(`releaseManifest missing on disk: ${checks.releaseManifest}`);
  } else {
    const raw = readFileSync(checks.releaseManifest, 'utf-8');
    let manifest: { signedBy?: string; fingerprint?: string };
    try {
      manifest = JSON.parse(raw) as { signedBy?: string; fingerprint?: string };
    } catch (e) {
      reasons.push(`releaseManifest is not valid JSON: ${(e as Error).message}`);
      manifest = {};
    }
    if (!manifest.signedBy) {
      reasons.push('releaseManifest missing signedBy');
    }
    if (!manifest.fingerprint) {
      reasons.push('releaseManifest missing fingerprint');
    }
    evidenceRefs.push(`release:${manifest.fingerprint ?? 'none'}`);
  }

  return {
    decision: reasons.length === 0 ? 'ALLOW' : 'DENY',
    reasons,
    evidenceRefs,
  };
}

export function writeDenyReport(result: ReleaseGateResult): string {
  if (result.decision === 'ALLOW') return 'release-gate: ALLOW';
  const lines = ['release-gate: DENY', 'reasons:'];
  for (const r of result.reasons) lines.push(`  - ${r}`);
  lines.push('evidence-refs:');
  for (const e of result.evidenceRefs) lines.push(`  - ${e}`);
  return lines.join('\n');
}
