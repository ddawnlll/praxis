/**
 * T01 Hidden Evaluator — Independent verification of job creation with idempotency.
 *
 * Usage: bun run T01-eval.ts <workspace-path>
 * Returns: JSON with pass/fail per criterion
 */

import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface EvalResult {
  task: string;
  arm: string;
  results: Record<string, boolean>;
  summary: { pass: number; fail: number; total: number };
}

async function main() {
  const workspace = process.argv[2];
  if (!workspace) {
    console.error("Usage: T01-eval.ts <workspace-path>");
    process.exit(1);
  }

  const results: Record<string, boolean> = {};
  let pass = 0;
  let fail = 0;

  function check(name: string, ok: boolean) {
    results[name] = ok;
    if (ok) pass++; else fail++;
  }

  // 1. Route file exists
  check("AC-route-file-exists", existsSync(join(workspace, "src/routes/jobs.ts")));

  // 2. Route is wired in server.ts (flexible quote matching)
  try {
    const serverContent = await $`cat ${join(workspace, "src/server.ts")}`.text();
    const wired = serverContent.includes("app.route('/jobs'") || serverContent.includes('app.route("/jobs"') || serverContent.includes(".route('/jobs'") || serverContent.includes('.route("/jobs"');
    check("AC-route-wired-server", wired);
  } catch {
    check("AC-route-wired-server", false);
  }

  // 3. Route is wired in routes/index.ts
  try {
    const routesContent = await $`cat ${join(workspace, "src/routes/index.ts")}`.text();
    check("AC-route-wired-index", routesContent.includes("jobs") || routesContent.includes("/jobs"));
  } catch {
    check("AC-route-wired-index", false);
  }

  // 4. Full test suite passes
  try {
    const testOutput = await $`cd ${workspace} && bun test 2>&1`.text();
    // "0 fail" with " pass" confirms success; reject explicit failure lines
    const passCount = (testOutput.match(/\d+ pass/g) || []).reduce((s, m) => s + parseInt(m), 0);
    const failLine = testOutput.match(/(\d+) fail/);
    const failCount = failLine ? parseInt(failLine[1]) : -1;
    check("AC-full-suite", passCount > 0 && failCount === 0);
  } catch (e: any) {
    check("AC-full-suite", false);
  }

  // 5. Typecheck passes
  try {
    const tcOutput = await $`cd ${workspace} && bun run typecheck 2>&1`.text();
    check("AC-typecheck", !tcOutput.includes("error TS") && !tcOutput.includes("errors"));
  } catch {
    check("AC-typecheck", false);
  }

  // 6. POST /jobs returns 201 for valid payload
  try {
    // Start server in background, test, kill
    const serverProc = Bun.spawn(["bun", "run", "src/index.ts"], { cwd: workspace });
    await new Promise(r => setTimeout(r, 2000));

    try {
      const createResponse = await fetch("http://localhost:3000/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "eval-t01-001" },
        body: JSON.stringify({ type: "eval-test", payload: { ok: true } })
      });
      check("AC-http-201", createResponse.status === 201);
      const job1 = await createResponse.json();
      check("AC-http-has-id", typeof job1.id === "string" && job1.id.length > 0);

      // 7. Idempotency: same key returns same job
      const dupResponse = await fetch("http://localhost:3000/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "eval-t01-001" },
        body: JSON.stringify({ type: "eval-test-dup", payload: {} })
      });
      check("AC-idempotency-sequential", dupResponse.status === 201);
      const job2 = await dupResponse.json();
      check("AC-idempotency-same-id", job1.id === job2.id);

      // 8. Missing Idempotency-Key returns 400
      const noKeyResponse = await fetch("http://localhost:3000/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test" })
      });
      check("AC-missing-key-400", noKeyResponse.status === 400);

      // 9. Invalid payload returns 400
      const badPayloadResponse = await fetch("http://localhost:3000/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "eval-t01-bad" },
        body: JSON.stringify({ wrong: true })
      });
      check("AC-invalid-payload-400", badPayloadResponse.status === 400);

      // 10. Concurrent idempotency: send two identical requests simultaneously
      const keyConcurrent = "eval-t01-concurrent";
      const promises = Promise.all([
        fetch("http://localhost:3000/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": keyConcurrent },
          body: JSON.stringify({ type: "concurrent-test", payload: {} })
        }),
        fetch("http://localhost:3000/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": keyConcurrent },
          body: JSON.stringify({ type: "concurrent-test", payload: {} })
        })
      ]);
      const [r1, r2] = await promises;
      const j1 = await r1.json();
      const j2 = await r2.json();
      check("AC-concurrent-idempotent", r1.status === 201 && r2.status === 201 && j1.id === j2.id);

    } finally {
      serverProc.kill();
    }
  } catch (e: any) {
    check("AC-http-201", false);
    check("AC-http-has-id", false);
    check("AC-idempotency-sequential", false);
    check("AC-idempotency-same-id", false);
    check("AC-missing-key-400", false);
    check("AC-invalid-payload-400", false);
    check("AC-concurrent-idempotent", false);
  }

  const summary = { pass, fail, total: pass + fail };
  const result: EvalResult = {
    task: "T01-idempotency",
    arm: "hidden-evaluator",
    results,
    summary
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

await main();
