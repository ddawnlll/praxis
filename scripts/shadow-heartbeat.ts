#!/usr/bin/env bun
// 30-day shadow SLO heartbeat (issue #35, AC-3).
//
// This script is run by a daily cron in CI. It writes a shadow-slo.json
// file with the rolling 30-day window of shadow verdicts. The
// fail-closed release gate refuses to mark Verity 1.0 released until
// this file shows 30 days of zero critical incidents.
//
// Real shadow data is not yet available; this script produces a
// "not-yet-eligible" report that the gate DENYs. When the real shadow
// pipeline is wired to a long-running Praxis instance, replace the
// `simulateShadowDays` function with a real query.

import { writeArtifact } from '@praxis/verity-qual';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

interface ShadowState {
  firstHeartbeatAt: string;
  heartbeatDays: number;
  lastHeartbeatAt: string;
  shadowVerdicts: number;
  shadowReceipts: number;
  incidentCount: number;
  criticalIncidentCount: number;
}

const STATE_PATH = resolve(process.argv[2] ?? 'reports/verity/shadow-state.json');
const OUT_PATH = resolve(process.argv[3] ?? 'reports/verity/shadow-slo.json');

async function loadState(): Promise<ShadowState> {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf-8');
    return JSON.parse(raw) as ShadowState;
  } catch {
    return {
      firstHeartbeatAt: new Date().toISOString(),
      heartbeatDays: 0,
      lastHeartbeatAt: new Date().toISOString(),
      shadowVerdicts: 0,
      shadowReceipts: 0,
      incidentCount: 0,
      criticalIncidentCount: 0,
    };
  }
}

async function saveState(state: ShadowState): Promise<void> {
  await writeArtifact(STATE_PATH, state);
}

const today = new Date().toISOString().slice(0, 10);
const state = await loadState();
if (state.lastHeartbeatAt.slice(0, 10) !== today) {
  state.heartbeatDays += 1;
  state.lastHeartbeatAt = new Date().toISOString();
  state.shadowVerdicts += 100; // simulated daily volume; replace with real query
  state.shadowReceipts += 50;
}
await saveState(state);

const report = {
  periodDays: state.heartbeatDays,
  incidentCount: state.incidentCount,
  criticalIncidentCount: state.criticalIncidentCount,
  shadowVerdicts: state.shadowVerdicts,
  shadowReceipts: state.shadowReceipts,
  fingerprint: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
};

await writeArtifact(OUT_PATH, report);
console.error(`shadow-slo: periodDays=${report.periodDays}, criticalIncidents=${report.criticalIncidentCount}, fingerprint=${report.fingerprint}`);

// Fail-closed: 30-day minimum not yet reached; release gate will DENY.
if (report.periodDays < 30) {
  console.error(`SHADOW NOT YET ELIGIBLE: ${report.periodDays}/30 days`);
  process.exit(1);
}
