// @praxis/kernel — Criterion Evaluator
// Per-criterion evaluation logic for FinalGate v0.1.
// Evaluates each AcceptanceCriterion against all available evidence from prior gates.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Diagnostic } from '@praxis/contracts';
import type { AcceptanceCriterion, Verification } from '@praxis/contracts';
import { validatePlanSpec } from '@praxis/contracts';
import type { CriterionResult, CriterionVerdict } from './types';
import type { EvidenceRecordV01 } from '../evidence/types';
import type { CommandResult } from '../executor/types';
import type { WiringGateResult } from '../wiring/types';
import { FINAL_REASON_CODES } from '../diagnostics';

// ---------------------------------------------------------------------------
// Context passed to each criterion evaluation
// ---------------------------------------------------------------------------

export interface CriterionContext {
  criterion: AcceptanceCriterion;
  taskId: string;
  repoRoot: string;
  evidenceRecords: EvidenceRecordV01[];
  commandResults: CommandResult[];
  wiringResult?: WiringGateResult;
  planYaml?: string; // Original PlanSpec YAML for re-validation
}

// ---------------------------------------------------------------------------
// Evaluation entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate a single acceptance criterion against all available evidence.
 * Returns a CriterionResult with verdict, reason codes, and evidence refs.
 */
export function evaluateCriterion(ctx: CriterionContext): CriterionResult {
  const { criterion, taskId, repoRoot, evidenceRecords, commandResults, wiringResult } = ctx;
  const v = criterion.verification;
  const reasonCodes: string[] = [];
  const evidenceRefs: string[] = [];

  // --- Step 1: Advisory-only criteria cannot satisfy FinalGate PASS ---
  if (v.advisoryOnly === true) {
    reasonCodes.push(FINAL_REASON_CODES.ADVISORY_CRITERION);
    return buildResult(criterion.id, taskId, 'INFO', reasonCodes, evidenceRefs,
      `Criterion "${criterion.id}" is advisory-only (advisoryOnly=true). It cannot satisfy FinalGate PASS.`,
      true, true);
  }

  // --- Step 2: LLM advisory type cannot satisfy FinalGate PASS ---
  if (v.type === 'llm_advisory') {
    reasonCodes.push(FINAL_REASON_CODES.ADVISORY_CRITERION);
    return buildResult(criterion.id, taskId, 'INFO', reasonCodes, evidenceRefs,
      `Criterion "${criterion.id}" uses llm_advisory verification. It cannot satisfy FinalGate PASS.`,
      true, true);
  }

  // --- Step 3: manual_review type cannot satisfy FinalGate PASS ---
  if (v.type === 'manual_review') {
    reasonCodes.push(FINAL_REASON_CODES.MANUAL_REVIEW_REQUIRED);
    return buildResult(criterion.id, taskId, 'INFO', reasonCodes, evidenceRefs,
      `Criterion "${criterion.id}" requires manual review. Human must verify.`,
      true, false);
  }

  // --- Step 4: Human approval required ---
  if (criterion.humanApproved === false && criterion.criteriaSource === 'agent_draft') {
    reasonCodes.push(FINAL_REASON_CODES.CRITERION_NOT_HUMAN_APPROVED);
    return buildResult(criterion.id, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Criterion "${criterion.id}" is not human-approved (criteriaSource=${criterion.criteriaSource}). Cannot satisfy FinalGate PASS.`,
      false, false);
  }

  // --- Step 5: Evaluate by verification type ---
  return evaluateByType(ctx, criterion.id, taskId, v, reasonCodes, evidenceRefs);
}

// ---------------------------------------------------------------------------
// Dispatch by verification type
// ---------------------------------------------------------------------------

function evaluateByType(
  ctx: CriterionContext,
  criterionId: string,
  taskId: string,
  v: Verification,
  initialReasonCodes: string[],
  initialEvidenceRefs: string[],
): CriterionResult {
  const reasonCodes = [...initialReasonCodes];
  const evidenceRefs = [...initialEvidenceRefs];

  switch (v.type) {
    case 'file_exists':
      return evaluateFileExists(criterionId, taskId, v, ctx.repoRoot, reasonCodes, evidenceRefs);

    case 'file_contains':
      return evaluateFileContains(criterionId, taskId, v, ctx.repoRoot, reasonCodes, evidenceRefs);

    case 'static_pattern':
      return evaluateStaticPattern(criterionId, taskId, v, ctx.repoRoot, reasonCodes, evidenceRefs);

    case 'diff_contains':
      return evaluateDiffContains(criterionId, taskId, v, ctx.evidenceRecords, reasonCodes, evidenceRefs);

    case 'no_diff_contains':
      return evaluateNoDiffContains(criterionId, taskId, v, ctx.evidenceRecords, reasonCodes, evidenceRefs);

    case 'command_output':
      return evaluateCommandOutput(criterionId, taskId, v, ctx.commandResults, reasonCodes, evidenceRefs);

    case 'test_output':
      return evaluateTestOutput(criterionId, taskId, v, ctx.commandResults, reasonCodes, evidenceRefs);

    case 'schema_validation':
      return evaluateSchemaValidation(criterionId, taskId, v, ctx.repoRoot, ctx.planYaml, reasonCodes, evidenceRefs);

    case 'integration_contract':
      return evaluateIntegrationContract(criterionId, taskId, v, ctx.wiringResult, reasonCodes, evidenceRefs);

    // Deferred to v0.2
    case 'coverage':
    case 'import_graph':
    case 'entrypoint_reachability':
    case 'runtime_probe':
    case 'runner_discovery':
      reasonCodes.push(FINAL_REASON_CODES.NOT_EVALUATED);
      return buildResult(criterionId, taskId, 'INFO', reasonCodes, evidenceRefs,
        `Criterion "${criterionId}" with verification type "${v.type}" is deferred to v0.2. Not evaluated.`,
        true, false);

    default:
      // Unknown verification type — treat as not-evaluated
      reasonCodes.push(FINAL_REASON_CODES.NOT_EVALUATED);
      return buildResult(criterionId, taskId, 'INFO', reasonCodes, evidenceRefs,
        `Criterion "${criterionId}" has unknown verification type "${(v as Verification).type}". Not evaluated.`,
        true, false);
  }
}

// ---------------------------------------------------------------------------
// Verification type handlers
// ---------------------------------------------------------------------------

/** file_exists: check if the file at verification.path exists on disk. */
function evaluateFileExists(
  criterionId: string,
  taskId: string,
  v: Verification,
  repoRoot: string,
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  if (!v.path) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_NOT_FOUND);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Criterion "${criterionId}" has file_exists but no path specified. Cannot verify.`,
      false, false);
  }

  const fullPath = resolve(repoRoot, v.path);
  const exists = existsSync(fullPath);

  // Collect matching evidence refs for this file
  const fileEvidence = findEvidenceForPath(evidenceRefs, criterionId, v, v.path);
  evidenceRefs.push(...fileEvidence);

  if (exists) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_FOUND);
    return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
      `File "${v.path}" exists on disk.`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.FILE_NOT_FOUND);
  return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
    `File "${v.path}" does not exist at resolved path "${fullPath}".`,
    false, false);
}

