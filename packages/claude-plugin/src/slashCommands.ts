// @praxis/claude-plugin — Slash commands
// 9 slash commands that delegate to the PRAXIS CLI via child_process.execFile (no shell — safe).
// Each command formats results for display within Claude Code conversations.
// Plugin is READ-ONLY display + dispatch. NEVER decides truth.

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import type { PluginConfig } from './config';
import { validateCliPath } from './config';
import { formatKernelResult, formatVerdictBadge } from './display/formatVerdict';

// ---------------------------------------------------------------------------
// Command execution helper
// ---------------------------------------------------------------------------

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

function execPraxis(
  args: string[],
  config: PluginConfig,
  repoRoot: string,
  timeoutMs = 60_000,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const cliPathErr = validateCliPath(config.cliPath);
    if (cliPathErr) {
      resolve({ exitCode: 3, stdout: '', stderr: '', error: cliPathErr });
      return;
    }

    // Use execFile (no shell) to prevent command injection.
    // Arguments are passed as an array directly to the process.
    execFile(
      config.cliPath,
      args,
      {
        cwd: repoRoot,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env },
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            exitCode: error.code === 'ETIMEDOUT' ? 124 : (typeof error.code === 'number' ? error.code : 3),
            stdout: stdout || '',
            stderr: stderr || '',
            error: error.message,
          });
        } else {
          resolve({
            exitCode: 0,
            stdout: stdout || '',
            stderr: stderr || '',
          });
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// /praxis init
// ---------------------------------------------------------------------------

export async function slashInit(
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  const planPath = config.defaultPlanPath;
  const result = await execPraxis(
    ['init', '--plan', planPath],
    config,
    repoRoot,
  );

  if (result.error) {
    return `❌ PRAXIS init failed: ${result.error}`;
  }

  let output = result.stdout.trim();
  if (result.exitCode !== 0) {
    output = `❌ PRAXIS init exited with code ${result.exitCode}\n\`\`\`\n${output}\n\`\`\``;
    if (result.stderr.trim()) {
      output += `\n\nStderr:\n\`\`\`\n${result.stderr.trim()}\n\`\`\``;
    }
  } else {
    output = `✅ ${output}`;
  }

  return output;
}

// ---------------------------------------------------------------------------
// /praxis plan validate <path>
// ---------------------------------------------------------------------------

export async function slashPlanValidate(
  planPath: string,
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  const absPlanPath = planPath.startsWith('/') ? planPath : resolve(repoRoot, planPath);
  const result = await execPraxis(
    ['plan', 'validate', '--plan', absPlanPath, '--json'],
    config,
    repoRoot,
  );

  if (result.error) {
    return `❌ PRAXIS plan validate failed: ${result.error}`;
  }

  if (result.exitCode === 3) {
    return `❌ CLI error:\n\`\`\`\n${result.stdout.trim()}\n\`\`\``;
  }

  // Parse JSON output
  try {
    const data = JSON.parse(result.stdout);
    const badge = formatVerdictBadge(data.verdict);

    let msg = `${badge} Plan validation for: \`${absPlanPath}\`\n\n`;

    if (data.reasonCodes && data.reasonCodes.length > 0) {
      msg += '**Reason codes:**\n';
      for (const rc of data.reasonCodes) {
        msg += `- \`${rc}\`\n`;
      }
    }

    if (data.diagnostics && data.diagnostics.length > 0) {
      msg += '\n**Schema diagnostics:**\n';
      for (const d of data.diagnostics) {
        msg += `- [${d.severity}] ${d.message}\n`;
      }
    }

    return msg;
  } catch {
    return `⚠️ PRAXIS plan validate — raw output:\n\`\`\`\n${result.stdout.trim()}\n\`\`\`\n\`\`\`\n${result.stderr.trim()}\n\`\`\``;
  }
}

// ---------------------------------------------------------------------------
// /praxis plan lock <path>
// ---------------------------------------------------------------------------

export async function slashPlanLock(
  planPath: string,
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  const absPlanPath = planPath.startsWith('/') ? planPath : resolve(repoRoot, planPath);
  const result = await execPraxis(
    ['plan', 'lock', '--plan', absPlanPath, '--json'],
    config,
    repoRoot,
  );

  if (result.error) {
    return `❌ PRAXIS plan lock failed: ${result.error}`;
  }

  if (result.exitCode === 3) {
    return `❌ CLI error:\n\`\`\`\n${result.stdout.trim()}\n\`\`\``;
  }

  try {
    const data = JSON.parse(result.stdout);
    const badge = formatVerdictBadge(data.verdict);

    let msg = `${badge} Plan lock for: \`${absPlanPath}\`\n`;
    if (data.lockPath) {
      msg += `Lock file: \`${data.lockPath}\`\n`;
    }
    if (data.reasonCodes && data.reasonCodes.length > 0) {
      msg += '\n**Reason codes:**\n';
      for (const rc of data.reasonCodes) {
        msg += `- \`${rc}\`\n`;
      }
    }

    return msg;
  } catch {
    return `⚠️ PRAXIS plan lock — raw output:\n\`\`\`\n${result.stdout.trim()}\n\`\`\`\n\`\`\`\n${result.stderr.trim()}\n\`\`\``;
  }
}

// ---------------------------------------------------------------------------
// /praxis verify [--plan <path>]
// ---------------------------------------------------------------------------

export async function slashVerify(
  planPath: string | undefined,
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  const args = ['verify', '--json'];
  if (planPath) {
    args.push('--plan', planPath.startsWith('/') ? planPath : resolve(repoRoot, planPath));
  }

  const result = await execPraxis(args, config, repoRoot, 300_000); // 5 min timeout

  if (result.error) {
    return `❌ PRAXIS verify failed: ${result.error}`;
  }

  if (result.exitCode === 3) {
    return `❌ CLI error:\n\`\`\`\n${result.stdout.trim()}\n\`\`\``;
  }

  try {
    const data = JSON.parse(result.stdout);

    // Format the result using our display formatter
    const formatted = formatKernelResult({
      verdict: data.verdict,
      attemptId: data.attemptId,
      gateVerdicts: data.gateVerdicts ?? [],
      diagnostics: data.diagnostics,
    });

    return formatted;
  } catch {
    return `⚠️ PRAXIS verify — raw output:\n\`\`\`\n${result.stdout.trim()}\n\`\`\`\n\`\`\`\n${result.stderr.trim()}\n\`\`\``;
  }
}

// ---------------------------------------------------------------------------
// /praxis status [--run-id <id>]
// ---------------------------------------------------------------------------

export async function slashStatus(
  runId: string | undefined,
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  const args = ['status', '--json'];
  if (runId) args.push('--run-id', runId);

  const result = await execPraxis(args, config, repoRoot);

  if (result.error) {
    return `❌ PRAXIS status failed: ${result.error}`;
  }

  try {
    const data = JSON.parse(result.stdout);
    return `📊 PRAXIS Status\n\nRun ID: \`${data.runId}\`\nStatus: ${data.status}\n\n${data.note ?? ''}`;
  } catch {
    return `📊 PRAXIS Status\n\n\`\`\`\n${result.stdout.trim()}\n\`\`\``;
  }
}

// ---------------------------------------------------------------------------
// /praxis report [--run-id <id>]
// ---------------------------------------------------------------------------

export async function slashReport(
  runId: string | undefined,
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  const args = ['report', 'show', '--json'];
  if (runId) args.push('--run-id', runId);

  const result = await execPraxis(args, config, repoRoot);

  if (result.error) {
    return `❌ PRAXIS report failed: ${result.error}`;
  }

  try {
    const data = JSON.parse(result.stdout);
    return `📋 PRAXIS Report\n\nRun ID: \`${data.runId}\`\nStatus: ${data.status}\n\n${data.note ?? 'Report generation is not yet implemented. Run "praxis verify --plan <path>" for gate verdicts.'}`;
  } catch {
    return `📋 PRAXIS Report\n\n\`\`\`\n${result.stdout.trim()}\n\`\`\``;
  }
}

// ---------------------------------------------------------------------------
// /praxis ledger [--kind <k>] [--limit <n>]
// ---------------------------------------------------------------------------

export async function slashLedger(
  kind: string | undefined,
  limit: number | undefined,
  runId: string | undefined,
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  // Use latest run if not specified
  const effectiveRunId = runId ?? 'latest';
  const args = ['ledger', 'show', '--json', '--run-id', effectiveRunId];
  if (kind) args.push('--kind', kind);
  if (limit !== undefined && limit > 0) args.push('--limit', String(limit));

  const result = await execPraxis(args, config, repoRoot);

  if (result.error) {
    return `❌ PRAXIS ledger failed: ${result.error}`;
  }

  try {
    const data = JSON.parse(result.stdout);

    if (data.error) {
      return `⚠️ PRAXIS ledger: ${data.error}\n\nRun \`/praxis verify\` first to generate evidence.`;
    }

    let msg = `📄 PRAXIS Evidence Ledger\n\n`;
    msg += `Run ID: \`${data.runId}\`\n`;
    msg += `Records: ${data.shownRecords} (of ${data.totalRecords} total)\n`;

    if (kind) msg += `Filter: type=\`${kind}\`\n`;
    msg += '\n';

    if (data.records && data.records.length > 0) {
      for (const rec of data.records) {
        msg += `**${rec.recordId}**\n`;
        msg += `- Type: \`${rec.type}\`\n`;
        msg += `- Source: \`${rec.source}\`\n`;
        msg += `- Time: ${rec.timestamp}\n`;
        if (rec.summary) msg += `- Summary: ${rec.summary}\n`;
        if (rec.path) msg += `- Path: \`${rec.path}\`\n`;
        msg += '\n';
      }
    } else {
      msg += '_(no evidence records found)_\n';
    }

    return msg;
  } catch {
    return `📄 PRAXIS Evidence Ledger\n\n\`\`\`\n${result.stdout.trim()}\n\`\`\``;
  }
}

// ---------------------------------------------------------------------------
// /praxis repair show [--run-id <id>]
// ---------------------------------------------------------------------------

export async function slashRepairShow(
  runId: string | undefined,
  _config: PluginConfig,
  _repoRoot: string,
): Promise<string> {
  const runIdStr = runId ?? 'latest';
  return `🔧 PRAXIS Repair Intelligence\n\nRun ID: \`${runIdStr}\`\n\nRepair module is not yet implemented in the CLI. The RIM (Repair Intelligence Module) is part of the PRAXIS kernel and will be exposed as \`praxis repair show\` in a future release.\n\nFor now, review gate verdicts with \`/praxis verify\` and inspect failing reason codes manually.`;
}

// ---------------------------------------------------------------------------
// /praxis help
// ---------------------------------------------------------------------------

export function slashHelp(): string {
  return `**PRAXIS Plugin Commands**

| Command | Description |
|---------|-------------|
| \`/praxis init\` | Initialize a new PRAXIS plan (\`.praxis/plan.yaml\`) |
| \`/praxis plan validate <path>\` | Validate a PlanSpec against the schema |
| \`/praxis plan lock <path>\` | Create/verify a plan lock file |
| \`/praxis verify [--plan <path>]\` | Run full Truth Kernel verification pipeline (all 6 gates) |
| \`/praxis status [--run-id <id>]\` | Show current verification status |
| \`/praxis report [--run-id <id>]\` | Show verification report |
| \`/praxis ledger [--kind <k>] [--limit <n>]\` | Show evidence ledger records |
| \`/praxis repair show [--run-id <id>]\` | Show repair status |
| \`/praxis help\` | Show this help |

**About PRAXIS**

PRAXIS is a local Truth Kernel for agentic coding tools. It answers one question: _"Did the agent actually complete the task?"_

The plugin is **read-only display + dispatch**. It never decides truth. The kernel's FinalGate is the sole completion authority.

**The Three Laws:**
1. **Completion Authority** — Agent says done does not mean done. FinalGate PASS = done.
2. **Write Authority** — No worker writes to shared integration files.
3. **Verification Authority** — Criteria come from human-authored TaskSpec. Agents cannot define their own.

**Exit codes:** 0=PASS, 1=HOLD, 2=FAIL, 3=error
`;
}

// ---------------------------------------------------------------------------
// Command router
// ---------------------------------------------------------------------------

export type SlashCommand =
  | { kind: 'init' }
  | { kind: 'plan'; sub: 'validate' | 'lock'; path: string }
  | { kind: 'verify'; planPath?: string }
  | { kind: 'status'; runId?: string }
  | { kind: 'report'; runId?: string }
  | { kind: 'ledger'; kind_filter?: string; limit?: number; runId?: string }
  | { kind: 'repair_show'; runId?: string }
  | { kind: 'help' };

/**
 * Parse a slash command argument string into a structured command.
 */
export function parseSlashCommand(args: string): SlashCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0 || parts[0] === 'help') {
    return { kind: 'help' };
  }

  const cmd = parts[0];
  const rest = parts.slice(1);

  switch (cmd) {
    case 'init':
      return { kind: 'init' };

    case 'plan': {
      if (rest.length < 2) {
        throw new Error('Usage: /praxis plan <validate|lock> <path>');
      }
      const sub = rest[0];
      if (sub !== 'validate' && sub !== 'lock') {
        throw new Error(`Unknown plan subcommand: ${sub}. Use validate or lock.`);
      }
      return { kind: 'plan', sub, path: rest[1] };
    }

    case 'verify': {
      let planPath: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--plan' && i + 1 < rest.length) {
          planPath = rest[i + 1];
          i++;
        }
      }
      return { kind: 'verify', planPath };
    }

    case 'status': {
      let runId: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--run-id' && i + 1 < rest.length) {
          runId = rest[i + 1];
          i++;
        }
      }
      return { kind: 'status', runId };
    }

    case 'report': {
      let runId: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--run-id' && i + 1 < rest.length) {
          runId = rest[i + 1];
          i++;
        }
      }
      return { kind: 'report', runId };
    }

    case 'ledger': {
      let kind_filter: string | undefined;
      let limit: number | undefined;
      let runId: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--kind' && i + 1 < rest.length) {
          kind_filter = rest[i + 1];
          i++;
        } else if (rest[i] === '--limit' && i + 1 < rest.length) {
          limit = parseInt(rest[i + 1], 10);
          i++;
        } else if (rest[i] === '--run-id' && i + 1 < rest.length) {
          runId = rest[i + 1];
          i++;
        }
      }
      return { kind: 'ledger', kind_filter, limit, runId };
    }

    case 'repair': {
      if (rest[0] !== 'show') {
        throw new Error('Usage: /praxis repair show [--run-id <id>]');
      }
      let runId: string | undefined;
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === '--run-id' && i + 1 < rest.length) {
          runId = rest[i + 1];
          i++;
        }
      }
      return { kind: 'repair_show', runId };
    }

    case 'help':
      return { kind: 'help' };

    default:
      throw new Error(`Unknown command: ${cmd}. Use /praxis help for available commands.`);
  }
}

/**
 * Execute a parsed slash command and return formatted display text.
 */
export async function executeSlashCommand(
  cmd: SlashCommand,
  config: PluginConfig,
  repoRoot: string,
): Promise<string> {
  switch (cmd.kind) {
    case 'init':
      return await slashInit(config, repoRoot);

    case 'plan':
      if (cmd.sub === 'validate') {
        return await slashPlanValidate(cmd.path, config, repoRoot);
      } else {
        return await slashPlanLock(cmd.path, config, repoRoot);
      }

    case 'verify':
      return await slashVerify(cmd.planPath, config, repoRoot);

    case 'status':
      return await slashStatus(cmd.runId, config, repoRoot);

    case 'report':
      return await slashReport(cmd.runId, config, repoRoot);

    case 'ledger':
      return await slashLedger(cmd.kind_filter, cmd.limit, cmd.runId, config, repoRoot);

    case 'repair_show':
      return await slashRepairShow(cmd.runId, config, repoRoot);

    case 'help':
      return slashHelp();
  }
}
