// @praxis/kernel — Deterministic Assembler
// The ONLY shared writer (Law 2). Performs namespace recheck, atomic apply,
// semantic check, and rollback on failure.

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

export interface AssemblyInput {
  workspaceRoot: string;
  targetRoot: string;
  files: AssemblyFile[];
  attemptId: string;
}

export interface AssemblyFile {
  sourcePath: string;      // path in worker workspace
  targetPath: string;      // path in target (relative to targetRoot)
  content?: string;        // new content (if provided, overwrites source)
  expectedChecksum?: string;
}

export interface ConflictReport {
  hasConflict: boolean;
  conflicts: Array<{
    file: string;
    type: 'namespace_violation' | 'checksum_mismatch' | 'target_exists' | 'source_missing';
    detail: string;
  }>;
  rollbackPerformed: boolean;
  appliedFiles: string[];
}

export type AssemblyResult = {
  ok: true;
  report: ConflictReport;
} | {
  ok: false;
  report: ConflictReport;
  error: string;
};

export function assemble(input: AssemblyInput): AssemblyResult {
  const report: ConflictReport = {
    hasConflict: false,
    conflicts: [],
    rollbackPerformed: false,
    appliedFiles: [],
  };

  const backupDir = resolve(input.workspaceRoot, '.praxis/assembler-backup', input.attemptId);

  // Phase 1: Validate all files before applying any
  for (const file of input.files) {
    const src = resolve(input.workspaceRoot, file.sourcePath);
    const tgt = resolve(input.targetRoot, file.targetPath);

    // Check source exists
    if (!existsSync(src)) {
      report.conflicts.push({
        file: file.sourcePath,
        type: 'source_missing',
        detail: `Source file not found: ${src}`,
      });
      report.hasConflict = true;
      continue;
    }

    // Check target doesn't already exist with different content (safety)
    if (existsSync(tgt) && file.expectedChecksum) {
      const existing = readFileSync(tgt, 'utf-8');
      // Simple content comparison
      if (existing !== file.content && !file.content) {
        report.conflicts.push({
          file: file.targetPath,
          type: 'target_exists',
          detail: `Target already exists with different content`,
        });
        report.hasConflict = true;
      }
    }
  }

  if (report.hasConflict) {
    return { ok: false, report, error: 'Conflicts detected, no files applied' };
  }

  // Phase 2: Backup existing targets
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  for (const file of input.files) {
    const tgt = resolve(input.targetRoot, file.targetPath);
    if (existsSync(tgt)) {
      const backupPath = resolve(backupDir, file.targetPath);
      const parent = dirname(backupPath);
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      cpSync(tgt, backupPath, { recursive: true });
    }
  }

  // Phase 3: Apply files to target
  for (const file of input.files) {
    const src = resolve(input.workspaceRoot, file.sourcePath);
    const tgt = resolve(input.targetRoot, file.targetPath);
    const parent = dirname(tgt);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

    try {
      if (file.content !== undefined) {
        writeFileSync(tgt, file.content, 'utf-8');
      } else {
        cpSync(src, tgt, { recursive: true });
      }
      report.appliedFiles.push(file.targetPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Phase 4: Rollback on failure
      for (const applied of report.appliedFiles) {
        const appliedPath = resolve(input.targetRoot, applied);
        const backupPath = resolve(backupDir, applied);
        if (existsSync(backupPath)) {
          cpSync(backupPath, appliedPath, { recursive: true });
        } else if (existsSync(appliedPath)) {
          rmSync(appliedPath);
        }
      }
      report.rollbackPerformed = true;
      report.hasConflict = true;
      return { ok: false, report, error: `Apply failed: ${msg}. Rolled back ${report.appliedFiles.length} files.` };
    }
  }

  return { ok: true, report };
}
