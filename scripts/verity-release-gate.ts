#!/usr/bin/env bun
// Verity 1.0 fail-closed release gate (issue #35, AC-1/2/3/4).
//
// Reads replay + shadow + manifest artifacts and refuses to allow the
// release if any SLO is violated. The 30-day shadow and 300K replay
// are produced by separate CI workflows and persisted as artifacts;
// until those artifacts exist (which requires real wall-clock time),
// this script DENIES the release.

import { evaluateReleaseGate, writeDenyReport } from '@praxis/verity-qual';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

const replay = arg('--replay');
const shadow = arg('--shadow');
const manifest = arg('--manifest');

if (!replay && !shadow && !manifest) {
  console.error('Usage: bun run scripts/verity-release-gate.ts [--replay PATH] [--shadow PATH] [--manifest PATH]');
  process.exit(2);
}

const result = evaluateReleaseGate({
  replayArtifact: replay,
  shadowArtifact: shadow,
  releaseManifest: manifest,
});

if (result.decision === 'ALLOW') {
  console.log('release-gate: ALLOW');
  for (const r of result.evidenceRefs) console.log(`  evidence: ${r}`);
  process.exit(0);
} else {
  console.error(writeDenyReport(result));
  process.exit(1);
}
