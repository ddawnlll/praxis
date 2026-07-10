/**
 * run-benchmark.ts — Orchestrate a single paired benchmark run.
 *
 * Usage:
 *   # Single task
 *   bun run run-benchmark.ts T01 --seed /path/to/pulsequeue-seed --task-pack ../task-pack/T01-idempotency.md
 *
 * This script:
 *   1. Clones seed repo to a temp directory
 *   2. Determines arm order randomly
 *   3. Runs baseline or praxis
 *   4. Captures all metrics
 *   5. Runs hidden evaluator
 *   6. Saves results
 */
import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync, cpSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

interface RunConfig {
  taskId: string;
  seedPath: string;
  taskPackPath: string;
  planPath?: string;
  promptPath: string;
  armOrder: "baseline-first" | "praxis-first";
  outputDir: string;
}

async function cloneSeed(seedPath: string, destDir: string): Promise<void> {
  // Copy seed repo (no git history for clean room)
  cpSync(seedPath, destDir, { recursive: true });
  // Remove .git to ensure clean state
  await $`rm -rf ${join(destDir, ".git")}`;
  await $`cd ${destDir} && git init && git add -A && git commit -m "seed" 2>/dev/null`;
}

async function runBaseline(config: RunConfig, workspace: string): Promise<any> {
  console.log(`[Baseline] Starting ${config.taskId}...`);

  const startTime = Date.now();
  // The agent runs here — this is a placeholder for the actual agent execution
  // In real benchmark, this would be a subprocess call to the coding agent

  // For now, we record a placeholder
  const result = {
    doneClaims: 0,
    repairLoops: 0,
    metrics: {
      totalTokens: 0,
      wallClockMs: Date.now() - startTime,
      agentCommands: 0,
      testCommands: 0,
    },
    praxisVerdict: null,
  };

  return result;
}

async function runPraxis(config: RunConfig, workspace: string): Promise<any> {
  console.log(`[Praxis] Starting ${config.taskId}...`);

  const startTime = Date.now();

  // Agent runs here (placeholder)
  // After agent says "done", run praxis verify

  let praxisVerdicts: any[] = [];
  let repairCount = 0;
  const maxRepair = 3;

  for (let i = 0; i <= maxRepair; i++) {
    // Run praxis verify
    try {
      const verifyOutput = await $`cd ${workspace} && praxis verify --plan ${config.planPath} 2>&1`.text();
      // Parse verdict
      const hasFail = verifyOutput.includes("FAIL") || verifyOutput.includes("HOLD");
      const verdict = hasFail ? "HOLD" : "PASS";
      praxisVerdicts.push({ loop: i, verdict, output: verifyOutput.slice(0, 500) });

      if (verdict === "PASS") break;

      // Apply repair
      repairCount++;
      if (repairCount >= maxRepair) break;

      console.log(`[Praxis] Repair loop ${repairCount}: applying repair packet...`);
      // In real benchmark: feed repair packet to agent
    } catch (e: any) {
      praxisVerdicts.push({ loop: i, verdict: "FAIL", error: e.message });
      break;
    }
  }

  const result = {
    doneClaims: repairCount + 1,
    repairLoops: repairCount,
    metrics: {
      totalTokens: 0,
      wallClockMs: Date.now() - startTime,
      agentCommands: 0,
      testCommands: 0,
      praxisVerifyMs: 0,
    },
    praxisVerdict: praxisVerdicts.length > 0 ? praxisVerdicts[praxisVerdicts.length - 1] : null,
  };

  return result;
}

