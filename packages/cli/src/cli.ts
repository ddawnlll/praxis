#!/usr/bin/env node
// @praxis/cli — Thin CLI orchestrator for PRAXIS Truth Kernel.
// All gate logic lives in @praxis/kernel. This file only parses args,
// delegates to kernel functions, and formats output.
//
// Exit codes: 0=PASS, 1=HOLD, 2=FAIL, 3=error

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import type {
  KernelResult,
  KernelP2Result,
  KernelP3Result,
  EvidenceLedgerReadResult,
  EvidenceRecordV01,
  GateVerdictValue,
} from '@praxis/kernel';

// ---------------------------------------------------------------------------
// Argument parsing (zero external dependencies)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  subcommand: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 2; // skip node and script path
  let command = '';
  let subcommand = '';

  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        // Look ahead: if next arg is not a flag, treat as value
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          flags[key] = argv[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-')) {
      // Short flags not supported; treat as unknown
      flags[arg] = true;
    } else {
      // Positional
      if (!command) {
        command = arg;
      } else if (!subcommand) {
        subcommand = arg;
      } else {
        positional.push(arg);
      }
    }
    i++;
  }

  return { command, subcommand, flags, positional };
}

function getFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  if (typeof v === 'string') return v;
  return undefined;
}

function hasFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || typeof flags[key] === 'string';
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function emit(o: unknown): void {
  process.stdout.write(JSON.stringify(o, null, 2));
}

function emitLine(s: string): void {
  process.stdout.write(s + '\n');
}

