// @praxis/verity-gates — ScopeGate + ArchitectureGate tests (#22)
//
// Tests for path containment, symlink escape, glob matching,
// unit existence, orphan detection, and export verification.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ScopeGate, ArchitectureGate } from '../src/scopeArchitecture';
import type { GateContext, GateResult } from '../src/gate';

const FIXTURE_DIR = join(import.meta.dir, '..', '__fixtures__', 'scope');
const ROOT_DIR = join(FIXTURE_DIR, 'project');

function makeCtx(files?: string[], requiredExports?: Record<string, string[]>): GateContext {
  return {
    policy: {} as any,
    manifest: {} as any,
    metadata: { filesTouched: files, requiredExports },
  };
}

describe('ScopeGate', () => {
  beforeEach(() => {
    mkdirSync(join(ROOT_DIR, 'src', 'components'), { recursive: true });
    mkdirSync(join(ROOT_DIR, 'lib'), { recursive: true });
    writeFileSync(join(ROOT_DIR, 'src', 'index.ts'), 'export {}');
    writeFileSync(join(ROOT_DIR, 'src', 'components', 'Button.tsx'), 'export {}');
    writeFileSync(join(ROOT_DIR, 'lib', 'utils.ts'), 'export {}');
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  test('PASS when no files touched', () => {
    const gate = new ScopeGate({ rootDir: ROOT_DIR });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('PASS');
    expect(result.reasonCode).toBe('SCOPE_OK');
  });

  test('PASS for files within allowed globs', () => {
    const gate = new ScopeGate({
      rootDir: ROOT_DIR,
      allowedGlobs: ['src/**'],
    });
    const result = gate.evaluate(makeCtx([join(ROOT_DIR, 'src', 'index.ts')]));
    expect(result.verdict).toBe('PASS');
  });

  test('FAIL for files outside allowed globs', () => {
    const gate = new ScopeGate({
      rootDir: ROOT_DIR,
      allowedGlobs: ['src/**'],
    });
    const result = gate.evaluate(makeCtx([join(ROOT_DIR, 'lib', 'utils.ts')]));
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/SCOPE_DISALLOWED/);
  });

  test('FAIL for forbidden globs', () => {
    const gate = new ScopeGate({
      rootDir: ROOT_DIR,
      forbiddenGlobs: ['**/*.env', '**/secrets/**'],
    });
    const envFile = join(ROOT_DIR, 'src', '.env');
    writeFileSync(envFile, 'SECRET=1');
    const result = gate.evaluate(makeCtx([envFile]));
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/SCOPE_FORBIDDEN/);
  });

  test('FAIL when root dir is unresolvable', () => {
    const gate = new ScopeGate({ rootDir: '/nonexistent/root' });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toBe('SCOPE_ROOT_UNRESOLVABLE');
  });

  test('FAIL for symlink escape', () => {
    const outside = join(FIXTURE_DIR, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'sneaky.txt'), 'pwned');
    // Create symlink inside project pointing outside
    const linkPath = join(ROOT_DIR, 'src', 'escape');
    symlinkSync(outside, linkPath);

    const gate = new ScopeGate({ rootDir: ROOT_DIR });
    const result = gate.evaluate(makeCtx([join(ROOT_DIR, 'src', 'escape', 'sneaky.txt')]));
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/SCOPE_ESCAPE/);
  });

  test('FAIL for forbidden directory pattern', () => {
    const gate = new ScopeGate({
      rootDir: ROOT_DIR,
      forbiddenGlobs: ['src/components/**'],
    });
    const result = gate.evaluate(makeCtx([join(ROOT_DIR, 'src', 'components', 'Button.tsx')]));
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/SCOPE_FORBIDDEN/);
  });

  test('PASS with both allowed and forbidden globs when file matches allowed but not forbidden', () => {
    const gate = new ScopeGate({
      rootDir: ROOT_DIR,
      allowedGlobs: ['src/**'],
      forbiddenGlobs: ['src/**/*.env'],
    });
    const result = gate.evaluate(makeCtx([join(ROOT_DIR, 'src', 'index.ts')]));
    expect(result.verdict).toBe('PASS');
  });
});

describe('ArchitectureGate', () => {
  beforeEach(() => {
    mkdirSync(join(ROOT_DIR, 'src'), { recursive: true });
    writeFileSync(join(ROOT_DIR, 'src', 'main.ts'), 'export const main = () => {}');
    writeFileSync(join(ROOT_DIR, 'src', 'utils.ts'), 'export const util = () => {}');
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  test('PASS when all declared units exist', () => {
    const gate = new ArchitectureGate({
      declaredUnits: [
        { name: 'main', path: join(ROOT_DIR, 'src', 'main.ts'), entrypoint: true },
        { name: 'utils', path: join(ROOT_DIR, 'src', 'utils.ts') },
      ],
    });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('PASS');
    expect(result.reasonCode).toBe('ARCH_OK');
  });

  test('FAIL when declared unit does not exist on filesystem', () => {
    const gate = new ArchitectureGate({
      declaredUnits: [
        { name: 'main', path: join(ROOT_DIR, 'src', 'main.ts') },
        { name: 'missing', path: join(ROOT_DIR, 'src', 'missing.ts') },
      ],
    });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/ARCH_UNIT_NOT_FOUND:missing/);
  });

  test('FAIL when files changed are not in declared units (orphan)', () => {
    const gate = new ArchitectureGate({
      declaredUnits: [
        { name: 'main', path: join(ROOT_DIR, 'src', 'main.ts') },
      ],
    });
    const result = gate.evaluate(makeCtx([join(ROOT_DIR, 'src', 'utils.ts')]));
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/ARCH_ORPHAN/);
  });

  test('FAIL when required export is missing from unit', () => {
    writeFileSync(join(ROOT_DIR, 'src', 'main.ts'), 'export const foo = 1;');
    const gate = new ArchitectureGate({
      declaredUnits: [
        { name: 'main', path: join(ROOT_DIR, 'src', 'main.ts'), exports: ['foo'] },
      ],
    });
    const result = gate.evaluate(makeCtx(undefined, { main: ['foo', 'bar'] }));
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/ARCH_EXPORT_MISSING:main.bar/);
  });

  test('PASS when all required exports are present', () => {
    writeFileSync(join(ROOT_DIR, 'src', 'main.ts'), 'export const foo = 1; export const bar = 2;');
    const gate = new ArchitectureGate({
      declaredUnits: [
        { name: 'main', path: join(ROOT_DIR, 'src', 'main.ts'), exports: ['foo', 'bar'] },
      ],
    });
    const result = gate.evaluate(makeCtx(undefined, { main: ['foo', 'bar'] }));
    expect(result.verdict).toBe('PASS');
  });

  test('FAIL when required export references non-existent unit', () => {
    const gate = new ArchitectureGate({
      declaredUnits: [
        { name: 'main', path: join(ROOT_DIR, 'src', 'main.ts'), exports: ['foo'] },
      ],
    });
    const result = gate.evaluate(makeCtx(undefined, { nonexistent: ['foo'] }));
    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toMatch(/ARCH_UNIT_FOR_EXPORT:nonexistent/);
  });

  test('PASS for empty declared units with no files touched', () => {
    const gate = new ArchitectureGate({ declaredUnits: [] });
    const result = gate.evaluate(makeCtx());
    expect(result.verdict).toBe('PASS');
  });
});
