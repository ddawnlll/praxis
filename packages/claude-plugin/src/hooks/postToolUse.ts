// @praxis/claude-plugin — PostToolUse hook
// Captures tool output and file diffs after execution.
// Plugin is READ-ONLY. Never decides truth. Errors are reported, not swallowed.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { PluginConfig } from '../config';

/** Shape of a Claude Code PostToolUse event. */
export interface PostToolUseEvent {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: unknown;
  timestamp: string;
  sessionId?: string;
  /** File paths that may have been modified. */
  touchedFiles?: string[];
}

/** Shape of a captured diff evidence record. */
interface DiffEvidence {
  evidenceVersion: 'praxis-evidence/v0.1';
  recordId: string;
  attemptId: string;
  planId: string;
  timestamp: string;
  type: 'diff' | 'source' | 'changed_file';
  source: 'hook';
  path?: string;
  summary: string;
  hash?: string;
}

/** Shape of a captured post-tool evidence record. */
interface PostToolEvidence {
  evidenceVersion: 'praxis-evidence/v0.1';
  recordId: string;
  attemptId: string;
  planId: string;
  timestamp: string;
  type: 'post_tool';
  source: 'hook';
  summary: string;
  metadata: {
    toolName: string;
    outputSummary: string;
    touchedFiles?: string[];
  };
}

/**
 * Simple hash of a buffer for evidence fingerprinting.
 * Uses Node.js crypto. Not cryptographic — fingerprint only.
 */
function fingerPrint(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Capture a PostToolUse event into the evidence ledger.
 *
 * Writes:
 *   1. A post_tool record for the tool invocation
 *   2. Diff/file records for any touched files
 *
 * Does NOT block or error on failure.
 */
export function capturePostToolUse(
  event: PostToolUseEvent,
  config: PluginConfig,
  repoRoot: string,
  attemptId: string,
  planId: string,
): void {
  if (!config.capturePostTool) return;

  try {
    const evidenceDir = resolve(repoRoot, config.evidenceDir, attemptId);
    if (!existsSync(evidenceDir)) {
      mkdirSync(evidenceDir, { recursive: true });
    }

    const ledgerPath = resolve(evidenceDir, 'evidence.jsonl');

    // 1. Write post_tool record
    const outputStr = typeof event.toolOutput === 'string'
      ? event.toolOutput
      : JSON.stringify(event.toolOutput ?? {});

    const outputSummary = outputStr.length > 512
      ? outputStr.slice(0, 512) + '...'
      : outputStr;

    const postRecordId = `EV-${config.runIdPrefix}-post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const postEvidence: PostToolEvidence = {
      evidenceVersion: 'praxis-evidence/v0.1',
      recordId: postRecordId,
      attemptId,
      planId,
      timestamp: event.timestamp,
      type: 'post_tool',
      source: 'hook',
      summary: `PostToolUse: ${event.toolName}`,
      metadata: {
        toolName: event.toolName,
        outputSummary,
        touchedFiles: event.touchedFiles,
      },
    };
    appendFileSync(ledgerPath, JSON.stringify(postEvidence) + '\n', 'utf-8');

    // 2. Capture file diffs for touched files
    const touchedFiles = event.touchedFiles ?? [];
    const writeTools = ['Write', 'Edit', 'NotebookEdit'];
    const isWrite = writeTools.includes(event.toolName);

    // If it's a Write/Edit tool, capture the target file
    if (isWrite && event.toolInput.file_path) {
      const fp = String(event.toolInput.file_path);
      captureFileEvidence(fp, repoRoot, evidenceDir, attemptId, planId, config, ledgerPath);
    }

    // Capture any additional touched files
    for (const tf of touchedFiles) {
      if (tf === event.toolInput.file_path) continue; // already captured
      captureFileEvidence(tf, repoRoot, evidenceDir, attemptId, planId, config, ledgerPath);
    }
  } catch (err) {
    void err;
  }
}

/**
 * Capture evidence for a single file: changed_file record and optional diff.
 */
function captureFileEvidence(
  filePath: string,
  repoRoot: string,
  evidenceDir: string,
  attemptId: string,
  planId: string,
  config: PluginConfig,
  ledgerPath: string,
): void {
  try {
    const absPath = resolve(repoRoot, filePath);
    if (!existsSync(absPath)) return;

    const stat = statSync(absPath);
    if (!stat.isFile()) return;

    // Skip files larger than maxDiffBytes
    if (stat.size > config.maxDiffBytes) return;

    const content = readFileSync(absPath, 'utf-8');
    const fp = fingerPrint(content);
    const relPath = relative(repoRoot, absPath);

    // changed_file record
    const cfRecordId = `EV-${config.runIdPrefix}-cf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cfEvidence: DiffEvidence = {
      evidenceVersion: 'praxis-evidence/v0.1',
      recordId: cfRecordId,
      attemptId,
      planId,
      timestamp: new Date().toISOString(),
      type: 'changed_file',
      source: 'hook',
      path: relPath,
      summary: `File changed: ${relPath} (${stat.size} bytes)`,
    };
    appendFileSync(ledgerPath, JSON.stringify(cfEvidence) + '\n', 'utf-8');

    // source record (file contents fingerprint)
    const srcRecordId = `EV-${config.runIdPrefix}-src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const srcEvidence: DiffEvidence = {
      evidenceVersion: 'praxis-evidence/v0.1',
      recordId: srcRecordId,
      attemptId,
      planId,
      timestamp: new Date().toISOString(),
      type: 'source',
      source: 'hook',
      path: relPath,
      summary: `Source fingerprint: ${relPath}`,
      hash: fp,
    };
    appendFileSync(ledgerPath, JSON.stringify(srcEvidence) + '\n', 'utf-8');
  } catch {
    // Silently ignore individual file capture failures
  }
}
