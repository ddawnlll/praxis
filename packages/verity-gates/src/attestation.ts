// @praxis/verity-gates — Runner + Toolchain Attestation (#19)
//
// Binds evidence to runner image, OS, toolchain, dependency lock,
// and environment fingerprints. Secrets are redacted by a configurable
// denylist.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Attestation } from '@praxis/protocol';

export const SECRET_DENYLIST = [
  'TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'API_KEY', 'APIKEY',
  'AUTH', 'CREDENTIAL', 'PRIVATE_KEY', 'ACCESS_KEY',
];

export interface AttestationOptions {
  /** Runner image digest (e.g. 'sha256:abc...'). */
  runnerDigest?: string;
  /** Path to dependency lock file. */
  lockFilePath?: string;
  /** Path to project root for toolchain detection. */
  projectRoot?: string;
  /** Extra environment variables to capture (denylist filtered). */
  extraEnv?: string[];
}

export function captureAttestation(opts: AttestationOptions = {}): Attestation {
  const runnerDigest = opts.runnerDigest ?? 'unknown:0000000000000000000000000000000000000000000000000000000000000000';
  const toolchain = detectToolchain(opts.projectRoot);
  const dependencyLocks: string[] = [];
  if (opts.lockFilePath) {
    try {
      const h = createHash('sha256');
      h.update(readFileSync(opts.lockFilePath));
      dependencyLocks.push(`${opts.lockFilePath}:${h.digest('hex')}`);
    } catch { /* lock file not available */ }
  }
  const envFingerprint = captureEnvFingerprint(opts.extraEnv);
  return { runnerDigest, toolchain, dependencyLocks, environmentFingerprint: envFingerprint };
}

function detectToolchain(projectRoot?: string): Attestation['toolchain'] {
  const pkgPath = projectRoot ? resolve(projectRoot, 'package.json') : '';
  let language = 'TypeScript';
  let compiler = 'tsc';
  let version = 'unknown';
  if (pkgPath) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const tscVer = allDeps['typescript'];
      if (tscVer) version = tscVer.replace(/[\^~]/g, '');
    } catch { /* fallback */ }
  }
  return { language, compiler, version };
}

function captureEnvFingerprint(extraEnv: string[] = []): string {
  const h = createHash('sha256');
  h.update('praxis-attestation/v1\n');
  const vars = [...extraEnv, 'PATH', 'NODE_ENV', 'HOME', 'SHELL', 'USER'];
  for (const v of vars.sort()) {
    const val = process.env[v] || '';
    if (SECRET_DENYLIST.some((s) => v.includes(s))) {
      h.update(`${v}=<REDACTED>\n`);
    } else {
      h.update(`${v}=${val}\n`);
    }
  }
  h.update(`PLATFORM=${process.platform}\n`);
  h.update(`ARCH=${process.arch}\n`);
  return h.digest('hex');
}

export function captureAttestationFromEnv(extraEnvVars?: string[]): Attestation {
  return captureAttestation({ projectRoot: process.cwd(), extraEnv: extraEnvVars });
}
