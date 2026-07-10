/**
 * check-export.ts — Verify a module exports expected symbols.
 *
 * Usage: bun run check-export.ts <workspace-path> <module-path> <export-name>...
 *
 * Uses Bun's module resolution to actually import the module and verify
 * that the named exports exist at runtime — stricter than grep.
 *
 * Exits 0 if all expected exports are found, 1 otherwise.
 */
import { join, isAbsolute } from "path";
import { existsSync } from "fs";

const WORKSPACE = process.argv[2] || ".";
const moduleArg = process.argv[3];
const expectedExports = process.argv.slice(4);

if (!moduleArg || expectedExports.length === 0) {
  console.error("Usage: check-export.ts <workspace-path> <module-path> <export-name>...");
  console.error("Example: check-export.ts /tmp/repo src/routes/jobs.ts createJobRouter");
  process.exit(1);
}

// Resolve the module path
const modulePath = isAbsolute(moduleArg) ? moduleArg : join(WORKSPACE, moduleArg);
const moduleDir = modulePath.endsWith(".ts") ? modulePath.slice(0, -3) : modulePath;
const moduleDirIndex = join(modulePath, "..", "index");

if (!existsSync(modulePath)) {
  console.error(`FAIL: Module not found at ${modulePath}`);
  process.exit(1);
}

let success = true;
const foundExports: string[] = [];
const missingExports: string[] = [];

try {
  // Import the module — Bun resolves relative to CWD
  const mod = await import(join(WORKSPACE, moduleArg.replace(/^\.\//, "").replace(/\.ts$/, "")));

  for (const name of expectedExports) {
    if (name in mod) {
      foundExports.push(name);
      console.log(`PASS: export '${name}' found (type: ${typeof mod[name as keyof typeof mod]})`);
    } else {
      missingExports.push(name);
      console.error(`FAIL: export '${name}' NOT found in module`);
      success = false;
    }
  }

  // List all available exports for debugging
  if (!success) {
    const available = Object.keys(mod).filter(k => k !== "default");
    console.log(`Available exports: ${available.join(", ") || "(none)"}`);
  }
} catch (e: any) {
  console.error(`FAIL: Could not import module — ${e.message}`);
  process.exit(1);
}

process.exit(success ? 0 : 1);
