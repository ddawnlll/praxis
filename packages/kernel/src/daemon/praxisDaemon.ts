// @praxis/kernel — Praxis Daemon
// Long-lived process for the PRAXIS Truth Kernel.
//
// Keeps warm state across invocations:
// - Parsed PlanSpec (no re-parse)
// - Lock state (no re-read)
// - Evidence index (O(1) criterion lookup)
// - Gate result cache (skip if inputs unchanged)
//
// The daemon is auto-spawned by the CLI on first `--daemon` invocation
// and communicates via TCP localhost (cross-platform).
// It auto-shuts down after a configurable idle timeout.

import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { runSchemaGate } from '../gates/schemaGate';
import { runLockGate } from '../gates/lockGate';
import { runEvidenceGate } from '../gates/evidenceGate';
import { runWiringGate } from '../gates/wiringGate';
import { runExecGate } from '../gates/execGate';
import { runFinalGate } from '../gates/finalGate';
import { readEvidenceLedgerJsonl } from '../evidence/readEvidenceLedgerJsonl';
import type { PlanSpecV01, PlanHashes } from '@praxis/contracts';
import type { GateVerdict, GateVerdictValue, KernelResult, LockMode } from '../types';
import type { EvidenceRecordV01, EvidenceGateResult, EvidenceGateInput } from '../evidence/types';
import { createWarmState, mergeEvidence, type WarmState } from './state';
import { GateCache, CACHE_NAMESPACES } from './gateCache';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DaemonConfig {
  /** Port for TCP IPC. */
  port: number;
  /** Host to bind to. */
  host: string;
  /** Repository root path. */
  repoRoot: string;
  /** Idle timeout in ms before auto-shutdown (default 10 min). */
  idleTimeoutMs: number;
  /** PID file path for daemon lifecycle management. */
  pidFile: string;
}

const DEFAULT_CONFIG: DaemonConfig = {
  port: 0, // assigned by OS
  host: '127.0.0.1',
  repoRoot: process.cwd(),
  idleTimeoutMs: 600_000, // 10 minutes
  pidFile: '',
};

// ---------------------------------------------------------------------------
// Daemon Server
// ---------------------------------------------------------------------------

export interface DaemonServer {
  config: DaemonConfig;
  state: WarmState;
  start(): Promise<number>;
  stop(): void;
  handleVerify(request: VerifyRequest): Promise<VerifyResponse>;
  handleValidate(request: ValidateRequest): Promise<ValidateResponse>;
}

export interface VerifyRequest {
  planYaml: string;
  evidenceLedgerPath?: string;
  evidenceRecords?: EvidenceRecordV01[];
  changedFiles?: Array<{ path: string; status: string }>;
  lockMode?: LockMode;
  attemptId?: string;
  stopOnHold?: boolean;
  /** Gate filter: only run these gates (e.g., ['schema','lock','exec','final']). */
  gates?: string[];
  /** Parallelism for ExecGate commands. */
  parallel?: number;
}

export interface VerifyResponse {
  ok: boolean;
  verdict: GateVerdictValue;
  attemptId: string;
  gateCount: number;
  passedGates: number;
  heldGates: number;
  failedGates: number;
  cacheHitGates: number;
  gateResults: Array<{
    gateName: string;
    verdict: GateVerdictValue;
    reasonCodes: string[];
    cached: boolean;
  }>;
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  timeMs: number;
}

export interface ValidateRequest {
  planYaml: string;
}

export interface ValidateResponse {
  ok: boolean;
  verdict: GateVerdictValue;
  reasonCodes: string[];
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  timeMs: number;
}

/**
 * Create a Praxis daemon server.
 * The daemon holds warm state and serves verify/validate requests
 * over TCP IPC, with content-addressed gate caching.
 */
