/**
 * T02 Hidden Evaluator — Retry and Dead-Letter State Machine.
 *
 * Usage: bun run T02-eval.ts <workspace-path>
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

interface EvalResult {
  task: string;
  arm: string;
  results: Record<string, boolean>;
  summary: { pass: number; fail: number; total: number };
}

async function main() {
  const workspace = process.argv[2];
  if (!workspace) { console.error("Usage: T02-eval.ts <workspace-path>"); process.exit(1); }

  const results: Record<string, boolean> = {};
  let pass = 0, fail = 0;
  function check(name: string, ok: boolean) { results[name] = ok; if (ok) pass++; else fail++; }

  // 1. Worker file exists
  check("AC-worker-file", existsSync(join(workspace, "src/queue/worker.ts")));

  // 2. Retry-related code exists
  try {
    const workerContent = await $`cat ${join(workspace, "src/queue/worker.ts")}`.text();
    check("AC-retry-logic", workerContent.includes("retry") || workerContent.includes("Retry"));
    check("AC-status-retrying", workerContent.includes("retrying"));
    check("AC-status-dead", workerContent.includes("dead"));
    check("AC-attempt-count", workerContent.includes("attemptCount") || workerContent.includes("maxAttempts"));
    check("AC-clock-usage", workerContent.includes("clock") || workerContent.includes("Clock") || workerContent.includes("setTimeout"));
  } catch {
    check("AC-retry-logic", false); check("AC-status-retrying", false);
    check("AC-status-dead", false); check("AC-attempt-count", false);
    check("AC-clock-usage", false);
  }

  // 3. Worker test file exists with retry tests
  try {
    const workerTestContent = await $`cat ${join(workspace, "src/__tests__/worker.test.ts")}`.text();
    check("AC-retry-tests", workerTestContent.includes("retry") || workerTestContent.includes("Retry"));
    check("AC-fake-clock-test", workerTestContent.includes("FakeClock") || workerTestContent.includes("fake"));
    check("AC-dead-test", workerTestContent.includes("dead"));
  } catch {
    check("AC-retry-tests", false); check("AC-fake-clock-test", false); check("AC-dead-test", false);
  }

  // 4. Full test suite passes
  try {
    const testOutput = await $`cd ${workspace} && bun test 2>&1`.text();
    const passCount = (testOutput.match(/\d+ pass/g) || []).reduce((s, m) => s + parseInt(m), 0);
    const failLine = testOutput.match(/(\d+) fail/);
    const failCount = failLine ? parseInt(failLine[1]) : -1;
    check("AC-full-suite", passCount > 0 && failCount === 0);
  } catch { check("AC-full-suite", false); }

  // 5. Typecheck passes
  try {
    const tcOutput = await $`cd ${workspace} && bun run typecheck 2>&1`.text();
    check("AC-typecheck", !tcOutput.includes("error TS") && !tcOutput.includes("errors"));
  } catch { check("AC-typecheck", false); }

  // 6. Check that no real sleep in worker tests
  try {
    const allTests = await $`cat ${join(workspace, "src/__tests__/worker.test.ts")}`.text();
    check("AC-no-real-sleep", !allTests.includes("setTimeout(") || allTests.includes("FakeClock"));
  } catch { check("AC-no-real-sleep", false); }

  const summary = { pass, fail, total: pass + fail };
  const result: EvalResult = { task: "T02-retry", arm: "hidden-evaluator", results, summary };
  console.log(JSON.stringify(result, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}
await main();