/** file_contains: read file and check that ALL verification.patterns are present. */
function evaluateFileContains(
  criterionId: string,
  taskId: string,
  v: Verification,
  repoRoot: string,
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  if (!v.path) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_CONTENT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Criterion "${criterionId}" has file_contains but no path specified. Cannot verify.`,
      false, false);
  }

  const fullPath = resolve(repoRoot, v.path);

  if (!existsSync(fullPath)) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_NOT_FOUND);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `File "${v.path}" not found at "${fullPath}". Cannot check content.`,
      false, false);
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (err) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_CONTENT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Cannot read file "${v.path}": ${err instanceof Error ? err.message : String(err)}`,
      false, false);
  }

  const fileEvidence = findEvidenceForPath(evidenceRefs, criterionId, v, v.path);
  evidenceRefs.push(...fileEvidence);

  const patterns = v.patterns ?? [];
  if (patterns.length === 0) {
    // No patterns specified — file exists is sufficient
    reasonCodes.push(FINAL_REASON_CODES.FILE_FOUND);
    return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
      `File "${v.path}" exists (no patterns specified).`,
      false, false);
  }

  const missing = findMissingPatterns(content, patterns);

  if (missing.length > 0) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_CONTENT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `File "${v.path}" is missing patterns: ${missing.join(', ')}`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `File "${v.path}" contains all ${patterns.length} required patterns.`,
    false, false);
}

