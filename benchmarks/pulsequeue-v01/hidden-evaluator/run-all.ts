/**
 * Hidden Evaluator Runner — runs all evaluators for a given task.
 *
 * Usage: bun run run-all.ts <workspace-path> <task-id> <run-id>
 *
 * Outputs JSON result to stdout and saves to results/ directory.
 */
import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const evaluators: Record<string, string> = {
  "T01": "T01-eval.ts",
  "T02": "T02-eval.ts",
  "T03": "T03-eval.ts",
  "T04": "T04-eval.ts",
  "T05": "T05-eval.ts",
};

async function main() {
  const workspace = process.argv[2];
  const taskId = process.argv[3];
  const runId = process.argv[4] || "unknown";

  if (!workspace || !taskId) {
    console.error("Usage: run-all.ts <workspace-path> <task-id> [run-id]");
    process.exit(1);
  }

  const evalFile = evaluators[taskId];
  if (!evalFile) {
    console.error(`Unknown task: ${taskId}. Available: ${Object.keys(evaluators).join(", ")}`);
    process.exit(1);
  }

  const evalPath = join(dirname(new URL(import.meta.url).pathname), evalFile);

  // Run the evaluator
  const proc = Bun.spawn(["bun", "run", evalPath, workspace], {
    env: { ...process.env }
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  // Parse result
  let result: any;
  try {
    result = JSON.parse(output);
  } catch {
    result = { task: taskId, error: "Failed to parse evaluator output", raw: output };
  }

  // Add metadata
  result.runId = runId;
  result.timestamp = new Date().toISOString();
  result.exitCode = exitCode;

  // Save to results directory
  const resultsDir = join(workspace, "../results");
  if (existsSync(resultsDir)) {
    const resultFile = join(resultsDir, `${taskId}-${runId}.json`);
    writeFileSync(resultFile, JSON.stringify(result, null, 2));
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

await main();
