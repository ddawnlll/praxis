/**
 * probe-create.ts — Deterministic probe for POST /jobs with idempotency.
 *
 * Usage: bun run probe-create.ts <workspace-path>
 * Starts the server, creates a job, verifies 201 + same-key dedup, kills server.
 * Exits 0 on success, 1 on failure.
 */
import { $ } from "bun";
import { join } from "path";

const WORKSPACE = process.argv[2] || ".";
const PORT = 31890; // avoid collision with default 3000

async function waitForServer(url: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 400) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function main(): Promise<number> {
  // 1. Start server
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: WORKSPACE,
    env: { ...process.env, PORT: String(PORT) },
  });

  const ready = await waitForServer(`http://localhost:${PORT}/health`);
  if (!ready) {
    proc.kill();
    console.error("FAIL: Server did not start");
    return 1;
  }

  let failures = 0;

  try {
    // 2. Create job with valid payload
    const r1 = await fetch(`http://localhost:${PORT}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "probe-001" },
      body: JSON.stringify({ type: "probe-test", payload: { ok: true } }),
    });
    const body1 = await r1.json() as any;
    if (r1.status !== 201) { console.error(`FAIL: Expected 201, got ${r1.status}`); failures++; }
    else if (!body1.id) { console.error(`FAIL: No job ID returned`); failures++; }
    else console.log(`PASS: Created job ${body1.id} [201]`);

    // 3. Same key → same job (sequential idempotency)
    const r2 = await fetch(`http://localhost:${PORT}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "probe-001" },
      body: JSON.stringify({ type: "probe-dup", payload: { evil: true } }),
    });
    const body2 = await r2.json() as any;
    if (r2.status !== 201) { console.error(`FAIL: Expected 201 for dup, got ${r2.status}`); failures++; }
    else if (body2.id !== body1.id) { console.error(`FAIL: Same key returned different ID ${body2.id} vs ${body1.id}`); failures++; }
    else console.log(`PASS: Idempotency preserved [same ID ${body1.id}]`);

    // 4. Missing Idempotency-Key → 400
    const r3 = await fetch(`http://localhost:${PORT}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test" }),
    });
    if (r3.status !== 400) { console.error(`FAIL: Expected 400 for missing key, got ${r3.status}`); failures++; }
    else console.log("PASS: Missing key rejected [400]");

    // 5. Invalid payload → 400
    const r4 = await fetch(`http://localhost:${PORT}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "probe-002" },
      body: JSON.stringify({ wrong: true }),
    });
    if (r4.status !== 400) { console.error(`FAIL: Expected 400 for invalid payload, got ${r4.status}`); failures++; }
    else console.log("PASS: Invalid payload rejected [400]");

  } finally {
    proc.kill();
  }

  if (failures === 0) console.log("\nAll probes passed.");
  else console.error(`\n${failures} probe(s) failed.`);
  return failures > 0 ? 1 : 0;
}

const exitCode = await main();
process.exit(exitCode);
