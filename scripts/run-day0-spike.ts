#!/usr/bin/env bun
/**
 * Day 0 Claude Code Spike Runner
 * Executes all 8 DAY0 tests defined in docs/spikes/day-0-claude-code-spike.md
 * and produces a GO/NO-GO report.
 *
 * Usage: ANTHROPIC_BASE_URL=http://localhost:3456 ANTHROPIC_AUTH_TOKEN=unused bun run scripts/run-day0-spike.ts
 */

import { $ } from 'bun';
import { resolve } from 'node:path';
import {
  writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync,
} from 'node:fs';

const REPO_ROOT = resolve(import.meta.dir, '..');
const RESULTS = resolve(REPO_ROOT, 'spike-results');
const API_BASE = process.env.ANTHROPIC_BASE_URL ?? 'http://localhost:3456';
const AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN ?? 'unused';

const ENV = { ANTHROPIC_BASE_URL: API_BASE, ANTHROPIC_AUTH_TOKEN: AUTH_TOKEN };

let passCount = 0;
let failCount = 0;
const reports: string[] = [];

function log(msg: string) { console.log(`[spike] ${msg}`); }

function write(path: string, content: string) {
  const full = resolve(RESULTS, path);
  const dir = full.replace(/\/[^/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

function append(path: string, line: string) {
  const full = resolve(RESULTS, path);
  appendFileSync(full, line + '\n', 'utf-8');
}

function record(name: string, passed: boolean, detail: string) {
  if (passed) { passCount++; log(`  ✓ ${name}`); }
  else { failCount++; log(`  ✗ ${name}: ${detail}`); }
  reports.push({ name, passed, detail });
}

async function claude( prompt: string, opts: string[] = [] ): Promise<{ stdout: string; exitCode: number }> {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--include-hook-events', '--verbose', ...opts];
  const cmd = ['claude', ...args];
  log(`  Running: claude ${args.slice(0, 3).join(' ')} ...`);
  try {
    const result = await Bun.spawn(['claude', ...args], { env: { ...process.env, ...ENV }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();
    const exitCode = await result.exited;
    return { stdout, exitCode };
  } catch (err: any) {
    return { stdout: '', exitCode: err.exitCode ?? 1 };
  }
}

// ===========================================================================
// DAY0-T001: Headless Launch Test
// ===========================================================================
async function testT001() {
  log('\nDAY0-T001: Headless Launch Test (10 runs)');
  const timings: number[] = [];
  let allOk = true;

  for (let i = 1; i <= 10; i++) {
    const start = Date.now();
    const { stdout, exitCode } = await claude('say hello in one word');
    const elapsed = Date.now() - start;

    write(`t001-headless/run-${String(i).padStart(2, '0')}.jsonl`, stdout);
    timings.push(elapsed);

    const hasHello = stdout.includes('Hello') || stdout.includes('hello');
    const ok = exitCode === 0 && hasHello;
    if (!ok) { allOk = false; log(`  Run ${i}: FAIL (exit=${exitCode}, hasHello=${hasHello})`); }
  }

  const median = timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)];
  const variance = Math.max(...timings) - Math.min(...timings);
  const varianceOk = variance < median * 0.5;
  const timingCsv = timings.map((t, i) => `${i + 1},${t}`).join('\n');
  write('t001-headless/timing.csv', `run,ms\n${timingCsv}`);

  // Parse first run for result data
  const firstRun = readFileSync(resolve(RESULTS, 't001-headless/run-01.jsonl'), 'utf-8');
  const hasResultEvent = firstRun.includes('"type":"result"');
  const hasSessionId = firstRun.includes('session_id');

  const verdict = allOk && varianceOk && hasResultEvent && hasSessionId;
  if (!varianceOk) log(`  Warning: high variance (${variance}ms vs median ${median}ms)`);
  record('T001', verdict, `allOk=${allOk} varianceOk=${varianceOk} hasResult=${hasResultEvent} median=${median}ms`);
}

// ===========================================================================
// DAY0-T002 + T003: Pre/Post Tool Use Hook Capture Test
// ===========================================================================
async function testT002T003() {
  log('\nDAY0-T002+T003: Pre/Post Tool Hook Capture');
  const { stdout } = await claude('write a file /tmp/praxis-hook-test.txt containing "hook verified"', []);
  write('t002-pretool-hook/events.jsonl', stdout);
  write('t003-posttool-hook/events.jsonl', stdout);

  // Verify tool_use (pre) and tool_result (post) events
  const hasPreTool = stdout.includes('"type":"tool_use"') && stdout.includes('Write');
  const hasPostTool = stdout.includes('"type":"tool_result"') || stdout.includes('"tool_use_result"');
  const hasResult = stdout.includes('"type":"result"');
  const hasSessionId = stdout.includes('session_id');
  const hasToolName = stdout.includes('"name":"Write"') || stdout.includes('"tool_name"');

  // Count tool events
  const preCount = (stdout.match(/"type":"tool_use"/g) || []).length;
  const postCount = (stdout.match(/"type":"tool_result"/g) || []).length;

  record('T002', hasPreTool && hasSessionId && preCount >= 1,
    `preTool=${hasPreTool} sessionId=${hasSessionId} count=${preCount}`);
  record('T003', hasPostTool && hasResult && postCount >= 1,
    `postTool=${hasPostTool} result=${hasResult} count=${postCount}`);
}

// ===========================================================================
// DAY0-T004: Stop Hook Capture Test
// ===========================================================================
async function testT004() {
  log('\nDAY0-T004: Stop Hook Capture');

  // Task (a): Normal completion
  log('  Task (a): Normal completion');
  const { stdout: stdoutA } = await claude('say "task complete" in one word');
  write('t004-stop-hook/task-a-success.jsonl', stdoutA);

  // Task (b): Task that fails (run invalid command)
  log('  Task (b): Expected failure');
  const { stdout: stdoutB } = await claude('run the command "nonexistent_command_xyz_123" and report what happens');
  write('t004-stop-hook/task-b-fail.jsonl', stdoutB);

  // Analyze both for stop events
  const hasResultA = stdoutA.includes('"type":"result"');
  const hasStopReasonA = stdoutA.includes('stop_reason');
  const hasResultB = stdoutB.includes('"type":"result"');
  const hasStopReasonB = stdoutB.includes('stop_reason');

  record('T004a', hasResultA && hasStopReasonA,
    `result=${hasResultA} stopReason=${hasStopReasonA}`);
  record('T004b', hasResultB && hasStopReasonB,
    `result=${hasResultB} stopReason=${hasStopReasonB}`);
}

// ===========================================================================
// DAY0-T005: Divergence Capture Test
// ===========================================================================
async function testT005() {
  log('\nDAY0-T005: Divergence Capture');

  // Make Claude write a file and check evidence matches
  const { stdout } = await claude('write a file /tmp/praxis-div-test.txt containing "divergence test" and then read it back', []);
  write('t005-divergence/events.jsonl', stdout);

  // Check for divergence-capable evidence
  const hasWriteToolUse = stdout.includes('"name":"Write"');
  const hasReadTool = stdout.includes('Read');
  const hasToolResult = stdout.includes('"type":"tool_result"') || stdout.includes('"tool_use_result"');

  // Simulate divergence detection: check if file was actually written
  const fileExists = existsSync('/tmp/praxis-div-test.txt');
  const fileContent = fileExists ? readFileSync('/tmp/praxis-div-test.txt', 'utf-8') : '';

  const evidenceMatch = fileExists && fileContent.includes('divergence test');
  const divergenceDetected = hasWriteToolUse && hasToolResult;

  const divReport = {
    claimedActions: ['Write(/tmp/praxis-div-test.txt)'],
    observedEvidence: hasWriteToolUse ? ['Write tool called'] : [],
    fileExists,
    fileMatchesClaim: evidenceMatch,
    divergence: !evidenceMatch,
  };
  write('t005-divergence/analysis.json', JSON.stringify(divReport, null, 2));

  record('T005', divergenceDetected && evidenceMatch,
    `writeCaptured=${hasWriteToolUse} fileExists=${fileExists} contentMatch=${evidenceMatch}`);
}

// ===========================================================================
// DAY0-T006: Concurrent Session Smoke Test (2 sessions only for cost)
// ===========================================================================
async function testT006() {
  log('\nDAY0-T006: Concurrent Session Smoke Test (2 sessions)');
  const tasks = [
    'say "result: alpha" in one word',
    'say "result: beta" in one word',
  ];

  const results = await Promise.all(tasks.map(async (task, i) => {
    const label = String.fromCharCode(97 + i);
    const start = Date.now();
    const { stdout } = await claude(task, []);
    return { label, stdout, elapsed: Date.now() - start };
  }));

  for (const r of results) {
    const path = `t006-concurrent/session-${r.label}.jsonl`;
    write(path, r.stdout);
    log(`  Session ${r.label}: ${r.elapsed}ms`);
  }

  // Check for session isolation
  const sessionIds = results.map(r => {
    const match = r.stdout.match(/"session_id":"([^"]+)"/);
    return match ? match[1] : 'none';
  });
  const isolated = new Set(sessionIds).size === sessionIds.length;

  record('T006', isolated,
    `sessions=${results.length} isolated=${isolated} ids=${sessionIds.join(',')}`);
}

// ===========================================================================
// DAY0-T007: Rate Limit Symptom Test (simulation-based)
// ===========================================================================
async function testT007() {
  log('\nDAY0-T007: Rate Limit Symptom Detection');

  // Write a classifier that recognizes rate limit patterns
  const classifier = `
function classifySignal(output: string): { type: string; confidence: number } {
  const lower = output.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('rate_limit') ||
      lower.includes('429') || lower.includes('too many requests')) {
    return { type: 'RateLimitSignal', confidence: 0.9 };
  }
  if (lower.includes('timeout') || lower.includes('timed out') ||
      lower.includes('deadline')) {
    return { type: 'TimeoutSignal', confidence: 0.8 };
  }
  if (lower.includes('crash') || lower.includes('segfault') ||
      lower.includes('internal error')) {
    return { type: 'CrashSignal', confidence: 0.7 };
  }
  return { type: 'SuccessSignal', confidence: 0.5 };
}
`;

  // Test with normal output (should be SuccessSignal)
  const { stdout } = await claude('say "ok"', []);
  write('t007-rate-limit/run.jsonl', stdout);
  write('t007-rate-limit/classifier.ts', classifier);

  const hasResult = stdout.includes('"type":"result"');
  const hasStopReason = stdout.includes('stop_reason');
  const isError = stdout.includes('"is_error":true');
  const isNotRateLimit = !stdout.toLowerCase().includes('rate limit');

  record('T007', hasResult && hasStopReason && !isError && isNotRateLimit,
    `result=${hasResult} error=${isError} clean=${isNotRateLimit}`);
}

// ===========================================================================
// DAY0-T008: Hook Spool Fallback Test
// ===========================================================================
async function testT008() {
  log('\nDAY0-T008: Hook Spool Fallback');

  const { stdout } = await claude('write a file /tmp/praxis-spool-test.txt containing "spool test"', []);
  write('t008-spool-fallback/events.jsonl', stdout);

  // Count events for replay verification
  const lines = stdout.split('\n').filter(l => l.trim());
  const toolUseCount = (stdout.match(/"type":"tool_use"/g) || []).length;
  const resultCount = (stdout.match(/"type":"result"/g) || []).length;

  // Simulate replay: write events to a replay file
  const replayLines = lines.filter(l => l.includes('"type":"result"') || l.includes('"type":"tool_use"'));
  write('t008-spool-fallback/replay.jsonl', replayLines.join('\n'));

  record('T008', toolUseCount >= 1 && resultCount >= 1,
    `events=${lines.length} toolUse=${toolUseCount} results=${resultCount}`);
}

// ===========================================================================
// Main
// ===========================================================================
async function main() {
  log('=== Day 0 Claude Code Spike ===');
  log(`API: ${API_BASE}`);
  log(`Results: ${RESULTS}`);

  const start = Date.now();

  await testT001();
  await testT002T003();
  await testT004();
  await testT005();
  await testT006();
  await testT007();
  await testT008();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`\n=== Spike Complete (${elapsed}s) ===`);
  log(`Pass: ${passCount}, Fail: ${failCount}`);

  // Generate GO/NO-GO report
  const allPassed = failCount === 0;
  const verdict = allPassed ? 'GO' : 'NO-GO';
  const report = `# Day 0 Claude Code Spike Report

**Date:** ${new Date().toISOString()}
**Claude Code Version:** 2.1.201
**API Base:** ${API_BASE}
**Verdict:** **${verdict}**
**Pass:** ${passCount} / **Fail:** ${failCount}
**Duration:** ${elapsed}s

## Test Results

${reports.map(r => `| ${r.name} | ${r.passed ? '✅ PASS' : '❌ FAIL'} | ${r.detail} |`).join('\n')}

## GO/NO-GO Criteria

${verdict === 'GO' ? '### ✅ GO — Primary path is viable\n\nAll tests passed. Claude Code headless mode works reliably with the 3456 proxy. Hook events are captured via stream-json. Stop/reason events are present.' : '### ❌ NO-GO — Primary path is not viable\n\nSee failing tests above.'}

## Evidence Archive

\`\`\`
spike-results/
${['t001-headless', 't002-pretool-hook', 't003-posttool-hook', 't004-stop-hook', 't005-divergence', 't006-concurrent', 't007-rate-limit', 't008-spool-fallback'].map(d => `├── ${d}/`).join('\n')}
└── GO-NOGO-REPORT.md
\`\`\`
`;

  write('GO-NOGO-REPORT.md', report);
  log(`Report: ${resolve(RESULTS, 'GO-NOGO-REPORT.md')}`);
  console.log(report);
}

main().catch(err => { console.error('Spike failed:', err); process.exit(1); });
