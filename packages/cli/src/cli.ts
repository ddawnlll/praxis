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

  verify                      Run the Truth Kernel verification pipeline
    --plan <path>             Path to plan YAML file (default: .praxis/plan.yaml)
    --all-gates               Run all 6 gates (default: yes)

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

  // LockGate
  const lockDir = resolve(process.cwd(), '.praxis/locks');
  if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });
  const lockPath = resolve(lockDir, 'current.lock.yaml');

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
  const asJson = hasFlag(flags, 'json');

  const resolved = resolve(process.cwd(), planPath);
  if (!existsSync(resolved)) {
    if (!asJson) emitLine(`Error: Plan file not found at ${resolved}`);
    else emit({ error: `Plan file not found at ${resolved}`, exitCode: 3 });
    exit(3);
  }

  const planYaml = readFileSync(resolved, 'utf-8');
  const { runKernel } = await import('@praxis/kernel');

  let result: KernelResult;
  try {
    result = await runKernel({
      planYaml,
      repoRoot: process.cwd(),
      lockMode: 'create_if_missing',
      stopOnHold: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (asJson) emit({ error: msg, exitCode: 3 });
    else emitLine(`Error: Kernel pipeline failed — ${msg}`);
    exit(3);
  }

  if (asJson) {
    emit({
      verdict: result.verdict,
      ok: result.ok,
      attemptId: result.attemptId,
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

  if (asJson) {
    emit({
      runId: runId ?? 'latest',
      status: 'not_implemented',
      note: 'Status command reads from kernel pipeline result; run "praxis verify" first.',
    });
    exit(0);
  }

  emitLine('Status: NOT_IMPLEMENTED');
  emitLine('The status command depends on a persistent runtime state file.');
  emitLine('Run "praxis verify --plan <path>" to run a full verification pipeline.');
  if (runId) emitLine(`  Requested run ID: ${runId}`);
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

  if (asJson) {
    emit({
      runId: runId ?? 'latest',
      status: 'not_implemented',
      note: 'Report generation is in scope for P6 FinalGate. Run "praxis verify --plan <path>" for gate verdicts.',
    });
    exit(0);
  }

  emitLine('Report: NOT_IMPLEMENTED');
  emitLine('PRAXIS report generation will be delivered in the FinalGate completion phase.');
  emitLine('Run "praxis verify --plan <path>" for gate-level verdicts and diagnostics.');
  if (runId) emitLine(`  Requested run ID: ${runId}`);
  exit(0);
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
