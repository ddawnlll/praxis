// @praxis/verity-qual — release gate tests

import { describe, test, expect } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateReleaseGate, writeDenyReport, type ReplayAggregate, type ShadowSloReport } from '../src/releaseGate';

async function temp(): Promise<string> {
  return await fs.mkdtemp(join(tmpdir(), 'verity-release-'));
}

function replayOk(): ReplayAggregate {
  return { iterations: 300000, falsePass: 0, crashes: 0, determinismViolations: 0, fingerprint: 'replay-fp-1' };
}
function replayFailsFalsePass(): ReplayAggregate {
  return { iterations: 300000, falsePass: 1, crashes: 0, determinismViolations: 0, fingerprint: 'replay-fp-bad' };
}
function replayTooFew(): ReplayAggregate {
  return { iterations: 100000, falsePass: 0, crashes: 0, determinismViolations: 0, fingerprint: 'replay-fp-small' };
}
function shadowOk(): ShadowSloReport {
  return { periodDays: 30, incidentCount: 0, criticalIncidentCount: 0, shadowVerdicts: 1000, shadowReceipts: 1000, fingerprint: 'shadow-fp-1' };
}
function shadowFailsCritical(): ShadowSloReport {
  return { periodDays: 30, incidentCount: 1, criticalIncidentCount: 1, shadowVerdicts: 1000, shadowReceipts: 1000, fingerprint: 'shadow-fp-bad' };
}
function shadowTooShort(): ShadowSloReport {
  return { periodDays: 7, incidentCount: 0, criticalIncidentCount: 0, shadowVerdicts: 100, shadowReceipts: 100, fingerprint: 'shadow-fp-small' };
}

async function writeJson(path: string, data: unknown): Promise<string> {
  await fs.writeFile(path, JSON.stringify(data), 'utf-8');
  return path;
}

describe('evaluateReleaseGate', () => {
  test('DENY when no artifacts provided', async () => {
    const r = evaluateReleaseGate({});
    expect(r.decision).toBe('DENY');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  test('DENY when artifacts are missing on disk', async () => {
    const r = evaluateReleaseGate({ replayArtifact: '/no/such/path', shadowArtifact: '/no/such/path', releaseManifest: '/no/such/path' });
    expect(r.decision).toBe('DENY');
    expect(r.reasons.some((x) => x.includes('replayArtifact missing'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('shadowArtifact missing'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('releaseManifest missing'))).toBe(true);
  });
  test('DENY when replay has falsePass > 0', async () => {
    const dir = await temp();
    const p = await writeJson(join(dir, 'replay.json'), replayFailsFalsePass());
    const r = evaluateReleaseGate({ replayArtifact: p });
    expect(r.decision).toBe('DENY');
    expect(r.reasons.some((x) => x.includes('falsePass=1'))).toBe(true);
  });
  test('DENY when replay iterations < 300000', async () => {
    const dir = await temp();
    const p = await writeJson(join(dir, 'replay.json'), replayTooFew());
    const r = evaluateReleaseGate({ replayArtifact: p });
    expect(r.decision).toBe('DENY');
    expect(r.reasons.some((x) => x.includes('iterations=100000'))).toBe(true);
  });
  test('DENY when shadow has critical incidents', async () => {
    const dir = await temp();
    const rp = await writeJson(join(dir, 'replay.json'), replayOk());
    const sp = await writeJson(join(dir, 'shadow.json'), shadowFailsCritical());
    const r = evaluateReleaseGate({ replayArtifact: rp, shadowArtifact: sp });
    expect(r.decision).toBe('DENY');
    expect(r.reasons.some((x) => x.includes('criticalIncidentCount=1'))).toBe(true);
  });
  test('DENY when shadow periodDays < 30', async () => {
    const dir = await temp();
    const rp = await writeJson(join(dir, 'replay.json'), replayOk());
    const sp = await writeJson(join(dir, 'shadow.json'), shadowTooShort());
    const r = evaluateReleaseGate({ replayArtifact: rp, shadowArtifact: sp });
    expect(r.decision).toBe('DENY');
    expect(r.reasons.some((x) => x.includes('periodDays=7'))).toBe(true);
  });
  test('ALLOW when all artifacts satisfy the SLOs and manifest is signed', async () => {
    const dir = await temp();
    const rp = await writeJson(join(dir, 'replay.json'), replayOk());
    const sp = await writeJson(join(dir, 'shadow.json'), shadowOk());
    const mp = await writeJson(join(dir, 'manifest.json'), { signedBy: 'release-key', fingerprint: 'release-fp-1' });
    const r = evaluateReleaseGate({ replayArtifact: rp, shadowArtifact: sp, releaseManifest: mp });
    expect(r.decision).toBe('ALLOW');
    expect(r.reasons).toEqual([]);
    expect(r.evidenceRefs.length).toBe(3);
  });
  test('forceDeny wins over all artifacts', async () => {
    const dir = await temp();
    const rp = await writeJson(join(dir, 'replay.json'), replayOk());
    const sp = await writeJson(join(dir, 'shadow.json'), shadowOk());
    const mp = await writeJson(join(dir, 'manifest.json'), { signedBy: 'k', fingerprint: 'f' });
    const r = evaluateReleaseGate({ replayArtifact: rp, shadowArtifact: sp, releaseManifest: mp, forceDeny: true });
    expect(r.decision).toBe('DENY');
  });
  test('writeDenyReport produces a human-readable report', () => {
    const out = writeDenyReport({ decision: 'DENY', reasons: ['r1', 'r2'], evidenceRefs: ['e1'] });
    expect(out).toContain('DENY');
    expect(out).toContain('r1');
    expect(out).toContain('r2');
    expect(out).toContain('e1');
  });
  test('writeDenyReport says ALLOW when allowed', () => {
    const out = writeDenyReport({ decision: 'ALLOW', reasons: [], evidenceRefs: [] });
    expect(out).toContain('ALLOW');
  });
  test('malformed replay JSON is DENY', async () => {
    const dir = await temp();
    const p = join(dir, 'replay.json');
    await fs.writeFile(p, 'not json', 'utf-8');
    const r = evaluateReleaseGate({ replayArtifact: p });
    expect(r.decision).toBe('DENY');
    expect(r.reasons.some((x) => x.includes('not valid JSON'))).toBe(true);
  });
});