/** file_contains_all: same as file_contains but explicitly checks ALL patterns. */
function evaluateFileContainsAll(
  criterionId: string,
  taskId: string,
  v: Verification,
  repoRoot: string,
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  // file_contains_all is semantically identical to file_contains in v0.1
  if (!v.path) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_CONTENT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Criterion "${criterionId}" has file_contains_all but no path specified.`,
      false, false);
  }

  const fullPath = resolve(repoRoot, v.path);

  if (!existsSync(fullPath)) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_NOT_FOUND);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `File "${v.path}" not found at "${fullPath}".`,
      false, false);
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (err) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_CONTENT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Cannot read file "${v.path}": ${err instanceof Error ? err.message : String(err)}`,
      false, false);
  }

  const fileEvidence = findEvidenceForPath(evidenceRefs, criterionId, v, v.path);
  evidenceRefs.push(...fileEvidence);

  const patterns = v.patterns ?? [];
  if (patterns.length === 0) {
    reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
    return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
      `File "${v.path}" exists (no patterns specified for file_contains_all).`,
      false, false);
  }

  const missing = findMissingPatterns(content, patterns);

  if (missing.length > 0) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_CONTENT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `File "${v.path}" missing patterns for file_contains_all: ${missing.join(', ')}`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `File "${v.path}" contains all ${patterns.length} required patterns (file_contains_all).`,
    false, false);
}

/** static_pattern: resolve file and check all patterns present. */
function evaluateStaticPattern(
  criterionId: string,
  taskId: string,
  v: Verification,
  repoRoot: string,
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  if (!v.path) {
    reasonCodes.push(FINAL_REASON_CODES.STATIC_PATTERN_MISSING);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Criterion "${criterionId}" has static_pattern but no path specified.`,
      false, false);
  }

  const fullPath = resolve(repoRoot, v.path);

  if (!existsSync(fullPath)) {
    reasonCodes.push(FINAL_REASON_CODES.FILE_NOT_FOUND);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `File "${v.path}" not found for static_pattern check.`,
      false, false);
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (err) {
    reasonCodes.push(FINAL_REASON_CODES.STATIC_PATTERN_MISSING);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Cannot read file "${v.path}" for static_pattern: ${err instanceof Error ? err.message : String(err)}`,
      false, false);
  }

  const fileEvidence = findEvidenceForPath(evidenceRefs, criterionId, v, v.path);
  evidenceRefs.push(...fileEvidence);

  const patterns = v.patterns ?? [];
  if (patterns.length === 0) {
    reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
    return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
      `File "${v.path}" exists (no patterns specified for static_pattern).`,
      false, false);
  }

  const missing = findMissingPatterns(content, patterns);

  if (missing.length > 0) {
    reasonCodes.push(FINAL_REASON_CODES.STATIC_PATTERN_MISSING);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `File "${v.path}" missing static patterns: ${missing.join(', ')}`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `File "${v.path}" matches all ${patterns.length} static patterns.`,
    false, false);
}

/** diff_contains: search evidence records (type=diff) for a diff containing the pattern. */
function evaluateDiffContains(
  criterionId: string,
  taskId: string,
  v: Verification,
  evidenceRecords: EvidenceRecordV01[],
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  const patterns = v.patterns ?? [];
  if (patterns.length === 0) {
    // No patterns — check if any diff evidence exists for this criterion
    const diffRecords = evidenceRecords.filter(
      r => r.type === 'diff' && r.criterionId === criterionId,
    );
    if (diffRecords.length === 0) {
      reasonCodes.push(FINAL_REASON_CODES.DIFF_CONTENT_MISSING);
      return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
        `No diff evidence found for criterion "${criterionId}".`,
        false, false);
    }
    // Diff exists, no pattern check needed
    for (const r of diffRecords) {
      evidenceRefs.push(r.recordId);
    }
    reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
    return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
      `Diff evidence found for criterion "${criterionId}" (${diffRecords.length} records).`,
      false, false);
  }

  // Collect all diff evidence — search across all records that have summary/diff content
  const allDiffRecords = evidenceRecords.filter(r => r.type === 'diff');
  let foundMatch = false;

  for (const record of allDiffRecords) {
    const searchText = record.summary ?? '';
    const allPatternsMatch = patterns.every(pattern =>
      tryPatternMatch(searchText, pattern),
    );

    if (allPatternsMatch) {
      foundMatch = true;
      evidenceRefs.push(record.recordId);
      // Continue collecting refs but don't break — we want all matching evidence refs
    }
  }

  // Also check criterion-specific records
  const criterionDiffRecords = allDiffRecords.filter(r => r.criterionId === criterionId);
  for (const record of criterionDiffRecords) {
    if (!evidenceRefs.includes(record.recordId)) {
      evidenceRefs.push(record.recordId);
    }
  }

  if (!foundMatch && allDiffRecords.length === 0) {
    reasonCodes.push(FINAL_REASON_CODES.DIFF_CONTENT_MISSING);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `No diff evidence records found. Cannot verify diff_contains for criterion "${criterionId}".`,
      false, false);
  }

  if (!foundMatch) {
    reasonCodes.push(FINAL_REASON_CODES.DIFF_CONTENT_MISSING);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `No diff evidence contains the required patterns for criterion "${criterionId}".`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `Diff evidence contains all ${patterns.length} required patterns.`,
    false, false);
}

