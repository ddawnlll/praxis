/**
 * aggregate-results.ts — Aggregate multiple scored runs into a summary.
 *
 * Usage: bun run aggregate-results.ts <results-dir>
 * Outputs: group-level summary with comparison table
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

interface ScoredResult {
  runId: string;
  taskId: string;
  arm: "baseline" | "praxis";
  repNumber: number;
  model: string;
  hiddenEval: { summary: { pass: number; fail: number; total: number } };
  praxisVerdict: { verdict: string } | null;
  metrics: { totalTokens: number; wallClockMs: number; agentCommands: number; testCommands: number };
  derived: {
    falseDone: boolean;
    firstClaimComplete: boolean;
    finalComplete: boolean;
    praxisFalsePass: boolean | null;
    passRatio: number;
    failRatio: number;
    score: number;
  };
}

interface AggregateRow {
  taskId: string;
  baselineFalseDone: number;
  praxisFalseDone: number;
  baselineFirstComplete: number;
  praxisFirstComplete: number;
  baselineFinalComplete: number;
  praxisFinalComplete: number;
  baselineScore: number;
  praxisScore: number;
  praxisFalsePass: number;
  baselineTokens: number;
  praxisTokens: number;
  baselineTimeMs: number;
  praxisTimeMs: number;
}

function main() {
  const resultsDir = process.argv[2] || ".";
  if (!existsSync(resultsDir)) {
    console.error(`Directory not found: ${resultsDir}`);
    process.exit(1);
  }

  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith(".json"))
    .map(f => join(resultsDir, f));

  const runs: ScoredResult[] = [];
  for (const file of files) {
    try {
      runs.push(JSON.parse(readFileSync(file, "utf-8")));
    } catch { /* skip unparseable */ }
  }

  console.log(`Loaded ${runs.length} scored runs from ${resultsDir}\n`);

  // Group by taskId
  const byTask = new Map<string, ScoredResult[]>();
  for (const run of runs) {
    const task = run.taskId;
    if (!byTask.has(task)) byTask.set(task, []);
    byTask.get(task)!.push(run);
  }

  console.log("=".repeat(90));
  console.log("PRAXIS A/B BENCHMARK — PULSEQUEUE v0.1");
  console.log("=".repeat(90));
  console.log();

  // Per-task table
  console.log("-".repeat(90));
  console.log("PER-TASK RESULTS");
  console.log("-".repeat(90));
  console.log(
    "Task".padEnd(8),
    "Arm".padEnd(10),
    "N".padEnd(4),
    "FalseDone".padEnd(12),
    "First%".padEnd(10),
    "Final%".padEnd(10),
    "Score".padEnd(8),
    "FP-Pass".padEnd(10),
    "Tokens".padEnd(10),
    "Time(s)".padEnd(8)
  );
  console.log("-".repeat(90));

  const allBaseline: ScoredResult[] = [];
  const allPraxis: ScoredResult[] = [];
  const tasks = ["T01", "T02", "T03", "T04", "T05"];

  for (const taskId of tasks) {
    const taskRuns = byTask.get(taskId) || [];
    const baseline = taskRuns.filter(r => r.arm === "baseline");
    const praxis = taskRuns.filter(r => r.arm === "praxis");

    allBaseline.push(...baseline);
    allPraxis.push(...praxis);

    function avg(arr: ScoredResult[], key: (r: ScoredResult) => number): number {
      if (arr.length === 0) return 0;
      return arr.reduce((s, r) => s + key(r), 0) / arr.length;
    }

    function count(arr: ScoredResult[], pred: (r: ScoredResult) => boolean): number {
      return arr.filter(pred).length;
    }

    const bFalseDone = count(baseline, r => r.derived.falseDone);
    const pFalseDone = count(praxis, r => r.derived.falseDone);
    const bFirst = count(baseline, r => r.derived.firstClaimComplete);
    const pFirst = count(praxis, r => r.derived.firstClaimComplete);
    const bFinal = count(baseline, r => r.derived.finalComplete);
    const pFinal = count(praxis, r => r.derived.finalComplete);
    const pFP = count(praxis, r => r.derived.praxisFalsePass === true);

    const row = (arm: string, n: number, fd: number, fc: number, sc: number, fp: number, tok: number, time: number) =>
      `${taskId.padEnd(8)}${arm.padEnd(10)}${String(n).padEnd(4)}${String(fd).padEnd(12)}${(fc * 100 / (n || 1)).toFixed(0).padEnd(10)}${(sc * 100 / (n || 1)).toFixed(0).padEnd(10)}${avg(taskRuns.filter(r => r.arm === arm), r => r.derived.score).toFixed(2).padEnd(8)}${fp.toString().padEnd(10)}${Math.round(tok).toString().padEnd(10)}${(time / 1000).toFixed(1).padEnd(8)}`;

    console.log(row("Baseline", baseline.length, bFalseDone, bFirst, bFinal, 0, avg(baseline, r => r.metrics.totalTokens), avg(baseline, r => r.metrics.wallClockMs)));
    console.log(row("Praxis", praxis.length, pFalseDone, pFirst, pFinal, pFP, avg(praxis, r => r.metrics.totalTokens), avg(praxis, r => r.metrics.wallClockMs)));

    if (baseline.length > 0 && praxis.length > 0) {
      const fdReduction = bFalseDone > 0
        ? ((bFalseDone - pFalseDone) / bFalseDone * 100).toFixed(0)
        : "N/A";
      console.log(`${"".padEnd(8)}${"Δ".padEnd(10)}${"".padEnd(4)}FD: ${fdReduction}%`.padEnd(50));
    }
    console.log();
  }

  // Summary
  console.log("=".repeat(90));
  console.log("GLOBAL SUMMARY");
  console.log("=".repeat(90));
  console.log();

  const totalRuns = runs.length;
  const bTotal = allBaseline.length;
  const pTotal = allPraxis.length;

  console.log(`Total runs: ${totalRuns} (Baseline: ${bTotal}, Praxis: ${pTotal})`);
  console.log();

  const bFalseDoneTotal = allBaseline.filter(r => r.derived.falseDone).length;
  const pFalseDoneTotal = allPraxis.filter(r => r.derived.falseDone).length;

  console.log("False Done Rate:");
  console.log(`  Baseline: ${bFalseDoneTotal}/${bTotal} (${(bFalseDoneTotal / bTotal * 100).toFixed(1)}%)`);
  console.log(`  Praxis:   ${pFalseDoneTotal}/${pTotal} (${(pFalseDoneTotal / pTotal * 100).toFixed(1)}%)`);

  const bFinalCompleteTotal = allBaseline.filter(r => r.derived.finalComplete).length;
  const pFinalCompleteTotal = allPraxis.filter(r => r.derived.finalComplete).length;

  console.log("\nFinal Completion Rate:");
  console.log(`  Baseline: ${bFinalCompleteTotal}/${bTotal} (${(bFinalCompleteTotal / bTotal * 100).toFixed(1)}%)`);
  console.log(`  Praxis:   ${pFinalCompleteTotal}/${pTotal} (${(pFinalCompleteTotal / pTotal * 100).toFixed(1)}%)`);

  const praxisFalsePasses = allPraxis.filter(r => r.derived.praxisFalsePass === true);
  console.log(`\nPraxis False-PASS: ${praxisFalsePasses.length}/${pTotal}`);
  if (praxisFalsePasses.length > 0) {
    praxisFalsePasses.forEach(r =>
      console.log(`  - ${r.runId} (${r.taskId}): hidden ${r.hiddenEval.summary.pass}/${r.hiddenEval.summary.total} pass`)
    );
  } else {
    console.log("  ✓ Zero false-PASS — Praxis is reliable as completion authority");
  }

  // Cost overhead
  const bAvgTokens = allBaseline.length > 0
    ? allBaseline.reduce((s, r) => s + r.metrics.totalTokens, 0) / allBaseline.length
    : 0;
  const pAvgTokens = allPraxis.length > 0
    ? allPraxis.reduce((s, r) => s + r.metrics.totalTokens, 0) / allPraxis.length
    : 0;
  console.log(`\nAvg Token Cost:`);
  console.log(`  Baseline: ${Math.round(bAvgTokens).toLocaleString()}`);
  console.log(`  Praxis:   ${Math.round(pAvgTokens).toLocaleString()}`);
  if (bAvgTokens > 0) {
    console.log(`  Overhead: ${((pAvgTokens - bAvgTokens) / bAvgTokens * 100).toFixed(1)}%`);
  }

  // GO/NO-GO
  console.log("\n" + "=".repeat(90));
  console.log("GO / NO-GO CHECK");
  console.log("=".repeat(90));

  const falseDoneReduction = bFalseDoneTotal > 0
    ? ((bFalseDoneTotal - pFalseDoneTotal) / bFalseDoneTotal * 100)
    : 0;

  console.log(`\n□ False Done Rate reduction: ${falseDoneReduction.toFixed(1)}% (target: ≥50%)`);
  console.log(`□ Final completion improvement: ${(pFinalCompleteTotal - bFinalCompleteTotal) > 0 ? "YES" : "NO"}`);
  console.log(`□ Praxis False-PASS count: ${praxisFalsePasses.length} (target: 0)`);

  const go = falseDoneReduction >= 50 && praxisFalsePasses.length === 0;
  console.log(`\n*** ${go ? "GO ✓ — Benchmark passed" : "NO-GO ✗ — Benchmark failed"} ***`);
}

main();