async function runHiddenEvaluator(taskId: string, workspace: string): Promise<any> {
  const evalDir = join(dirname(new URL(import.meta.url).pathname), "hidden-evaluator");
  const evalFile = join(evalDir, `T${taskId.slice(0, 2)}-eval.ts`);

  if (!existsSync(evalFile)) {
    return { results: {}, summary: { pass: 0, fail: 0, total: 0 } };
  }

  try {
    const output = await $`bun run ${evalFile} ${workspace} 2>&1`.text();
    return JSON.parse(output);
  } catch (e: any) {
    // Try to parse partial JSON from output
    const match = e.message?.match(/\{.*\}/s);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return {
      results: {},
      summary: { pass: 0, fail: 0, total: 0 },
      error: e.message,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const taskId = args.find(a => a.startsWith("T0"));

  const config: RunConfig = {
    taskId: taskId || "T01",
    seedPath: args[args.indexOf("--seed") + 1] || "/workspace/pulsequeue-seed",
    taskPackPath: args[args.indexOf("--task-pack") + 1] || "",
    planPath: args[args.indexOf("--plan") + 1] || undefined,
    promptPath: args[args.indexOf("--prompt") + 1] || "",
    armOrder: Math.random() > 0.5 ? "baseline-first" : "praxis-first",
    outputDir: args[args.indexOf("--output") + 1] || "./results",
  };

  if (!existsSync(config.outputDir)) mkdirSync(config.outputDir, { recursive: true });

  const runId = `${config.taskId}-${randomUUID().slice(0, 8)}`;
  console.log(`\n=== PRAXIS BENCHMARK RUN ===`);
  console.log(`Run ID: ${runId}`);
  console.log(`Task: ${config.taskId}`);
  console.log(`Arm order: ${config.armOrder}`);
  console.log(`===========================\n`);

  // Create workspaces
  const baselineDir = `/tmp/pq-baseline-${runId}`;
  const praxisDir = `/tmp/pq-praxis-${runId}`;

  console.log("Cloning seed repositories...");
  await cloneSeed(config.seedPath, baselineDir);
  await cloneSeed(config.seedPath, praxisDir);

  // Run arms in determined order
  const arms = config.armOrder === "baseline-first"
    ? [["baseline", baselineDir], ["praxis", praxisDir]] as const
    : [["praxis", praxisDir], ["baseline", baselineDir]] as const;

  const results: any[] = [];

  for (const [arm, workspace] of arms) {
    console.log(`\n--- Running ${arm} arm ---`);

    const armConfig = { ...config };
    let armResult: any;

    if (arm === "baseline") {
      armResult = await runBaseline(armConfig, workspace);
    } else {
      armResult = await runPraxis(armConfig, workspace);
    }

    console.log(`Running hidden evaluator for ${arm}...`);
    const hiddenEval = await runHiddenEvaluator(config.taskId, workspace);

    const result = {
      benchmark: "pulsequeue-v01",
      version: "0.1.0",
      runId: `${runId}-${arm}`,
      taskId: config.taskId,
      arm,
      repNumber: 1,
      model: "deepseek-v4-flash",
      provider: "opencode-go",
      timestamp: new Date().toISOString(),
      ...armResult,
      hiddenEval,
    };

    // Save individual result
    const resultFile = join(config.outputDir, `${config.taskId}-${arm}-${runId}.json`);
    writeFileSync(resultFile, JSON.stringify(result, null, 2));
    console.log(`Result saved: ${resultFile}`);

    results.push(result);
  }

  // Run scorer
  for (const result of results) {
    const scoredFile = join(config.outputDir, `scored-${result.runId}.json`);
    // Inline scoring
    const totalAC = result.hiddenEval.summary.total;
    const scored = {
      ...result,
      derived: {
        falseDone: result.hiddenEval.summary.fail > 0,
        firstClaimComplete: result.hiddenEval.summary.pass === totalAC,
        finalComplete: result.hiddenEval.summary.pass === totalAC,
        praxisFalsePass: result.praxisVerdict?.verdict === "PASS" ? result.hiddenEval.summary.fail > 0 : null,
        passRatio: totalAC > 0 ? result.hiddenEval.summary.pass / totalAC : 0,
        failRatio: totalAC > 0 ? result.hiddenEval.summary.fail / totalAC : 0,
        score: totalAC > 0 ? result.hiddenEval.summary.pass / totalAC : 0,
      },
    };
    writeFileSync(scoredFile, JSON.stringify(scored, null, 2));
  }

  // Cleanup temp dirs
  await $`rm -rf ${baselineDir} ${praxisDir}`;

  console.log(`\n=== RUN COMPLETE: ${runId} ===`);
  console.log(`Results in: ${config.outputDir}/`);
}

await main();