/** no_diff_contains: ensure NO diff contains the forbidden pattern → FAIL if found. */
function evaluateNoDiffContains(
  criterionId: string,
  taskId: string,
  v: Verification,
  evidenceRecords: EvidenceRecordV01[],
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  const patterns = v.patterns ?? [];
  if (patterns.length === 0) {
    // No forbidden patterns specified — criterion passes vacuously
    reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
    return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
      `No forbidden patterns specified for no_diff_contains — criterion passes vacuously.`,
      false, false);
  }

  const allDiffRecords = evidenceRecords.filter(r => r.type === 'diff');

  for (const record of allDiffRecords) {
    const searchText = record.summary ?? '';
    for (const pattern of patterns) {
      if (tryPatternMatch(searchText, pattern)) {
        evidenceRefs.push(record.recordId);
        reasonCodes.push(FINAL_REASON_CODES.FORBIDDEN_DIFF_CONTENT);
        return buildResult(criterionId, taskId, 'FAIL', reasonCodes, evidenceRefs,
          `Forbidden pattern "${pattern}" found in diff evidence record ${record.recordId}. Criterion "${criterionId}" FAILED.`,
          false, false);
      }
    }
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `No forbidden patterns found in diff evidence. Criterion "${criterionId}" passes.`,
    false, false);
}

/** command_output: find command result matching verification.commandRef, check expected output patterns. */
function evaluateCommandOutput(
  criterionId: string,
  taskId: string,
  v: Verification,
  commandResults: CommandResult[],
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  if (!v.commandRef) {
    reasonCodes.push(FINAL_REASON_CODES.COMMAND_OUTPUT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Criterion "${criterionId}" has command_output but no commandRef specified.`,
      false, false);
  }

  const cmdResult = commandResults.find(c => c.commandId === v.commandRef);

  if (!cmdResult) {
    reasonCodes.push(FINAL_REASON_CODES.COMMAND_OUTPUT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Command "${v.commandRef}" not found in command results. Cannot verify command_output for criterion "${criterionId}".`,
      false, false);
  }

  evidenceRefs.push(`command-${cmdResult.commandId}`);

  if (cmdResult.skipped) {
    reasonCodes.push(FINAL_REASON_CODES.COMMAND_OUTPUT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Command "${v.commandRef}" was skipped. Cannot verify command_output for criterion "${criterionId}".`,
      false, false);
  }

  const patterns = v.patterns ?? [];
  const combinedOutput = cmdResult.stdoutTruncated + cmdResult.stderrTruncated;

  if (patterns.length === 0) {
    // No patterns — check that command succeeded
    if (cmdResult.verdict === 'PASS' || cmdResult.verdict === 'INFO') {
      reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
      return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
        `Command "${v.commandRef}" succeeded (exitCode=${cmdResult.exitCode}). No output patterns specified.`,
        false, false);
    }

    reasonCodes.push(FINAL_REASON_CODES.COMMAND_OUTPUT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Command "${v.commandRef}" verdict is ${cmdResult.verdict} (exitCode=${cmdResult.exitCode}). Expected PASS.`,
      false, false);
  }

  const missing = findMissingPatterns(combinedOutput, patterns);

  if (missing.length > 0) {
    reasonCodes.push(FINAL_REASON_CODES.COMMAND_OUTPUT_MISMATCH);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Command "${v.commandRef}" output missing expected patterns: ${missing.join(', ')}`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `Command "${v.commandRef}" output contains all ${patterns.length} expected patterns.`,
    false, false);
}

/** test_output: check test pass/fail counts from command results. */
function evaluateTestOutput(
  criterionId: string,
  taskId: string,
  v: Verification,
  commandResults: CommandResult[],
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  // Find test-related command results
  const testCommands = commandResults.filter(c => {
    if (v.commandRef) return c.commandId === v.commandRef;
    return c.kind === 'targeted_test' || c.kind === 'final_validation';
  });

  if (testCommands.length === 0) {
    reasonCodes.push(FINAL_REASON_CODES.TEST_FAILURES);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `No test command results found for criterion "${criterionId}". Cannot evaluate test_output.`,
      false, false);
  }

  // Check each test command result
  let allPassed = true;
  const details: string[] = [];

  for (const cmd of testCommands) {
    evidenceRefs.push(`command-${cmd.commandId}`);

    if (cmd.skipped) {
      allPassed = false;
      details.push(`Command "${cmd.commandId}" was skipped.`);
      continue;
    }

    if (cmd.verdict === 'FAIL') {
      allPassed = false;
      details.push(`Command "${cmd.commandId}" FAILED (exitCode=${cmd.exitCode}).`);
      continue;
    }

    if (cmd.verdict === 'HOLD') {
      allPassed = false;
      details.push(`Command "${cmd.commandId}" returned HOLD (exitCode=${cmd.exitCode}).`);
      continue;
    }

    // Parse test counts from stdout if available
    const testCounts = parseTestCounts(cmd.stdoutTruncated);
    if (testCounts) {
      if (testCounts.failed > 0) {
        allPassed = false;
        details.push(`Command "${cmd.commandId}" has ${testCounts.failed}/${testCounts.total} test failures.`);
      } else {
        details.push(`Command "${cmd.commandId}" tests: ${testCounts.passed}/${testCounts.total} passed.`);
      }
    } else {
      if (cmd.exitCode !== 0) {
        allPassed = false;
        details.push(`Command "${cmd.commandId}" failed with exit code ${cmd.exitCode}.`);
      } else {
        details.push(`Command "${cmd.commandId}" succeeded (exitCode=${cmd.exitCode}).`);
      }
    }
  }

  if (!allPassed) {
    reasonCodes.push(FINAL_REASON_CODES.TEST_FAILURES);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Test failures detected: ${details.join(' ')}`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `All test commands passed. ${details.join(' ')}`,
    false, false);
}

