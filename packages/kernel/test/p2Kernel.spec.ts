// @praxis/kernel — P2 Pipeline Tests

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runP2Kernel } from '../src/runP2Kernel';

const REPO_ROOT = resolve(import.meta.dir, '../../..');

function loadYaml(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf-8');
}

describe('runP2Kernel', () => {
  test('runs SchemaGate then LockGate on valid plan with create_if_missing', () => {
    const result = runP2Kernel({
      planYaml: loadYaml('examples/planspec/runtime-code.plan.yaml'),
      repoRoot: REPO_ROOT,
      lockMode: 'create_if_missing',
    });

    // Should pass both gates
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('PASS');
    expect(result.gateVerdicts).toHaveLength(2);

    // Ordered verdicts
    expect(result.gateVerdicts[0].gateName).toBe('SchemaGate');
    expect(result.gateVerdicts[0].verdict).toBe('PASS');
    expect(result.gateVerdicts[1].gateName).toBe('LockGate');
    expect(result.gateVerdicts[1].verdict).toBe('PASS');

    // attemptId is stable across gates
    expect(result.gateVerdicts[0].attemptId).toBe(result.gateVerdicts[1].attemptId);

    // Hashes and plan present
    expect(result.hashes).toBeDefined();
    expect(result.plan).toBeDefined();
  });

  test('stops after SchemaGate failure — LockGate not invoked', () => {
    const result = runP2Kernel({
      planYaml: '{{{ bad yaml :::',
      repoRoot: REPO_ROOT,
    });

    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('FAIL');
    expect(result.gateVerdicts).toHaveLength(1);
    expect(result.gateVerdicts[0].gateName).toBe('SchemaGate');
    expect(result.gateVerdicts[0].verdict).toBe('FAIL');
  });

  test('only returns SchemaGate + LockGate (no other gates)', () => {
    const result = runP2Kernel({
      planYaml: loadYaml('examples/planspec/documentation.plan.yaml'),
      repoRoot: REPO_ROOT,
      lockMode: 'create_if_missing',
    });

    const gateNames = result.gateVerdicts.map(gv => gv.gateName);
    // Must not include EvidenceGate, WiringGate, ExecGate, FinalGate
    expect(gateNames).not.toContain('EvidenceGate');
    expect(gateNames).not.toContain('WiringGate');
    expect(gateNames).not.toContain('ExecGate');
    expect(gateNames).not.toContain('FinalGate');
  });

  test('gateVerdicts are ordered: SchemaGate before LockGate', () => {
    const result = runP2Kernel({
      planYaml: loadYaml('examples/planspec/test-only.plan.yaml'),
      repoRoot: REPO_ROOT,
      lockMode: 'create_if_missing',
    });

    const names = result.gateVerdicts.map(gv => gv.gateName);
    expect(names).toEqual(['SchemaGate', 'LockGate']);
  });
});