function exit(code: number): never {
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Command: version
// ---------------------------------------------------------------------------

function cmdVersion(): void {
  emitLine('praxis 0.1.0');
  emitLine('PRAXIS Truth Kernel CLI');
  emitLine('Built on @praxis/kernel v0.1.0');
  exit(0);
}

// ---------------------------------------------------------------------------
// Command: help
// ---------------------------------------------------------------------------

const HELP_TEXT = `PRAXIS CLI v0.1.0 — Truth Kernel orchestrator

Usage: praxis <command> [subcommand] [options]

Commands:
  init                        Initialize a new PRAXIS plan
    --plan <path>             Output path (default: .praxis/plan.yaml)

  plan validate               Validate a PlanSpec against the schema
    --plan <path>             Path to plan YAML file (required)

  plan lock                   Create or verify a plan lock file
    --plan <path>             Path to plan YAML file (required)
    --lock-path <path>        Override default identity-derived lock path

  verify                      Run the Truth Kernel verification pipeline
    --plan <path>             Path to plan YAML file (default: .praxis/plan.yaml)
    --daemon                  Connect to running daemon for warm cached verification
    --gates <list>            Gate filter: comma-separated (e.g. schema,lock,exec,final)
    --force                   Overwrite existing lock file instead of creating if missing
    --attempt-id <id>         Custom attempt ID

  status                      Show current verification status
    --run-id <id>             Specific run ID
    --plan <path>             Plan file path

  ledger show                 Show evidence ledger records
    --run-id <id>             Run ID (required)
    --kind <k>                Filter by evidence type
    --limit <n>               Max records to show
    --json                    Output as JSON

  report show                 Show verification report
    --run-id <id>             Run ID (required)

  repair show                 Show repair packet for failed run
    --run-id <id>             Run ID (required)
    --json                    Output as JSON

  daemon                      Start the Praxis daemon (warm server for fast re-verification)
    --port <n>                TCP port (default: auto-assigned)
    --idle-timeout <ms>       Auto-shutdown after idle ms (default: 600000 = 10 min)

  help                        Show this help

  version                     Show version

Global flags:
  --json                      Output as JSON

Exit codes:
  0   PASS — all gates passed
  1   HOLD — one or more gates held
  2   FAIL — one or more gates failed
  3   Error — invalid usage or runtime error
`;

function cmdHelp(): void {
  emitLine(HELP_TEXT);
  exit(0);
}

// ---------------------------------------------------------------------------
// Command: init
// ---------------------------------------------------------------------------

const PLAN_TEMPLATE = `# PRAXIS PlanSpec v0.1
# Generated by: praxis init

planSpecVersion: "0.1.0"
kind: ImplementationPlan
profile: praxis-v0.1

metadata:
  planId: "PRAXIS-{date}-{project}"
  title: "My PRAXIS Plan"
  wave: 1
  owner: ""
  summary: ""

authority:
  acceptanceCriteriaSource: human
  criteriaLocked: false
  agentGeneratedCriteria: forbid

workspace:
  allowedFiles: []
  forbiddenFiles: []
  namespace: []

execution:
  planMode: required
  architectureReview: optional
  testBeforeCommit: required

tasks:
  - taskId: "task-001"
    taskType: implementation
    description: "Describe the task here."
    namespace: []
    dependencies: []
    acceptanceCriteria: []
    budget:
      maxAttempts: 3
      maxSeconds: 600
    predictedInterfaces: []

commands:
  exactAllowedCommands: []
  deniedCommands:
    - "rm -rf"
    - "git push --force"

evidence:
  requiredEvidenceTypes:
    - diff
    - source
    - test_output

gates:
  schemaGate: enabled
  lockGate: enabled
  evidenceGate: enabled
  wiringGate: enabled
  execGate: enabled
  finalGate: enabled

repair:
  enabled: true
  maxRepairAttempts: 6
  strategies:
    - initial
    - context_expand
    - tool_restrict
    - scope_narrow
    - knowledge_inject
    - hint_inject

locking:
  lockVersion: "praxis-plan-lock/v0.1"
  autoCreate: true

reports:
  format: markdown
  includeEvidence: true
  includeGateVerdicts: true
`;

function cmdInit(flags: Record<string, string | boolean>): void {
  const planPath = getFlag(flags, 'plan') ?? '.praxis/plan.yaml';
  const resolved = resolve(process.cwd(), planPath);

  if (existsSync(resolved)) {
    emitLine(`Plan already exists at ${resolved}`);
    emitLine('Use --plan <path> to specify a different location.');
    exit(3);
  }

  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const yaml = PLAN_TEMPLATE
    .replace(/{date}/g, new Date().toISOString().slice(0, 10))
    .replace(/{project}/g, 'INIT');

  writeFileSync(resolved, yaml, 'utf-8');
  emitLine(`Plan initialized at ${resolved}`);
  emitLine('Edit this file to define your PlanSpec, then run:');
  emitLine(`  praxis plan validate --plan ${planPath}`);
  exit(0);
}

// ---------------------------------------------------------------------------
// Command: daemon
// ---------------------------------------------------------------------------

async function cmdDaemon(flags: Record<string, string | boolean>): Promise<void> {
  const port = parseInt(getFlag(flags, 'port') ?? '0', 10);
  const host = getFlag(flags, 'host') ?? '127.0.0.1';
  const idleTimeoutMs = parseInt(getFlag(flags, 'idle-timeout') ?? '600000', 10);
  const asJson = hasFlag(flags, 'json');

  const { createDaemon } = await import('@praxis/kernel');

  const daemon = createDaemon({
    port,
    host,
    repoRoot: process.cwd(),
    idleTimeoutMs,
  });

  try {
    const assignedPort = await daemon.start();
    if (asJson) {
      emit({ status: 'running', port: assignedPort, pid: process.pid });
    } else {
      emitLine(`Praxis daemon running on ${host}:${assignedPort} (PID ${process.pid})`);
      emitLine(`Warm state: plan=${daemon.state.plan ? 'loaded' : 'empty'}, evidence=${daemon.state.evidenceCount} records`);
      emitLine('Idle timeout: ${idleTimeoutMs}ms');
      emitLine('');
      emitLine('Connect clients with: praxis verify --daemon --plan <path>');
      emitLine('Shutdown with: praxis daemon stop');
    }

    // Keep alive — wait for shutdown signal
    process.on('SIGINT', () => { daemon.stop(); process.exit(0); });
    process.on('SIGTERM', () => { daemon.stop(); process.exit(0); });

    // Block forever
    await new Promise(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!asJson) emitLine(`Error: Failed to start daemon — ${msg}`);
    else emit({ error: msg, exitCode: 3 });
    exit(3);
  }
}

// ---------------------------------------------------------------------------
// Command: plan validate
// ---------------------------------------------------------------------------

async function cmdPlanValidate(flags: Record<string, string | boolean>): Promise<void> {
  const planPath = getFlag(flags, 'plan');
  const asJson = hasFlag(flags, 'json');

  if (!planPath) {
    if (!asJson) emitLine('Error: --plan <path> is required for "plan validate".');
    else emit({ error: '--plan <path> is required', exitCode: 3 });
    exit(3);
  }

  const resolved = resolve(process.cwd(), planPath);
  if (!existsSync(resolved)) {
    if (!asJson) emitLine(`Error: Plan file not found at ${resolved}`);
    else emit({ error: `Plan file not found at ${resolved}`, exitCode: 3 });
    exit(3);
  }

  const planYaml = readFileSync(resolved, 'utf-8');

  // Dynamically import kernel — gate logic lives there, not here
  const { runSchemaGate } = await import('@praxis/kernel');

  const result = runSchemaGate({ planYaml, repoRoot: process.cwd() });

  if (asJson) {
    emit({ verdict: result.verdict, reasonCodes: result.reasonCodes, diagnostics: result.diagnostics });
  } else {
    emitLine(`Plan validate: ${verdictLabel(result.verdict)}`);
    emitLine(`  Plan: ${resolved}`);
    for (const rc of result.reasonCodes) {
      emitLine(`  Reason: ${rc}`);
    }
    if (result.diagnostics && result.diagnostics.length > 0) {
      for (const d of result.diagnostics) {
        emitLine(`  [${d.severity}] ${d.message}`);
      }
    }
  }

  exit(exitCodeForVerdict(result.verdict));
}

// ---------------------------------------------------------------------------
// Command: plan lock
// ---------------------------------------------------------------------------

async function cmdPlanLock(flags: Record<string, string | boolean>): Promise<void> {
  const planPath = getFlag(flags, 'plan');
  const asJson = hasFlag(flags, 'json');

  if (!planPath) {
    if (!asJson) emitLine('Error: --plan <path> is required for "plan lock".');
    else emit({ error: '--plan <path> is required', exitCode: 3 });
    exit(3);
  }

  const resolved = resolve(process.cwd(), planPath);
  if (!existsSync(resolved)) {
    if (!asJson) emitLine(`Error: Plan file not found at ${resolved}`);
    else emit({ error: `Plan file not found at ${resolved}`, exitCode: 3 });
    exit(3);
  }

  const planYaml = readFileSync(resolved, 'utf-8');
  const { runSchemaGate, runLockGate } = await import('@praxis/kernel');

  // SchemaGate first
  const schemaVerdict = runSchemaGate({ planYaml, repoRoot: process.cwd() });
  if (schemaVerdict.verdict !== 'PASS' || !schemaVerdict.plan || !schemaVerdict.hashes) {
    if (asJson) {
      emit({ verdict: schemaVerdict.verdict, reasonCodes: schemaVerdict.reasonCodes, stage: 'schema' });
    } else {
      emitLine(`Plan lock: ${verdictLabel(schemaVerdict.verdict)} (schema validation failed)`);
      for (const rc of schemaVerdict.reasonCodes) emitLine(`  Reason: ${rc}`);
    }
    exit(exitCodeForVerdict(schemaVerdict.verdict));
  }

  // LockGate — use identity-derived path by default for collision-free isolation.
  // Each plan+content combination gets its own lock file.
  const explicitLockPath = getFlag(flags, 'lock-path');
  const lockPath = explicitLockPath
    ? resolve(process.cwd(), explicitLockPath)
    : resolve(process.cwd(), schemaVerdict.plan.metadata.planId + '-' + schemaVerdict.hashes.planHash.substring(0, 12) + '.lock.yaml');

  const lockDir = dirname(lockPath);
  if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });

  const lockVerdict = runLockGate({
    plan: schemaVerdict.plan,
    hashes: schemaVerdict.hashes,
    lockPath,
    mode: 'create_if_missing',
  });

  if (asJson) {
    emit({ verdict: lockVerdict.verdict, reasonCodes: lockVerdict.reasonCodes, lockPath });
  } else {
    emitLine(`Plan lock: ${verdictLabel(lockVerdict.verdict)}`);
    emitLine(`  Lock: ${lockPath}`);
    for (const rc of lockVerdict.reasonCodes) emitLine(`  Reason: ${rc}`);
  }

  exit(exitCodeForVerdict(lockVerdict.verdict));
}

