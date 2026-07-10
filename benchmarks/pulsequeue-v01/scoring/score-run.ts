/**
 * score-run.ts — Validate and score a single benchmark run.
 *
 * Usage: bun run score-run.ts <result-json-file>
 * Outputs: scored result with derived metrics
 */

import { readFileSync, existsSync } from "fs";

interface RawResult {
  benchmark: string;
  version: string;
  runId: string;
  taskId: string;
  arm: "baseline" | "praxis";
  repNumber: number;
  model: string;
  provider: string;
  timestamp: string;
  doneClaims: number;
  repairLoops: number;
  hiddenEval: {
    results: Record<string, boolean>;
    summary: { pass: number; fail: number; total: number };
  };
  praxisVerdict: {
    verdict: string;
    repairPackets: unknown[];
    gates: Array<{ gate: string; verdict: string; reasonCodes: string[] }>;
  } | null;
  metrics: {
    totalTokens: number;
    wallClockMs: number;
    agentCommands: number;
    testCommands: number;
    modelCostUsd?: number;
    praxisVerifyMs?: number;
  };
  scopeChecks?: {
    filesChangedOutsideAllowed?: number;
    testsSkipped?: number;
    orphanModules?: number;
  };
}

interface ScoredResult extends RawResult {
  derived: {
    falseDone: boolean;
    firstClaimComplete: boolean;
    finalComplete: boolean;
    praxisFalsePass: boolean | null;
    passRatio: number;
    failRatio: number;
    repairEfficiency: number;
    score: number;
  };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath || !existsSync(filePath)) {
    console.error("Usage: score-run.ts <result-json-file>");
    process.exit(1);
  }

  const raw: RawResult = JSON.parse(readFileSync(filePath, "utf-8"));
  const hidden = raw.hiddenEval;
  const praxis = raw.praxisVerdict;
  const totalAC = hidden.summary.total;

  // Derived metrics
  const falseDone = hidden.summary.fail > 0;
  const firstClaimComplete = hidden.summary.pass === totalAC;
  const finalComplete = hidden.summary.pass === totalAC;

  // Praxis false-PASS: Praxis said PASS but hidden evaluator failed
  let praxisFalsePass: boolean | null = null;
  if (praxis && praxis.verdict === "PASS") {
    praxisFalsePass = hidden.summary.fail > 0;
  }

  const passRatio = totalAC > 0 ? hidden.summary.pass / totalAC : 0;
  const failRatio = totalAC > 0 ? hidden.summary.fail / totalAC : 0;

  // Repair efficiency: how many failures were fixed per repair loop
  const repairEfficiency = raw.repairLoops > 0
    ? hidden.summary.pass / (hidden.summary.pass + hidden.summary.fail)
    : 0;

  // Composite score: 1.0 = perfect
  let score = passRatio;
  if (falseDone) score *= 0.5;        // penalty for false done
  if (praxisFalsePass) score *= 0.1;  // severe penalty for false PASS
  if (raw.metrics.wallClockMs > 300000) score *= 0.8; // >5min penalty

  const scored: ScoredResult = {
    ...raw,
    derived: {
      falseDone,
      firstClaimComplete,
      finalComplete,
      praxisFalsePass,
      passRatio: Math.round(passRatio * 100) / 100,
      failRatio: Math.round(failRatio * 100) / 100,
      repairEfficiency: Math.round(repairEfficiency * 100) / 100,
      score: Math.round(score * 100) / 100,
    },
  };

  console.log(JSON.stringify(scored, null, 2));
}

main();
