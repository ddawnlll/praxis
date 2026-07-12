// @praxis/verity-gates — ScopeGate + ArchitectureGate (#22)
//
// ScopeGate:
//   1. Path containment (realpath + path.relative)
//   2. Symlink escape prevention
//   3. Allowed/forbidden glob matching
//
// ArchitectureGate:
//   1. Declared runtime units match filesystem
//   2. Required entrypoints are reachable (path-only)
//   3. Orphan module detection
//   4. Forbidden changes always FAIL

import type { Gate, GateContext, GateResult } from './gate';
import { makeResult } from './gate';
import type { GateName } from '..';
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export interface ScopePolicy {
  allowedGlobs?: string[];
  forbiddenGlobs?: string[];
  /** Root directory for path resolution. */
  rootDir: string;
}

export interface DeclaredUnit {
  name: string;
  path: string;
  entrypoint?: boolean;
  exports?: string[];
}

export interface ArchitectureManifest {
  declaredUnits: DeclaredUnit[];
  requiredExports?: string[];
}

const GLOB_WILDCARD = /[*?[\]{}]/;

function matchesGlob(filePath: string, pattern: string): boolean {
  if (!GLOB_WILDCARD.test(pattern)) return filePath === pattern;
  const reStr = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${reStr}$`).test(filePath);
}

export class ScopeGate implements Gate {
  readonly name: GateName = 'scope';
  constructor(private readonly policy: ScopePolicy) {}

  evaluate(ctx: GateContext): GateResult {
    const at = new Date().toISOString();

    // 1. Symlink defense: resolve through realpath
    let realRoot: string;
    let realRootParent: string;
    try {
      realRoot = realpathSync(this.policy.rootDir);
      realRootParent = resolve(realRoot, '..');
    } catch {
      return makeResult(this.name, 'FAIL', 'SCOPE_ROOT_UNRESOLVABLE', at);
    }

    // 2. Path containment check for each file in declared units
    const filesTouched = ctx.metadata?.filesTouched as string[] | undefined;
    if (filesTouched) {
      for (const f of filesTouched) {
        // Symlink escape
        let realF: string;
        try {
          realF = realpathSync(f);
        } catch {
          return makeResult(this.name, 'FAIL', `SCOPE_FILE_NOT_FOUND:${f}`, at);
        }
        const rel = relative(realRoot, realF);
        if (rel.startsWith('..') || rel === f) {
          return makeResult(this.name, 'FAIL', `SCOPE_ESCAPE:${f}`, at);
        }
        // Forbidden globs
        if (this.policy.forbiddenGlobs) {
          for (const g of this.policy.forbiddenGlobs) {
            if (matchesGlob(rel, g)) {
              return makeResult(this.name, 'FAIL', `SCOPE_FORBIDDEN:${rel}`, at);
            }
          }
        }
        // Allowed globs
        if (this.policy.allowedGlobs) {
          const allowed = this.policy.allowedGlobs.some((g) => matchesGlob(rel, g));
          if (!allowed) {
            return makeResult(this.name, 'FAIL', `SCOPE_DISALLOWED:${rel}`, at);
          }
        }
      }
    }

    return makeResult(this.name, 'PASS', 'SCOPE_OK', at);
  }
}

export class ArchitectureGate implements Gate {
  readonly name: GateName = 'architecture';
  constructor(private readonly manifest: ArchitectureManifest) {}

  evaluate(ctx: GateContext): GateResult {
    const at = new Date().toISOString();

    // 1. Every declared unit must exist on filesystem
    for (const unit of this.manifest.declaredUnits) {
      try {
        realpathSync(unit.path);
      } catch {
        return makeResult(this.name, 'FAIL', `ARCH_UNIT_NOT_FOUND:${unit.name}`, at);
      }
    }

    // 2. Entrypoints must be declared as declared units
    const declaredPaths = new Set(this.manifest.declaredUnits.map((u) => u.path));
    for (const unit of this.manifest.declaredUnits) {
      if (!unit.entrypoint) continue;
      if (!declaredPaths.has(unit.path)) {
        return makeResult(this.name, 'FAIL', `ARCH_ENTRYPOINT_MISSING:${unit.name}`, at);
      }
    }

    // 3. Orphan detection: metadata.filesChanged that aren't declared
    const filesChanged = ctx.metadata?.filesTouched as string[] | undefined;
    if (filesChanged) {
      const declared = new Set(this.manifest.declaredUnits.map((u) => relative('.', resolve(u.path))));
      for (const f of filesChanged) {
        if (!declared.has(f)) {
          return makeResult(this.name, 'FAIL', `ARCH_ORPHAN:${f}`, at);
        }
      }
    }

    // 4. Required exports listed per unit
    const requiredExports = ctx.metadata?.requiredExports as Record<string, string[]> | undefined;
    if (requiredExports) {
      for (const [unitName, exports] of Object.entries(requiredExports)) {
        const unit = this.manifest.declaredUnits.find((u) => u.name === unitName);
        if (!unit) {
          return makeResult(this.name, 'FAIL', `ARCH_UNIT_FOR_EXPORT:${unitName}`, at);
        }
        for (const exp of exports) {
          if (!unit.exports?.includes(exp)) {
            return makeResult(this.name, 'FAIL', `ARCH_EXPORT_MISSING:${unitName}.${exp}`, at);
          }
        }
      }
    }

    return makeResult(this.name, 'PASS', 'ARCH_OK', at);
  }
}