// ---------------------------------------------------------------------------
// Command: verify
// ---------------------------------------------------------------------------

async function cmdVerify(flags: Record<string, string | boolean>): Promise<void> {
  const planPath = getFlag(flags, 'plan') ?? '.praxis/plan.yaml';
  const evidencePath = getFlag(flags, 'evidence');
  const attemptId = getFlag(flags, 'attempt-id') ?? `run-${Date.now()}`;
  const asJson = hasFlag(flags, 'json');
  const useDaemon = hasFlag(flags, 'daemon') && !hasFlag(flags, 'no-daemon');
  const gateFilterRaw = getFlag(flags, 'gates');

  const resolved = resolve(process.cwd(), planPath);
  if (!existsSync(resolved)) {
    if (!asJson) emitLine(`Error: Plan file not found at ${resolved}`);
    else emit({ error: `Plan file not found at ${resolved}`, exitCode: 3 });
    exit(3);
  }

  const planYaml = readFileSync(resolved, 'utf-8');

  // Parse gate filter: --gates=schema,lock,exec,final
  const gates = gateFilterRaw
    ? gateFilterRaw.split(',').map(g => g.trim().toLowerCase())
    : undefined;

  if (useDaemon) {
    // -----------------------------------------------------------------------
    // Daemon mode: connect to the running Praxis daemon via TCP
    // -----------------------------------------------------------------------
    const host = getFlag(flags, 'daemon-host') ?? '127.0.0.1';
    const port = parseInt(getFlag(flags, 'daemon-port') ?? '0', 10);

    // Read daemon manifest for actual port
    const pidFile = resolve(process.cwd(), '.praxis/daemon.pid');
    let daemonPort = port;
    if (daemonPort === 0 && existsSync(pidFile)) {
      try {
        const manifest = JSON.parse(readFileSync(pidFile, 'utf-8'));
        daemonPort = typeof manifest.port === 'number' ? manifest.port : 0;
      } catch {}
    }

    if (daemonPort === 0 || isNaN(daemonPort)) {
      if (!asJson) emitLine('Error: No running Praxis daemon found. Start one with "praxis daemon" or omit --daemon.');
      else emit({ error: 'No running Praxis daemon', exitCode: 3 });
      exit(3);
    }

    try {
      const { connect } = await import('node:net');
      const result = await new Promise<unknown>((resolvePromise, reject) => {
        const client = connect(daemonPort, host, () => {
          const request = JSON.stringify({
            type: 'verify',
            payload: {
              planYaml,
              evidenceLedgerPath: evidencePath ? resolve(process.cwd(), evidencePath) : undefined,
              attemptId,
              lockMode: 'create_if_missing',
              gates,
            },
          });
          client.write(request);
          client.end();
        });

        let data = '';
        client.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        client.on('end', () => {
          try { resolvePromise(JSON.parse(data)); }
          catch { resolvePromise({ error: 'Failed to parse daemon response' }); }
        });
        client.on('error', reject);
      });

      const response = result as Record<string, unknown>;
      if (response.error) {
        if (!asJson) emitLine(`Error: Daemon returned — ${response.error}`);
        else emit({ error: response.error, exitCode: 3 });
        exit(3);
      }

      type GateResult = { gateName: string; verdict: string; reasonCodes: string[]; cached: boolean };

      if (asJson) {
        emit(response);
      } else {
        emitLine(`Verify (daemon): ${verdictLabel(response.verdict as GateVerdictValue)}`);
        emitLine(`  Run ID: ${response.attemptId}`);
        emitLine(`  Time: ${(response.timeMs as number).toFixed(0)}ms`);
        emitLine(`  Cache hits: ${(response.cacheHitGates as number)}/${(response.gateCount as number)} gates`);
        emitLine(`  Gates:`);
        for (const g of (response.gateResults as GateResult[])) {
          const icon = g.verdict === 'PASS' ? '✓' : g.verdict === 'HOLD' ? '⚠' : '✗';
          emitLine(`    ${icon} ${g.gateName}: ${g.verdict}${g.cached ? ' (cached)' : ''}`);
          for (const rc of g.reasonCodes) emitLine(`      ${rc}`);
        }
        if ((response.diagnostics as Array<unknown>).length > 0) {
          emitLine(`  Diagnostics:`);
          for (const d of (response.diagnostics as Array<{ code: string; severity: string; message: string }>)) {
            emitLine(`    [${d.severity}] ${d.message}`);
          }
        }
      }

      exit(exitCodeForVerdict(response.verdict as GateVerdictValue));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!asJson) emitLine(`Error: Failed to connect to daemon — ${msg}`);
      else emit({ error: `Daemon connection failed: ${msg}`, exitCode: 3 });
      exit(3);
    }
  }

  // -----------------------------------------------------------------------
  // Cold mode (default): run the pipeline directly
  // -----------------------------------------------------------------------
  const { runKernel, generateReport, generateRepairPacket } = await import('@praxis/kernel');

  // Resolve evidence ledger path if --evidence provided
  let evidenceLedgerPath: string | undefined;
  if (evidencePath) {
    const ep = resolve(process.cwd(), evidencePath);
    if (!existsSync(ep)) {
      if (!asJson) emitLine(`Error: Evidence file not found at ${ep}`);
      else emit({ error: `Evidence file not found at ${ep}`, exitCode: 3 });
      exit(3);
    }
    evidenceLedgerPath = ep;
  }

  let result: KernelResult;
  try {
    result = await runKernel({
      planYaml,
      repoRoot: process.cwd(),
      lockMode: 'create_if_missing',
      stopOnHold: false,
      evidenceLedgerPath,
      attemptId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (asJson) emit({ error: msg, exitCode: 3 });
    else emitLine(`Error: Kernel pipeline failed — ${msg}`);
    exit(3);
  }

  // Persist results to .praxis/runs/<attemptId>/
  // Use the attemptId from flag or kernel result
  const resolvedAttemptId = result.attemptId;
  const runDir = resolve(process.cwd(), '.praxis/runs', resolvedAttemptId);
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });

  // Save verdict.json
  const verdictData = {
    verdict: result.verdict,
    ok: result.ok,
    attemptId: resolvedAttemptId,
    planId: result.plan?.metadata?.planId ?? 'unknown',
    planTitle: result.plan?.metadata?.title ?? '',
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    gateVerdicts: result.gateVerdicts.map(gv => ({
      gateName: gv.gateName,
      verdict: gv.verdict,
      reasonCodes: gv.reasonCodes,
      repairHint: 'repairHint' in gv ? (gv as any).repairHint : undefined,
    })),
    totalGates: result.gateVerdicts.length,
    passedGates: result.gateVerdicts.filter(g => g.verdict === 'PASS').length,
    heldGates: result.gateVerdicts.filter(g => g.verdict === 'HOLD').length,
    failedGates: result.gateVerdicts.filter(g => g.verdict === 'FAIL').length,
    diagnostics: result.diagnostics,
    final: result.final ? {
      totalCriteria: result.final.totalCriteria,
      passedCriteria: result.final.passedCriteria,
      failedCriteria: result.final.failedCriteria,
      advisoryCriteria: result.final.advisoryCriteria,
      criterionResults: result.final.criterionResults,
    } : null,
  };
  writeFileSync(resolve(runDir, 'verdict.json'), JSON.stringify(verdictData, null, 2), 'utf-8');

  // Save report
  try {
    const report = generateReport(result);
    writeFileSync(resolve(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');
  } catch {}

  // Save repair packet if not PASS
  if (result.verdict !== 'PASS') {
    try {
      const { generateReport: _, ...rest } = await import('@praxis/kernel');
      // Use the import we already have
      const repairPacket = generateRepairPacket(
        result.plan,
        result.hashes,
        attemptId,
        result.gateVerdicts,
        result.final?.criterionResults,
        result.diagnostics,
      );
      if (repairPacket) {
        const repairsDir = resolve(process.cwd(), '.praxis/repairs');
        if (!existsSync(repairsDir)) mkdirSync(repairsDir, { recursive: true });
        writeFileSync(resolve(repairsDir, `${attemptId}.json`), JSON.stringify(repairPacket, null, 2), 'utf-8');
      }
    } catch {}
  }

  if (asJson) {
    emit({
      verdict: result.verdict,
      ok: result.ok,
      attemptId,
      gateVerdicts: result.gateVerdicts.map(gv => ({
        gateName: gv.gateName,
        verdict: gv.verdict,
        reasonCodes: gv.reasonCodes,
      })),
      diagnostics: result.diagnostics,
    });
  } else {
    emitLine(`Verify: ${verdictLabel(result.verdict)}`);
    emitLine(`  Run ID: ${result.attemptId}`);
    emitLine(`  Results saved to: ${runDir}`);
    emitLine(`  Gates:`);
    for (const gv of result.gateVerdicts) {
      const icon = gv.verdict === 'PASS' ? '✓' : gv.verdict === 'HOLD' ? '⚠' : '✗';
      emitLine(`    ${icon} ${gv.gateName}: ${gv.verdict}`);
      for (const rc of gv.reasonCodes) {
        emitLine(`      ${rc}`);
      }
    }
    if (result.diagnostics.length > 0) {
      emitLine(`  Diagnostics (${result.diagnostics.length}):`);
      for (const d of result.diagnostics) {
        emitLine(`    [${d.severity}] ${d.message}`);
      }
    }
  }

  exit(exitCodeForVerdict(result.verdict));
}

// ---------------------------------------------------------------------------
// Command: status
// ---------------------------------------------------------------------------

async function cmdStatus(flags: Record<string, string | boolean>): Promise<void> {
  const runId = getFlag(flags, 'run-id');
  const asJson = hasFlag(flags, 'json');

  // If no run-id specified, find the latest run from .praxis/runs/
  const runsDir = resolve(process.cwd(), '.praxis/runs');
  let targetRunId = runId;

  if (!targetRunId) {
    try {
      const { readdirSync } = await import('node:fs');
      if (existsSync(runsDir)) {
        const dirs = readdirSync(runsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
          .sort()
          .reverse();
        if (dirs.length > 0) targetRunId = dirs[0];
      }
    } catch {}
  }

  if (!targetRunId) {
    if (asJson) {
      emit({ status: 'no_runs', message: 'No verification runs found. Run "praxis verify --plan <path>" first.' });
    } else {
      emitLine('Status: NO_RUNS');
      emitLine('No verification runs found.');
      emitLine('Run "praxis verify --plan <path>" to run a full verification pipeline.');
    }
    exit(0);
  }

  // Read verdict.json for the target run
  const verdictPath = resolve(runsDir, targetRunId, 'verdict.json');
  let verdictData: Record<string, unknown> | null = null;
  if (existsSync(verdictPath)) {
    try {
      verdictData = JSON.parse(readFileSync(verdictPath, 'utf-8'));
    } catch {}
  }

  // Read evidence.jsonl for record count
  const ledgerPath = resolve(runsDir, targetRunId, 'evidence.jsonl');
  let evidenceCount = 0;
  if (existsSync(ledgerPath)) {
    try {
      const { readEvidenceLedgerJsonl } = await import('@praxis/kernel');
      const readResult = readEvidenceLedgerJsonl(ledgerPath);
      evidenceCount = readResult.records.length;
    } catch {}
  }

  if (asJson) {
    emit({
      runId: targetRunId,
      verdict: verdictData?.verdict ?? 'unknown',
      ok: verdictData?.ok ?? false,
      evidenceCount,
      planId: verdictData?.planId ?? null,
      gates: verdictData?.gates ?? null,
      verdictFound: verdictData !== null,
    });
  } else {
    emitLine(`Status: Run ${targetRunId}`);
    if (verdictData) {
      const v = verdictData.verdict ?? 'unknown';
      emitLine(`  Verdict: ${verdictLabel(v as GateVerdictValue)}`);
      emitLine(`  OK: ${verdictData.ok}`);
      if (verdictData.planId) emitLine(`  Plan: ${verdictData.planId}`);
    } else {
      emitLine('  Verdict: No verdict file found (run may be incomplete)');
    }
    emitLine(`  Evidence records: ${evidenceCount}`);
  }
  exit(0);
}

// ---------------------------------------------------------------------------
// Command: ledger show
// ---------------------------------------------------------------------------

function filterLedgerRecords(
  records: EvidenceRecordV01[],
  kind: string | undefined,
  limit: number,
): EvidenceRecordV01[] {
  let filtered = records;
  if (kind) {
    filtered = records.filter(r => r.type === kind);
  }
  if (limit > 0 && limit < filtered.length) {
    filtered = filtered.slice(0, limit);
  }
  return filtered;
}

function formatLedgerRecord(rec: EvidenceRecordV01): string {
  const lines = [
    `  ${rec.recordId}`,
    `    Type:   ${rec.type}`,
    `    Source: ${rec.source}`,
    `    Time:   ${rec.timestamp}`,
  ];
  if (rec.taskId) lines.push(`    Task:   ${rec.taskId}`);
  if (rec.criterionId) lines.push(`    Criterion: ${rec.criterionId}`);
  if (rec.summary) lines.push(`    Summary: ${rec.summary}`);
  if (rec.path) lines.push(`    Path:   ${rec.path}`);
  if (rec.changedFile) {
    lines.push(`    File:   ${rec.changedFile.path} (${rec.changedFile.status})`);
  }
  return lines.join('\n');
}

async function cmdLedgerShow(flags: Record<string, string | boolean>): Promise<void> {
  const runId = getFlag(flags, 'run-id');
  const kind = getFlag(flags, 'kind');
  const limitStr = getFlag(flags, 'limit');
  const limit = limitStr ? parseInt(limitStr, 10) || 0 : 0;
  const asJson = hasFlag(flags, 'json');

  if (!runId) {
    if (!asJson) emitLine('Error: --run-id <id> is required for "ledger show".');
    else emit({ error: '--run-id <id> is required', exitCode: 3 });
    exit(3);
  }

  const ledgerPath = resolve(process.cwd(), '.praxis/runs', runId, 'evidence.jsonl');

  let readResult: EvidenceLedgerReadResult;
  try {
    const { readEvidenceLedgerJsonl } = await import('@praxis/kernel');
    readResult = readEvidenceLedgerJsonl(ledgerPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (asJson) emit({ error: msg, exitCode: 3 });
    else emitLine(`Error: Failed to read ledger — ${msg}`);
    exit(3);
  }

  const filtered = filterLedgerRecords(readResult.records, kind, limit);

  if (asJson) {
    emit({
      runId,
      ledgerPath,
      totalRecords: readResult.records.length,
      shownRecords: filtered.length,
      records: filtered,
      diagnostics: readResult.diagnostics,
    });
  } else {
    emitLine(`Ledger: ${ledgerPath}`);
    emitLine(`  Records: ${filtered.length}${filtered.length < readResult.records.length ? ` (of ${readResult.records.length} total)` : ''}`);
    if (kind) emitLine(`  Filter: type=${kind}`);
    if (readResult.diagnostics.length > 0) {
      emitLine(`  Parse issues: ${readResult.diagnostics.length}`);
      for (const d of readResult.diagnostics) {
        emitLine(`    [${d.severity}] ${d.message}`);
      }
    }
    emitLine('');
    for (const rec of filtered) {
      emitLine(formatLedgerRecord(rec));
    }
  }

  exit(0);
}

// ---------------------------------------------------------------------------
// Command: report show
// ---------------------------------------------------------------------------

async function cmdReportShow(flags: Record<string, string | boolean>): Promise<void> {
  const runId = getFlag(flags, 'run-id');
  const asJson = hasFlag(flags, 'json');

  if (!runId) {
    if (!asJson) emitLine('Error: --run-id <id> is required for "report show".');
    else emit({ error: '--run-id <id> is required', exitCode: 3 });
    exit(3);
  }

  // Try to read verdict.json for the run
  const runsDir = resolve(process.cwd(), '.praxis/runs');
  const verdictPath = resolve(runsDir, runId, 'verdict.json');

  if (!existsSync(verdictPath)) {
    if (!asJson) emitLine(`Error: No verdict file found for run "${runId}".`);
    else emit({ error: `No verdict file found for run "${runId}"`, exitCode: 3 });
    exit(3);
  }

  try {
    const verdictData = JSON.parse(readFileSync(verdictPath, 'utf-8'));
    const { generateReport, formatReportMarkdown } = await import('@praxis/kernel');

    // We need to reconstruct a KernelResult-compatible object from the JSON
    // The JSON stored from a verify run should have the right shape.
    const report = generateReport(verdictData as any);

    if (asJson) {
      emit(report);
    } else {
      emitLine(formatReportMarkdown(report));
    }
    exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!asJson) emitLine(`Error: Failed to generate report — ${msg}`);
    else emit({ error: msg, exitCode: 3 });
    exit(3);
  }
}

// ---------------------------------------------------------------------------
// Command: repair show
// ---------------------------------------------------------------------------

async function cmdRepairShow(flags: Record<string, string | boolean>): Promise<void> {
  const runId = getFlag(flags, 'run-id');
  const asJson = hasFlag(flags, 'json');

  if (!runId) {
    if (!asJson) emitLine('Error: --run-id <id> is required for "repair show".');
    else emit({ error: '--run-id <id> is required', exitCode: 3 });
    exit(3);
  }

  // Try reading repair packet from .praxis/repairs/<runId>.json
  const repairPath = resolve(process.cwd(), '.praxis/repairs', `${runId}.json`);
  if (existsSync(repairPath)) {
    try {
      const content = readFileSync(repairPath, 'utf-8');
      if (asJson) {
        emit(JSON.parse(content));
      } else {
        const packet = JSON.parse(content);
        emitLine(`Repair Packet: ${runId}`);
        emitLine(`  Verdict: ${packet.triggerVerdict}`);
        emitLine(`  Failed Gates:`);
        for (const fg of (packet.failedGates ?? [])) {
          emitLine(`    ${fg.gateName}: ${fg.verdict}`);
          for (const rc of (fg.reasonCodes ?? [])) emitLine(`      ${rc}`);
          if (fg.repairHint) emitLine(`      Hint: ${fg.repairHint}`);
        }
        if (packet.failedCriteria?.length > 0) {
          emitLine(`  Failed Criteria:`);
          for (const fc of packet.failedCriteria) {
            emitLine(`    ${fc.criterionId}: ${fc.detail}`);
          }
        }
        emitLine(`  Strategies:`);
        for (const s of (packet.strategies ?? [])) {
          emitLine(`    [${s.kind}] ${s.description}`);
          for (const a of (s.actions ?? [])) emitLine(`      → ${a}`);
        }
      }
      exit(0);
    } catch {}
  }

  // Try reading verdict instead
  const verdictPath = resolve(process.cwd(), '.praxis/runs', runId, 'verdict.json');
  if (existsSync(verdictPath)) {
    if (!asJson) {
      emitLine(`No repair packet for run "${runId}". The run may have passed or repair wasn't generated.`);
      emitLine('Run "praxis verify" with a failing plan to generate a repair packet.');
    } else {
      emit({ error: `No repair packet found for run "${runId}"`, exitCode: 3 });
    }
    exit(3);
  }

  if (!asJson) emitLine(`Error: No data found for run "${runId}".`);
  else emit({ error: `No data found for run "${runId}"`, exitCode: 3 });
  exit(3);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verdictLabel(v: GateVerdictValue): string {
  switch (v) {
    case 'PASS': return 'PASS';
    case 'HOLD': return 'HOLD';
    case 'FAIL': return 'FAIL';
    default: return v;
  }
}

function exitCodeForVerdict(v: GateVerdictValue): number {
  switch (v) {
    case 'PASS': return 0;
    case 'HOLD': return 1;
    case 'FAIL': return 2;
    default: return 3;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { command, subcommand, flags } = parseArgs(process.argv);

  // Global --json and --help flag
  const isHelp = hasFlag(flags, 'help') || hasFlag(flags, 'h');

  if (isHelp || !command) {
    cmdHelp();
    return;
  }

  switch (command) {
    case 'version':
      cmdVersion();
      break;

    case 'help':
      cmdHelp();
      break;

    case 'init':
      cmdInit(flags);
      break;

    case 'daemon':
      await cmdDaemon(flags);
      break;

    case 'plan':
      switch (subcommand) {
        case 'validate':
          await cmdPlanValidate(flags);
          break;
        case 'lock':
          await cmdPlanLock(flags);
          break;
        default:
          emitLine(`Error: Unknown subcommand "plan ${subcommand}".`);
          emitLine('Available: plan validate, plan lock');
          exit(3);
      }
      break;

    case 'verify':
      await cmdVerify(flags);
      break;

    case 'status':
      await cmdStatus(flags);
      break;

    case 'ledger':
      switch (subcommand) {
        case 'show':
          await cmdLedgerShow(flags);
          break;
        default:
          emitLine(`Error: Unknown subcommand "ledger ${subcommand}".`);
          emitLine('Available: ledger show');
          exit(3);
      }
      break;

    case 'report':
      switch (subcommand) {
        case 'show':
          await cmdReportShow(flags);
          break;
        default:
          emitLine(`Error: Unknown subcommand "report ${subcommand}".`);
          emitLine('Available: report show');
          exit(3);
      }
      break;

    case 'repair':
      switch (subcommand) {
        case 'show':
          await cmdRepairShow(flags);
          break;
        default:
          emitLine(`Error: Unknown subcommand "repair ${subcommand}".`);
          emitLine('Available: repair show');
          exit(3);
      }
      break;

    default:
      emitLine(`Error: Unknown command "${command}".`);
      emitLine('Run "praxis help" for available commands.');
      exit(3);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`praxis: internal error — ${msg}\n`);
  process.exit(3);
});