export function createDaemon(config: Partial<DaemonConfig> = {}): DaemonServer {
  const cfg: DaemonConfig = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.pidFile) {
    cfg.pidFile = resolve(cfg.repoRoot, '.praxis/daemon.pid');
  }

  const state = createWarmState(cfg.repoRoot);
  let server: Server | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reset the idle shutdown timer on each request. */
  function resetIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    if (cfg.idleTimeoutMs > 0) {
      idleTimer = setTimeout(() => {
        state.running = false;
        stop();
      }, cfg.idleTimeoutMs);
    }
  }

  /** Handle an incoming verify request on warm state. */
  async function handleVerify(req: VerifyRequest): Promise<VerifyResponse> {
    const start = performance.now();
    const attemptId = req.attemptId ?? `daemon-${Date.now()}`;
    const gateResults: VerifyResponse['gateResults'] = [];
    let cacheHits = 0;
    const allDiagnostics: Array<{ code: string; severity: string; message: string }> = [];
    let overallVerdict: GateVerdictValue = 'PASS';

    // --- Parse plan (or use cached) ---
    const planInputHash = GateCache.hashInputs(req.planYaml);
    const planCacheKey = CACHE_NAMESPACES.SCHEMA;

    if (state.plan && state.hashes) {
      // Check if plan actually changed
      const currentPlanHash = GateCache.hashInputs(req.planYaml);
      const cachedPlanHash = state.gateCache.get(CACHE_NAMESPACES.PIPELINE, 'plan:' + currentPlanHash);
      // We'll re-compute schema if plan changed, otherwise reuse cache
    }

    // SchemaGate
    let schemaVerdict: GateVerdict;
    const cachedSchema = state.gateCache.get(planCacheKey, planInputHash);
    if (cachedSchema && state.plan && state.hashes) {
      schemaVerdict = cachedSchema;
      cacheHits++;
    } else {
      schemaVerdict = runSchemaGate({ planYaml: req.planYaml, repoRoot: state.repoRoot });
      if (schemaVerdict.verdict === 'PASS' && schemaVerdict.plan && schemaVerdict.hashes) {
        state.plan = schemaVerdict.plan;
        state.hashes = schemaVerdict.hashes;
        state.gateCache.set(planCacheKey, planInputHash, schemaVerdict);
      }
    }

    gateResults.push({
      gateName: 'SchemaGate',
      verdict: schemaVerdict.verdict,
      reasonCodes: schemaVerdict.reasonCodes,
      cached: !!cachedSchema,
    });
    if (schemaVerdict.diagnostics) allDiagnostics.push(...schemaVerdict.diagnostics.map(d => ({
      code: d.code, severity: d.severity, message: d.message
    })));

    if (schemaVerdict.verdict === 'FAIL' || !state.plan || !state.hashes) {
      return buildResponse(overallVerdict, attemptId, gateResults, cacheHits, allDiagnostics, start);
    }

    // Gate filter: only run specified gates
    const gates = req.gates ?? ['schema', 'lock', 'evidence', 'wiring', 'exec', 'final'];

    // --- LockGate ---
    if (gates.includes('lock')) {
      const lockInputHash = GateCache.hashInputs(state.hashes.planHash, state.hashes.planHash);
      const cachedLock = state.gateCache.get(CACHE_NAMESPACES.LOCK, lockInputHash);
      let lockVerdict: GateVerdict;

      if (cachedLock) {
        lockVerdict = cachedLock;
        cacheHits++;
      } else {
        lockVerdict = runLockGate({
          plan: state.plan,
          hashes: state.hashes,
          mode: req.lockMode ?? 'verify_existing',
          attemptId,
        });
        if (lockVerdict.verdict === 'PASS') {
          state.gateCache.set(CACHE_NAMESPACES.LOCK, lockInputHash, lockVerdict);
        }
      }

      gateResults.push({
        gateName: 'LockGate',
        verdict: lockVerdict.verdict,
        reasonCodes: lockVerdict.reasonCodes,
        cached: !!cachedLock,
      });
      if (lockVerdict.diagnostics) allDiagnostics.push(...lockVerdict.diagnostics.map(d => ({
        code: d.code, severity: d.severity, message: d.message
      })));

      if (lockVerdict.verdict === 'FAIL') {
        overallVerdict = 'FAIL';
        return buildResponse('FAIL', attemptId, gateResults, cacheHits, allDiagnostics, start);
      }
    }

    // --- EvidenceGate ---
    let evidenceRecords: EvidenceRecordV01[] = [];
    if (gates.includes('evidence')) {
      // Read evidence incrementally using our index
      let newRecords: EvidenceRecordV01[] = [];
      let allRecords: EvidenceRecordV01[] = [];

      if (req.evidenceRecords && req.evidenceRecords.length > 0) {
        // Pre-loaded records: merge into our index incrementally
        const merged = mergeEvidence(state.evidenceIndex, state.evidenceCount, req.evidenceRecords);
        state.evidenceIndex = merged.index;
        state.evidenceCount = merged.count;
        // Collect all records for the gate
        for (const records of state.evidenceIndex.values()) {
          allRecords.push(...records);
        }
      } else if (req.evidenceLedgerPath) {
        // Full file read — but only process new records after the offset
        const readResult = readEvidenceLedgerJsonl(req.evidenceLedgerPath);
        if (readResult.ok && readResult.records.length > state.evidenceCount) {
          newRecords = readResult.records.slice(state.evidenceCount);
          const merged = mergeEvidence(state.evidenceIndex, state.evidenceCount, newRecords);
          state.evidenceIndex = merged.index;
          state.evidenceCount = merged.count;
          allRecords = readResult.records;
        } else if (readResult.ok) {
          // No new records — use existing index
          for (const records of state.evidenceIndex.values()) {
            allRecords.push(...records);
          }
        }
      }

      // Expose evidence records for FinalGate (fixes #3)
      evidenceRecords = allRecords;

      const evidenceInputHash = GateCache.hashInputs(
        state.hashes.acceptanceCriteriaHash,
        state.evidenceCount,
        JSON.stringify(req.changedFiles ?? []),
      );

      const cachedEvidence = state.gateCache.get(CACHE_NAMESPACES.EVIDENCE, evidenceInputHash);
      let evidenceVerdict: EvidenceGateResult | undefined;

      if (cachedEvidence) {
        evidenceVerdict = cachedEvidence as unknown as EvidenceGateResult;
        cacheHits++;
      } else {
        evidenceVerdict = runEvidenceGate({
          plan: state.plan,
          hashes: state.hashes,
          attemptId,
          evidenceRecords: allRecords.length > 0 ? allRecords : undefined,
          changedFiles: req.changedFiles as EvidenceGateInput['changedFiles'],
          repoRoot: state.repoRoot,
        });
        state.gateCache.set(CACHE_NAMESPACES.EVIDENCE, evidenceInputHash, evidenceVerdict as unknown as GateVerdict);
      }

      gateResults.push({
        gateName: 'EvidenceGate',
        verdict: evidenceVerdict.verdict,
        reasonCodes: evidenceVerdict.reasonCodes,
        cached: !!cachedEvidence,
      });
      if (evidenceVerdict.diagnostics) allDiagnostics.push(...evidenceVerdict.diagnostics.map(d => ({
        code: d.code, severity: d.severity, message: d.message
      })));

      if (evidenceVerdict.verdict === 'FAIL') {
        overallVerdict = 'FAIL';
        // Continue to FinalGate to provide full picture
      }
    }

    // --- WiringGate ---
    if (gates.includes('wiring')) {
      const wiringInputHash = GateCache.hashInputs(
        state.hashes.planHash,
        state.repoRoot,
      );
      // WiringGate reads the filesystem, so we also hash the changed files list
      const cachedWiring = state.gateCache.get(CACHE_NAMESPACES.WIRING, wiringInputHash);
      // WiringGate is filesystem-dependent, so we always run it but cache for same-state
      const wiringVerdict = runWiringGate({
        plan: state.plan,
        hashes: state.hashes,
        attemptId,
        repoRoot: state.repoRoot,
      });

      if (!cachedWiring) {
        state.gateCache.set(CACHE_NAMESPACES.WIRING, wiringInputHash, wiringVerdict as unknown as GateVerdict);
      }

      gateResults.push({
        gateName: 'WiringGate',
        verdict: wiringVerdict.verdict,
        reasonCodes: wiringVerdict.reasonCodes,
        cached: !!cachedWiring,
      });
      if (wiringVerdict.diagnostics) allDiagnostics.push(...wiringVerdict.diagnostics.map(d => ({
        code: d.code, severity: d.severity, message: d.message
      })));
    }

    // --- ExecGate ---
    // NOTE: ExecGate results are NEVER cached. Tests must always run.
    // Caching test results violates LAW 1: "Agent says done != done.
    // FinalGate PASS = done." A cached PASS from a previous run is not
    // a real PASS — the source code may have changed.
    let execVerdict: Awaited<ReturnType<typeof runExecGate>> | undefined;
    let execCommandResults: Array<{ command: string; exitCode: number; stdout: string; stderr: string; timedOut: boolean }> = [];
    if (gates.includes('exec')) {
      execVerdict = await runExecGate({
        plan: state.plan,
        hashes: state.hashes,
        attemptId,
        repoRoot: state.repoRoot,
      });
      execCommandResults = execVerdict.commandResults ?? [];

      gateResults.push({
        gateName: 'ExecGate',
        verdict: execVerdict.verdict,
        reasonCodes: execVerdict.reasonCodes,
        cached: false, // never cached
      });
      if (execVerdict.diagnostics) allDiagnostics.push(...execVerdict.diagnostics.map(d => ({
        code: d.code, severity: d.severity, message: d.message
      })));
    }

    // --- FinalGate ---
    if (gates.includes('final')) {
      const finalInputHash = GateCache.hashInputs(
        state.hashes.acceptanceCriteriaHash,
        state.evidenceCount,
      );
      const cachedFinal = state.gateCache.get(CACHE_NAMESPACES.FINAL, finalInputHash);

      let finalVerdict: ReturnType<typeof runFinalGate>;
      if (cachedFinal) {
        finalVerdict = cachedFinal as ReturnType<typeof runFinalGate>;
        cacheHits++;
      } else {
        finalVerdict = runFinalGate({
          plan: state.plan,
          hashes: state.hashes,
          attemptId,
          repoRoot: state.repoRoot,
          evidenceRecords: evidenceRecords,
          commandResults: execCommandResults,
          priorGateVerdicts: gateResults.map(g => ({
            gateName: g.gateName,
            verdict: g.verdict,
            reasonCodes: g.reasonCodes,
            failedCriteriaIds: [],
            evidenceRefs: [],
            attemptId,
            timestamp: new Date().toISOString(),
          })),
        });
        state.gateCache.set(CACHE_NAMESPACES.FINAL, finalInputHash, finalVerdict as unknown as GateVerdict);
      }

      gateResults.push({
        gateName: 'FinalGate',
        verdict: finalVerdict.verdict,
        reasonCodes: finalVerdict.reasonCodes,
        cached: !!cachedFinal,
      });
      if (finalVerdict.diagnostics) allDiagnostics.push(...finalVerdict.diagnostics.map(d => ({
        code: d.code, severity: d.severity, message: d.message
      })));
    }

    // Compute overall verdict
    for (const g of gateResults) {
      if (g.verdict === 'FAIL') {
        overallVerdict = 'FAIL';
        break;
      }
      if (g.verdict === 'HOLD' && overallVerdict === 'PASS') {
        overallVerdict = 'HOLD';
      }
    }

    return buildResponse(overallVerdict, attemptId, gateResults, cacheHits, allDiagnostics, start);
  }

  /** Handle a validate request (SchemaGate only, fast path). */
  async function handleValidate(req: ValidateRequest): Promise<ValidateResponse> {
    const start = performance.now();
    const verdict = runSchemaGate({ planYaml: req.planYaml, repoRoot: state.repoRoot });

    if (verdict.verdict === 'PASS' && verdict.plan && verdict.hashes) {
      state.plan = verdict.plan;
      state.hashes = verdict.hashes;
      // Cache the schema result
      const inputHash = GateCache.hashInputs(req.planYaml);
      state.gateCache.set(CACHE_NAMESPACES.SCHEMA, inputHash, verdict);
    }

    return {
      ok: verdict.verdict === 'PASS',
      verdict: verdict.verdict,
      reasonCodes: verdict.reasonCodes,
      diagnostics: verdict.diagnostics?.map(d => ({ code: d.code ?? 'unknown', severity: d.severity, message: d.message })) ?? [],
      timeMs: performance.now() - start,
    };
  }

  /** Start the daemon server. Returns the assigned port. */
  function start(): Promise<number> {
    return new Promise((resolve, reject) => {
      server = createServer((socket: Socket) => {
        let data = '';
        socket.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        socket.on('end', async () => {
          resetIdleTimer();
          try {
            const request = JSON.parse(data);
            let response: unknown;

            switch (request.type) {
              case 'verify':
                response = await handleVerify(request.payload);
                break;
              case 'validate':
                response = await handleValidate(request.payload);
                break;
              case 'status':
                response = {
                  running: state.running,
                  planLoaded: !!state.plan,
                  evidenceRecords: state.evidenceCount,
                  cacheStats: state.gateCache.stats(),
                };
                break;
              case 'shutdown':
                response = { ok: true };
                socket.write(JSON.stringify(response));
                socket.end();
                stop();
                return;
              default:
                response = { error: `Unknown request type: ${request.type}` };
            }
            socket.write(JSON.stringify(response));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            socket.write(JSON.stringify({ error: msg }));
          }
          socket.end();
        });
      });

      server.on('error', reject);
      server.listen(cfg.port, cfg.host, () => {
        const addr = server?.address();
        const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
        // Write PID file
        const pidDir = dirname(cfg.pidFile);
        if (!existsSync(pidDir)) {
          const { mkdirSync } = require('node:fs');
          mkdirSync(pidDir, { recursive: true });
        }
        writeFileSync(cfg.pidFile, String(process.pid));
        resolve(port);
      });
    });
  }

  /** Stop the daemon server and clean up. */
  function stop(): void {
    state.running = false;
    if (idleTimer) clearTimeout(idleTimer);
    try { if (existsSync(cfg.pidFile)) unlinkSync(cfg.pidFile); } catch {}
    server?.close();
  }

  return {
    config: cfg,
    state,
    start,
    stop,
    handleVerify,
    handleValidate,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResponse(
  verdict: GateVerdictValue,
  attemptId: string,
  gateResults: VerifyResponse['gateResults'],
  cacheHits: number,
  diagnostics: VerifyResponse['diagnostics'],
  startTime: number,
): VerifyResponse {
  const passed = gateResults.filter(g => g.verdict === 'PASS').length;
  const held = gateResults.filter(g => g.verdict === 'HOLD').length;
  const failed = gateResults.filter(g => g.verdict === 'FAIL').length;

  return {
    ok: verdict === 'PASS',
    verdict,
    attemptId,
    gateCount: gateResults.length,
    passedGates: passed,
    heldGates: held,
    failedGates: failed,
    cacheHitGates: cacheHits,
    gateResults,
    diagnostics,
    timeMs: performance.now() - startTime,
  };
}

/**
 * Auto-spawn the Praxis daemon as a detached child process.
 * Returns true if the daemon was spawned, false if it was already running.
 */
export function autoSpawnDaemon(config: Partial<DaemonConfig> = {}): boolean {
  const cfg: DaemonConfig = { ...DEFAULT_CONFIG, ...config };
  const pidFile = cfg.pidFile || resolve(cfg.repoRoot, '.praxis/daemon.pid');

  // Check if daemon is already running
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      // Check if process is alive (works on Windows via tasklist)
      try {
        process.kill(pid, 0);
        return false; // already running
      } catch {
        // Stale PID file — proceed to spawn
        try { unlinkSync(pidFile); } catch {}
      }
    } catch {
      try { unlinkSync(pidFile); } catch {}
    }
  }

  // Spawn daemon as detached child
  const child = spawn(process.argv[0], [
    ...(process.argv[1] ? [process.argv[1]] : []),
    '--daemon',
    '--repo-root', cfg.repoRoot,
    '--port', String(cfg.port || 0),
    '--pid-file', pidFile,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  // Wait briefly for daemon to start
  const maxWait = 2000;
  const pollInterval = 50;
  let waited = 0;
  while (waited < maxWait) {
    if (existsSync(pidFile)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollInterval);
    waited += pollInterval;
  }
  return existsSync(pidFile);
}
