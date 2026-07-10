/**
 * T03 Hidden Evaluator — Restart Persistence.
 *
 * Usage: bun run T03-eval.ts <workspace-path>
 */

import { $ } from "bun";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

interface EvalResult {
  task: string;
  arm: string;
  results: Record<string, boolean>;
  summary: { pass: number; fail: number; total: number };
}

async function main() {
  const workspace = process.argv[2];
  if (!workspace) { console.error("Usage: T03-eval.ts <workspace-path>"); process.exit(1); }

  const results: Record<string, boolean> = {};
  let pass = 0, fail = 0;
  function check(name: string, ok: boolean) { results[name] = ok; if (ok) pass++; else fail++; }

  // 1. Repository file exists
  check("AC-repo-file", existsSync(join(workspace, "src/queue/repository.ts")));

  // 2. Persistence-related code
  try {
    const repoContent = await $`cat ${join(workspace, "src/queue/repository.ts")}`.text();
    check("AC-persistence-code", repoContent.includes("fs") || repoContent.includes("writeFile") || repoContent.includes("readFile") || repoContent.includes("Persistent"));
    check("AC-atomic-write-code", repoContent.includes("temp") || repoContent.includes("rename") || repoContent.includes(".tmp") || repoContent.includes("atomic"));
    check("AC-state-path-env", repoContent.includes("STATE_PATH") || repoContent.includes("statePath") || repoContent.includes("state.json"));
  } catch {
    check("AC-persistence-code", false); check("AC-atomic-write-code", false); check("AC-state-path-env", false);
  }

  // 3. Persistence test file
  try {
    const testContent = await $`cat ${join(workspace, "src/__tests__/persistence.test.ts")}`.text();
    check("AC-persistence-tests", true);
    check("AC-persist-test", testContent.includes("persist") || testContent.includes("Persist") || testContent.includes("save") || testContent.includes("load"));
    check("AC-crash-recovery-test", testContent.includes("crash") || testContent.includes("restart") || testContent.includes("running") || testContent.includes("queued"));
  } catch {
    check("AC-persistence-tests", false); check("AC-persist-test", false); check("AC-crash-recovery-test", false);
  }

  // 4. Entrypoint uses persistent repository
  try {
    const entryContent = await $`cat ${join(workspace, "src/index.ts")}`.text();
    check("AC-entrypoint-wired", entryContent.includes("Persistent") || entryContent.includes("persist") || entryContent.includes("state") || entryContent.includes("STATE_PATH"));
  } catch { check("AC-entrypoint-wired", false); }

  // 5. Full test suite
  try {
    const testOutput = await $`cd ${workspace} && bun test 2>&1`.text();
    check("AC-full-suite", testOutput.includes("0 fail"));
  } catch { check("AC-full-suite", false); }

  // 6. Typecheck
  try {
    const tcOutput = await $`cd ${workspace} && bun run typecheck 2>&1`.text();
    check("AC-typecheck", !tcOutput.includes("error TS") && !tcOutput.includes("errors"));
  } catch { check("AC-typecheck", false); }

  // 7. Runtime test: start server, create job, kill, restart, check job persists
  try {
    const stateFile = join(workspace, "pulsequeue-state.json");
    try { unlinkSync(stateFile); } catch {}

    // Start server
    const server1 = Bun.spawn(["bun", "run", "src/index.ts"], {
      cwd: workspace,
      env: { ...process.env, STATE_PATH: stateFile }
    });
    await new Promise(r => setTimeout(r, 2000));

    // Create a job
    const createResp = await fetch("http://localhost:3000/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "eval-t03-persist" },
      body: JSON.stringify({ type: "persistence-test", payload: { n: 1 } })
    });
    const job = await createResp.json();
    check("AC-http-persist-create", createResp.status === 201);

    server1.kill();
    await new Promise(r => setTimeout(r, 500));

    // Check state file exists
    check("AC-state-file-exists", existsSync(stateFile));

    // Restart server
    const server2 = Bun.spawn(["bun", "run", "src/index.ts"], {
      cwd: workspace,
      env: { ...process.env, STATE_PATH: stateFile }
    });
    await new Promise(r => setTimeout(r, 2000));

    // Check job still exists
    try {
      // Try to get job via idempotency
      const getResp = await fetch("http://localhost:3000/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "eval-t03-persist" },
        body: JSON.stringify({ type: "persistence-test-check", payload: {} })
      });
      const restored = await getResp.json();
      check("AC-restore-after-restart", getResp.status === 201 && restored.id === job.id);
    } catch {
      check("AC-restore-after-restart", false);
    }
    server2.kill();

  } catch (e: any) {
    check("AC-http-persist-create", false);
    check("AC-state-file-exists", false);
    check("AC-restore-after-restart", false);
  }

  const summary = { pass, fail, total: pass + fail };
  const result: EvalResult = { task: "T03-persistence", arm: "hidden-evaluator", results, summary };
  console.log(JSON.stringify(result, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}
await main();