/** schema_validation: re-validate using @praxis/contracts validatePlanSpec. */
function evaluateSchemaValidation(
  criterionId: string,
  taskId: string,
  v: Verification,
  repoRoot: string,
  planYaml: string | undefined,
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  if (!planYaml) {
    reasonCodes.push(FINAL_REASON_CODES.SCHEMA_VALIDATION_FAILED);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `Plan YAML not provided — cannot re-validate schema for criterion "${criterionId}".`,
      false, false);
  }

  const result = validatePlanSpec(planYaml, repoRoot);

  // Collect evidence refs from schema_validation evidence records
  if (v.evidenceRefs && v.evidenceRefs.length > 0) {
    evidenceRefs.push(...v.evidenceRefs);
  }

  if (!result.ok) {
    reasonCodes.push(FINAL_REASON_CODES.SCHEMA_VALIDATION_FAILED);
    const errorMessages = result.errors.map(e => e.message).join('; ');
    return buildResult(criterionId, taskId, 'FAIL', reasonCodes, evidenceRefs,
      `Schema validation FAILED: ${errorMessages}`,
      false, false);
  }

  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `Schema validation passed — plan is valid.`,
    false, false);
}

/** integration_contract: check wiring results for this task are all PASS. */
function evaluateIntegrationContract(
  criterionId: string,
  taskId: string,
  v: Verification,
  wiringResult: WiringGateResult | undefined,
  reasonCodes: string[],
  evidenceRefs: string[],
): CriterionResult {
  if (!wiringResult) {
    // No wiring result available but integration_contract is required
    reasonCodes.push(FINAL_REASON_CODES.INTEGRATION_CONTRACT_FAILED);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `WiringGate result not available — cannot verify integration_contract for criterion "${criterionId}".`,
      false, false);
  }

  // Check if WiringGate passed overall
  if (wiringResult.verdict !== 'PASS') {
    reasonCodes.push(FINAL_REASON_CODES.INTEGRATION_CONTRACT_FAILED);
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `WiringGate verdict is ${wiringResult.verdict}. Integration contract for criterion "${criterionId}" is not satisfied.`,
      false, false);
  }

  // Check task-specific wiring results if available
  const taskDeclaredUnitResults = wiringResult.declaredUnitResults.filter(
    du => du.path && du.exists,
  );
  const taskMissing = wiringResult.declaredUnitResults.filter(
    du => !du.exists || du.missingExports.length > 0,
  );

  if (taskMissing.length > 0) {
    evidenceRefs.push(...wiringResult.evidenceRefs);
    reasonCodes.push(FINAL_REASON_CODES.INTEGRATION_CONTRACT_FAILED);
    const missingDetails = taskMissing.map(du =>
      `${du.unitId} (exists=${du.exists}, missingExports=${du.missingExports.join(',')})`,
    ).join('; ');
    return buildResult(criterionId, taskId, 'HOLD', reasonCodes, evidenceRefs,
      `WiringGate found unsatisfied integration contracts: ${missingDetails}`,
      false, false);
  }

  evidenceRefs.push(...wiringResult.evidenceRefs);
  reasonCodes.push(FINAL_REASON_CODES.CRITERION_PASS);
  return buildResult(criterionId, taskId, 'PASS', reasonCodes, evidenceRefs,
    `Integration contract satisfied — all ${taskDeclaredUnitResults.length} declared units exist and match.`,
    false, false);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find evidence record refs that relate to a specific file path. */
