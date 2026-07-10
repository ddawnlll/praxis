/**
 * T04 Hidden Evaluator — Cancellation and Concurrency.
 *
 * Usage: bun run T04-eval.ts <workspace-path>
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
  if (!workspace) { console.error("Usage: T04-eval.ts <workspace-path>"); process.exit(1); }

  const results: Record<string, boolean> = {};
  let pass = 0, fail = 0;
  function check(name: string, ok: boolean) { results[name] = ok; if (ok) pass++; else fail++; }

  // 1. Cancellation test file exists
  check("AC-cancel-test-file", existsSync(join(workspace, "src/__tests__/cancellation.test.ts")));

  // 2. Full test suite
  try {
    const testOutput = await $`cd ${workspace} && bun test 2>&1`.text();
    const passCount = (testOutput.match(/\d+ pass/g) || []).reduce((s, m) => s + parseInt(m), 0);
    const failLine = testOutput.match(/(\d+) fail/);
    const failCount = failLine ? parseInt(failLine[1]) : -1;
    check("AC-full-suite", passCount > 0 && failCount === 0);
  } catch { check("AC-full-suite", false); }

  // 3. Typecheck
  try {
    const tcOutput = await $`cd ${workspace} && bun run typecheck 2>&1`.text();
    check("AC-typecheck", !tcOutput.includes("error TS") && !tcOutput.includes("errors"));
  } catch { check("AC-typecheck", false); }

  // 4. Runtime test: cancel endpoint
  try {
    const serverProc = Bun.spawn(["bun", "run", "src/index.ts"], { cwd: workspace });
    await new Promise(r => setTimeout(r, 2000));

    try {
      // Create a job
      const createResp = await fetch("http://localhost:3000/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "eval-t04-cancel" },
        body: JSON.stringify({ type: "cancel-test", payload: {} })
      });
      const job = await createResp.json();
      check("AC-http-create-ok", createResp.status === 201);

      // Cancel the job
      const cancelResp = await fetch(`http://localhost:3000/jobs/${job.id}/cancel`, { method: "POST" });
      check("AC-http-cancel-ok", cancelResp.status === 200 || cancelResp.status === 204);

      // Cancel again should fail
      const cancelAgainResp = await fetch(`http://localhost:3000/jobs/${job.id}/cancel`, { method: "POST" });
      check("AC-http-cancel-idempotent", cancelAgainResp.status >= 400 && cancelAgainResp.status < 500);

      // Cancel non-existent job
      const cancelMissingResp = await fetch(`http://localhost:3000/jobs/nonexistent/cancel`, { method: "POST" });
      check("AC-http-cancel-missing", cancelMissingResp.status === 404);

    } finally {
      serverProc.kill();
    }
  } catch (e: any) {
    check("AC-http-create-ok", false);
    check("AC-http-cancel-ok", false);
    check("AC-http-cancel-idempotent", false);
    check("AC-http-cancel-missing", false);
  }

  // 5. Cancellation in server.ts wiring
  try {
    const serverContent = await $`cat ${join(workspace, "src/server.ts")}`.text();
    check("AC-cancel-route-wired", serverContent.includes("cancel") || serverContent.includes(":id"));
  } catch { check("AC-cancel-route-wired", false); }

  const summary = { pass, fail, total: pass + fail };
  const result: EvalResult = { task: "T04-cancellation", arm: "hidden-evaluator", results, summary };
  console.log(JSON.stringify(result, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}
await main();
