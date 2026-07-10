/**
 * T05 Hidden Evaluator — Metrics and Dead-Job Replay CLI.
 *
 * Usage: bun run T05-eval.ts <workspace-path>
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
  if (!workspace) { console.error("Usage: T05-eval.ts <workspace-path>"); process.exit(1); }

  const results: Record<string, boolean> = {};
  let pass = 0, fail = 0;
  function check(name: string, ok: boolean) { results[name] = ok; if (ok) pass++; else fail++; }

  // 1. Files exist
  check("AC-metrics-test-file", existsSync(join(workspace, "src/__tests__/metrics-cli.test.ts")));
  check("AC-cli-file", existsSync(join(workspace, "src/cli/replay-queue.ts")));

  // 2. Full test suite
  try {
    const testOutput = await $`cd ${workspace} && bun test 2>&1`.text();
    check("AC-full-suite", testOutput.includes("0 fail"));
  } catch { check("AC-full-suite", false); }

  // 3. Typecheck
  try {
    const tcOutput = await $`cd ${workspace} && bun run typecheck 2>&1`.text();
    check("AC-typecheck", !tcOutput.includes("error TS") && !tcOutput.includes("errors"));
  } catch { check("AC-typecheck", false); }

  // 4. Metrics endpoint
  try {
    const serverProc = Bun.spawn(["bun", "run", "src/index.ts"], { cwd: workspace });
    await new Promise(r => setTimeout(r, 2000));

    try {
      // Check metrics endpoint
      const metricsResp = await fetch("http://localhost:3000/metrics");
      check("AC-http-metrics-ok", metricsResp.status === 200);
      const metrics = await metricsResp.json();
      check("AC-metrics-has-queued", typeof metrics.queued === "number");
      check("AC-metrics-has-total", typeof metrics.total === "number");

      // POST to metrics should fail (read-only)
      const postMetricsResp = await fetch("http://localhost:3000/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      check("AC-metrics-readonly", postMetricsResp.status >= 400);

      // Create some jobs
      for (let i = 0; i < 3; i++) {
        await fetch("http://localhost:3000/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `eval-t05-${i}` },
          body: JSON.stringify({ type: "metrics-test", payload: { i } })
        });
      }

      // Metrics should now show 3 queued
      const metrics2Resp = await fetch("http://localhost:3000/metrics");
      const metrics2 = await metrics2Resp.json() as any;
      check("AC-metrics-updates", metrics2.queued >= 3);

    } finally {
      serverProc.kill();
    }
  } catch (e: any) {
    check("AC-http-metrics-ok", false);
    check("AC-metrics-has-queued", false);
    check("AC-metrics-has-total", false);
    check("AC-metrics-readonly", false);
    check("AC-metrics-updates", false);
  }

  // 5. CLI structure
  try {
    const cliContent = await $`cat ${join(workspace, "src/cli/replay-queue.ts")}`.text();
    check("AC-cli-replay-command", cliContent.includes("replay") || cliContent.includes("replay-dead"));
    check("AC-cli-uses-repo", cliContent.includes("repository") || cliContent.includes("Repository") || cliContent.includes("service") || cliContent.includes("Service"));
  } catch {
    check("AC-cli-replay-command", false);
    check("AC-cli-uses-repo", false);
  }

  // 6. README check
  try {
    const readmeContent = await $`cat ${join(workspace, "README.md")}`.text();
    check("AC-readme-exists", readmeContent.length > 0);
  } catch { check("AC-readme-exists", false); }

  // 7. Package.json scripts
  try {
    const pkgContent = await $`cat ${join(workspace, "package.json")}`.text();
    check("AC-cli-in-package-json", pkgContent.includes("replay") || pkgContent.includes("queue"));
  } catch { check("AC-cli-in-package-json", false); }

  const summary = { pass, fail, total: pass + fail };
  const result: EvalResult = { task: "T05-metrics-cli", arm: "hidden-evaluator", results, summary };
  console.log(JSON.stringify(result, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}
await main();