function findEvidenceForPath(
  evidenceRefs: string[],
  criterionId: string,
  v: Verification,
  path: string,
): string[] {
  // This is a context function that returns refs from the outer scope's
  // evidenceRecords. The caller passes evidenceRefs only for type consistency.
  // We return the refs for the path-based criteria.
  return v.evidenceRefs ?? [];
}

/**
 * Check which patterns from a list are missing in the given content.
 * Patterns are treated as regex; if regex compilation fails, treated as literal string match.
 */
function findMissingPatterns(content: string, patterns: string[]): string[] {
  const missing: string[] = [];
  for (const pattern of patterns) {
    if (!tryPatternMatch(content, pattern)) {
      missing.push(pattern);
    }
  }
  return missing;
}

/**
 * Try to match a pattern against content.
 * If the pattern is a valid regex, use regex match; otherwise use literal substring match.
 */
function tryPatternMatch(content: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(content);
  } catch {
    // Invalid regex — treat as literal string
    return content.includes(pattern);
  }
}

/**
 * Parse test pass/fail counts from common test runner output patterns.
 * Recognizes patterns like:
 * - "Tests: 10 passed, 10 total" (bun test)
 * - "31 passed, 0 failed" (vitest)
 * - "10 passing (1s)" (mocha)
 * - "FAILED: 2 tests" (custom)
 */
function parseTestCounts(output: string): { total: number; passed: number; failed: number } | null {
  // Pattern: "X tests passed" / "X passed, Y failed"
  // bun test: "31 passed" "0 failed"
  const bunMatch = output.match(/(\d+)\s+passed/);
  const bunFailMatch = output.match(/(\d+)\s+failed/);

  if (bunMatch) {
    const passed = parseInt(bunMatch[1], 10);
    const failed = bunFailMatch ? parseInt(bunFailMatch[1], 10) : 0;
    return { total: passed + failed, passed, failed };
  }

  // Pattern: "Tests: N passed, M total"
  const testMatch = output.match(/Tests:\s*(\d+)\s*passed,\s*(\d+)\s*total/i);
  if (testMatch) {
    const passed = parseInt(testMatch[1], 10);
    const total = parseInt(testMatch[2], 10);
    return { total, passed, failed: total - passed };
  }

  // Pattern: "N passing" / "M failing" (mocha)
  const mochaPass = output.match(/(\d+)\s+passing/);
  const mochaFail = output.match(/(\d+)\s+failing/);
  if (mochaPass) {
    const passed = parseInt(mochaPass[1], 10);
    const failed = mochaFail ? parseInt(mochaFail[1], 10) : 0;
    return { total: passed + failed, passed, failed };
  }

  // Cannot parse — return null
  return null;
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function buildResult(
  criterionId: string,
  taskId: string,
  verdict: CriterionVerdict,
  reasonCodes: string[],
  evidenceRefs: string[],
  detail: string,
  skipped: boolean,
  advisory: boolean,
): CriterionResult {
  return {
    criterionId,
    taskId,
    verdict,
    reasonCodes: [...new Set(reasonCodes)],
    evidenceRefs: [...new Set(evidenceRefs)],
    detail,
    skipped,
    advisory,
  };
}
