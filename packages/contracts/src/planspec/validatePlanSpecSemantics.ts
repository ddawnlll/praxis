// @praxis/contracts — Semantic Validator
// Cross-reference and semantic checks not expressible in JSON Schema.

import type { PlanSpecV01 } from './types';
import { Diagnostic, error, warning, info } from './diagnostics';

export interface SemanticValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

const REQUIRED_GATE_SEQUENCE = [
  'SchemaGate',
  'LockGate',
  'EvidenceGate',
  'WiringGate',
  'ExecGate',
  'FinalGate',
] as const;

const REQUIRED_HASH_FIELDS = [
  'planHash',
  'acceptanceCriteriaHash',
  'artifactPolicyHash',
  'integrationContractHash',
  'commandPolicyHash',
  'allowedFilesHash',
  'forbiddenFilesHash',
] as const;

const VALID_VERDICTS = ['PASS', 'HOLD', 'FAIL'] as const;

const ALL_GATE_KEYS = [
  'SchemaGate',
  'LockGate',
  'EvidenceGate',
  'WiringGate',
  'ExecGate',
  'FinalGate',
];

/**
 * Run all semantic validation rules.
 * Assumes input has already passed schema validation.
 */
export function validatePlanSpecSemantics(plan: PlanSpecV01): SemanticValidationResult {
  const diagnostics: Diagnostic[] = [];

  // --- Identity checks ---
  checkIdentity(plan, diagnostics);

  // --- Uniqueness checks ---
  checkUniqueness(plan, diagnostics);

  // --- Command reference checks ---
  checkCommandRefs(plan, diagnostics);

  // --- Evidence reference checks ---
  checkEvidenceRefs(plan, diagnostics);

  // --- Artifact contract consistency ---
  checkArtifactContracts(plan, diagnostics);

  // --- Acceptance criteria authority ---
  checkAcceptanceCriteriaAuthority(plan, diagnostics);

  // --- Gates checks ---
  checkGates(plan, diagnostics);

  // --- Locking checks ---
  checkLocking(plan, diagnostics);

  // --- Repair/report consistency ---
  checkRepairReport(plan, diagnostics);

  // Determine ok: no errors (warnings and info don't block)
  const hasErr = diagnostics.some(d => d.severity === 'error');
  return { ok: !hasErr, diagnostics };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function checkIdentity(plan: PlanSpecV01, diags: Diagnostic[]): void {
  if (plan.planSpecVersion !== '0.1.0') {
    diags.push(error(
      'SEMANTIC_IDENTITY_MISMATCH',
      `planSpecVersion must be "0.1.0", got "${plan.planSpecVersion}".`,
      { path: '/planSpecVersion' },
    ));
  }
  if (plan.kind !== 'ImplementationPlan') {
    diags.push(error(
      'SEMANTIC_IDENTITY_MISMATCH',
      `kind must be "ImplementationPlan", got "${plan.kind}".`,
      { path: '/kind' },
    ));
  }
  if (plan.profile !== 'praxis-v0.1') {
    diags.push(error(
      'SEMANTIC_IDENTITY_MISMATCH',
      `profile must be "praxis-v0.1", got "${plan.profile}".`,
      { path: '/profile' },
    ));
  }
}

// ---------------------------------------------------------------------------
// Uniqueness
// ---------------------------------------------------------------------------

function checkUniqueness(plan: PlanSpecV01, diags: Diagnostic[]): void {
  // Task IDs must be unique
  const taskIds = new Set<string>();
  for (const task of plan.tasks) {
    if (taskIds.has(task.id)) {
      diags.push(error(
        'DUPLICATE_TASK_ID',
        `Duplicate task ID "${task.id}".`,
        { taskId: task.id },
      ));
    }
    taskIds.add(task.id);
  }

  // Acceptance criterion IDs — globally unique
  const acIds = new Set<string>();
  for (const task of plan.tasks) {
    for (const ac of task.acceptanceCriteria) {
      if (acIds.has(ac.id)) {
        diags.push(error(
          'DUPLICATE_ACCEPTANCE_CRITERION_ID',
          `Duplicate acceptance criterion ID "${ac.id}".`,
          { criterionId: ac.id, taskId: task.id },
        ));
      }
      acIds.add(ac.id);
    }
  }

  // Command IDs must be unique
  const cmdIds = new Set<string>();
  for (const cmd of plan.commands.exactAllowedCommands) {
    if (cmdIds.has(cmd.id)) {
      diags.push(error(
        'DUPLICATE_COMMAND_ID',
        `Duplicate command ID "${cmd.id}".`,
        { commandRef: cmd.id },
      ));
    }
    cmdIds.add(cmd.id);
  }
}

// ---------------------------------------------------------------------------
// Command references
// ---------------------------------------------------------------------------

function checkCommandRefs(plan: PlanSpecV01, diags: Diagnostic[]): void {
  const cmdIds = new Set(plan.commands.exactAllowedCommands.map(c => c.id));

  const checkRef = (ref: string | undefined, location: string, taskId?: string, criterionId?: string): void => {
    if (!ref) return;
    if (!cmdIds.has(ref)) {
      diags.push(error(
        'COMMAND_REF_NOT_FOUND',
        `Command reference "${ref}" not found in exactAllowedCommands (${location}).`,
        { commandRef: ref, taskId, criterionId },
      ));
    }
  };

  for (const task of plan.tasks) {
    for (const ac of task.acceptanceCriteria) {
      const v = ac.verification;
      if (v.commandRef) {
        checkRef(v.commandRef, `acceptanceCriteria[${ac.id}].verification.commandRef`, task.id, ac.id);
      }
    }

    const ic = task.integrationContract;
    if (ic) {
      if (ic.usageProofs) {
        for (const up of ic.usageProofs) {
          checkRef(up.commandRef, `integrationContract.usageProofs[${up.id}].commandRef`, task.id);
        }
      }
      if (ic.runtimeProbes) {
        for (const rp of ic.runtimeProbes) {
          checkRef(rp.commandRef, `integrationContract.runtimeProbes[${rp.id}].commandRef`, task.id);
        }
      }
      if (ic.runnerDiscovery) {
        for (const rd of ic.runnerDiscovery) {
          checkRef(rd.commandRef, `integrationContract.runnerDiscovery[${rd.id}].commandRef`, task.id);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Evidence references
// ---------------------------------------------------------------------------

function checkEvidenceRefs(plan: PlanSpecV01, diags: Diagnostic[]): void {
  const declaredEvidence = new Set(plan.evidence.requiredEvidenceTypes);

  // acceptanceCriteria[].requiredEvidence must exist in evidence.requiredEvidenceTypes
  for (const task of plan.tasks) {
    for (const ac of task.acceptanceCriteria) {
      for (const ev of ac.requiredEvidence) {
        if (!declaredEvidence.has(ev)) {
          diags.push(warning(
            'REQUIRED_EVIDENCE_NOT_DECLARED',
            `Acceptance criterion "${ac.id}" requires evidence type "${ev}" which is not declared in evidence.requiredEvidenceTypes.`,
            { criterionId: ac.id, taskId: task.id, details: { required: ev, declared: [...declaredEvidence] } },
          ));
        }
      }
      // verification.evidenceRefs — warning only (runtime evidence labels may vary)
      for (const evRef of ac.verification.evidenceRefs) {
        if (!declaredEvidence.has(evRef as typeof plan.evidence.requiredEvidenceTypes[number])) {
          diags.push(info(
            'REQUIRED_EVIDENCE_NOT_DECLARED',
            `Verification evidenceRef "${evRef}" in criterion "${ac.id}" does not match a declared evidence type (may be a runtime label).`,
            { criterionId: ac.id, taskId: task.id },
          ));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Artifact contract consistency
// ---------------------------------------------------------------------------

function checkArtifactContracts(plan: PlanSpecV01, diags: Diagnostic[]): void {
  for (const task of plan.tasks) {
    const cls = task.artifactPolicy.class;
    const ic = task.integrationContract;

    // runtime_code and cli_command must have integrationContract
    if ((cls === 'runtime_code' || cls === 'cli_command') && !ic) {
      diags.push(error(
        'CONTRACT_MODE_ARTIFACT_POLICY_MISMATCH',
        `Task "${task.id}" with artifact class "${cls}" requires an integrationContract.`,
        { taskId: task.id },
      ));
      continue; // Skip further IC checks if missing
    }

    if (!ic) continue; // Documentation etc. don't need IC

    // runtime_code / cli_command cannot use mode:none
    if ((cls === 'runtime_code' || cls === 'cli_command') && ic.mode === 'none') {
      diags.push(error(
        'CONTRACT_MODE_ARTIFACT_POLICY_MISMATCH',
        `Task "${task.id}" with artifact class "${cls}" cannot use integrationContract.mode="none".`,
        { taskId: task.id },
      ));
    }

    // wiringRequired=consumer_or_export requires usageProofs or exportSurfaces
    if (task.artifactPolicy.wiringRequired === 'consumer_or_export') {
      const hasProof = (ic.usageProofs && ic.usageProofs.length > 0) ||
        (ic.exportSurfaces && ic.exportSurfaces.length > 0);
      if (!hasProof) {
        diags.push(error(
          'CONTRACT_MODE_ARTIFACT_POLICY_MISMATCH',
          `Task "${task.id}" has wiringRequired=consumer_or_export but missing usageProofs or exportSurfaces.`,
          { taskId: task.id },
        ));
      }
    }

    // wiringRequired=runner_discovery requires runnerDiscovery
    if (task.artifactPolicy.wiringRequired === 'runner_discovery') {
      if (!ic.runnerDiscovery || ic.runnerDiscovery.length === 0) {
        diags.push(error(
          'CONTRACT_MODE_ARTIFACT_POLICY_MISMATCH',
          `Task "${task.id}" has wiringRequired=runner_discovery but missing runnerDiscovery.`,
          { taskId: task.id },
        ));
      }
    }

    // reachabilityRequired=true requires entrypoints
    if (task.artifactPolicy.reachabilityRequired === true) {
      if (!ic.entrypoints || ic.entrypoints.length === 0) {
        diags.push(error(
          'CONTRACT_MODE_ARTIFACT_POLICY_MISMATCH',
          `Task "${task.id}" has reachabilityRequired=true but missing entrypoints.`,
          { taskId: task.id },
        ));
      }
    }

    // executionRequired=true requires runtimeProbes or usageProofs
    // Unless artifact class is documentation/generated_report with executionRequired=false
    if (task.artifactPolicy.executionRequired === true) {
      const hasExecutionProof = (ic.runtimeProbes && ic.runtimeProbes.length > 0) ||
        (ic.usageProofs && ic.usageProofs.length > 0);
      if (!hasExecutionProof) {
        // Only flag if this isn't a doc-only task (schema already enforces this)
        if (cls !== 'documentation' && cls !== 'generated_report') {
          diags.push(error(
            'CONTRACT_MODE_ARTIFACT_POLICY_MISMATCH',
            `Task "${task.id}" has executionRequired=true but missing runtimeProbes or usageProofs.`,
            { taskId: task.id },
          ));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Acceptance criteria authority
// ---------------------------------------------------------------------------

function checkAcceptanceCriteriaAuthority(plan: PlanSpecV01, diags: Diagnostic[]): void {
  for (const task of plan.tasks) {
    for (const ac of task.acceptanceCriteria) {
      // Unapproved cannot satisfy FinalGate
      if (!ac.humanApproved && ac.verification.canSatisfyFinalGate) {
        diags.push(error(
          'UNAPPROVED_FINALGATE_CRITERION',
          `Acceptance criterion "${ac.id}" has humanApproved=false but canSatisfyFinalGate=true.`,
          { criterionId: ac.id, taskId: task.id },
        ));
      }

      // advisoryOnly cannot satisfy FinalGate
      if (ac.verification.advisoryOnly && ac.verification.canSatisfyFinalGate) {
        diags.push(error(
          'ADVISORY_FINALGATE_CRITERION',
          `Acceptance criterion "${ac.id}" has advisoryOnly=true but canSatisfyFinalGate=true.`,
          { criterionId: ac.id, taskId: task.id },
        ));
      }

      // agent_draft can only have canSatisfyFinalGate=false
      if (ac.criteriaSource === 'agent_draft' && ac.verification.canSatisfyFinalGate) {
        diags.push(error(
          'AGENT_DRAFT_FINALGATE_CRITERION',
          `Acceptance criterion "${ac.id}" has criteriaSource=agent_draft but canSatisfyFinalGate=true.`,
          { criterionId: ac.id, taskId: task.id },
        ));
      }

      // deterministic=false + canSatisfyFinalGate=true = semantic error
      if (!ac.verification.deterministic && ac.verification.canSatisfyFinalGate) {
        diags.push(error(
          'FINAL_GATE_UNSUPPORTED_BY_REQUIRED_CRITERION',
          `Acceptance criterion "${ac.id}" has deterministic=false but canSatisfyFinalGate=true. Non-deterministic criteria cannot satisfy FinalGate.`,
          { criterionId: ac.id, taskId: task.id },
        ));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function checkGates(plan: PlanSpecV01, diags: Diagnostic[]): void {
  const seq = plan.gates.sequence;

  // Sequence must match exactly
  if (seq.length !== REQUIRED_GATE_SEQUENCE.length) {
    diags.push(error(
      'INVALID_GATE_SEQUENCE',
      `Gates sequence must have exactly ${REQUIRED_GATE_SEQUENCE.length} items, got ${seq.length}.`,
      { gate: 'sequence' },
    ));
  } else {
    for (let i = 0; i < REQUIRED_GATE_SEQUENCE.length; i++) {
      if (seq[i] !== REQUIRED_GATE_SEQUENCE[i]) {
        diags.push(error(
          'INVALID_GATE_SEQUENCE',
          `Gates sequence[${i}] must be "${REQUIRED_GATE_SEQUENCE[i]}", got "${seq[i]}".`,
          { gate: seq[i] as string },
        ));
      }
    }
  }

  // Verdicts must include PASS, HOLD, FAIL
  const verdictSet = new Set(plan.gates.verdicts);
  for (const v of VALID_VERDICTS) {
    if (!verdictSet.has(v)) {
      diags.push(error(
        'INVALID_GATE_SEQUENCE',
        `Gates verdicts must include "${v}".`,
        { gate: 'verdicts' },
      ));
    }
  }

  // reasonCodes must have keys for all gates
  const reasonKeys = Object.keys(plan.gates.reasonCodes);
  for (const gate of ALL_GATE_KEYS) {
    if (!reasonKeys.includes(gate)) {
      diags.push(warning(
        'INVALID_GATE_SEQUENCE',
        `Gates reasonCodes should include key "${gate}".`,
        { gate },
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

function checkLocking(plan: PlanSpecV01, diags: Diagnostic[]): void {
  const hashSet = new Set(plan.locking.hashes);

  // Check for required hash fields — warning only because schema allows any subset
  // and not all plans have integration contracts, etc.
  for (const field of REQUIRED_HASH_FIELDS) {
    if (!hashSet.has(field)) {
      diags.push(warning(
        'MISSING_REQUIRED_HASH_FIELD',
        `Locking hashes should include "${field}".`,
        { path: '/locking/hashes' },
      ));
    }
  }

  // Check for unknown hash fields
  for (const h of plan.locking.hashes) {
    if (!(REQUIRED_HASH_FIELDS as readonly string[]).includes(h)) {
      diags.push(warning(
        'HASH_FIELD_MISMATCH',
        `Unknown hash field "${h}" in locking.hashes.`,
        { path: '/locking/hashes' },
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Repair/report consistency
// ---------------------------------------------------------------------------

function checkRepairReport(plan: PlanSpecV01, diags: Diagnostic[]): void {
  if (plan.reports.repairPacketRequiredOnHoldOrFail) {
    if (!plan.repair.enabled) {
      diags.push(error(
        'REPAIR_REPORT_INCONSISTENT',
        'reports.repairPacketRequiredOnHoldOrFail=true requires repair.enabled=true.',
        { path: '/repair/enabled' },
      ));
    }
  }

  // repair.failedCriteriaOnly must be true (schema enforces const, but double-check)
  if (plan.repair.failedCriteriaOnly !== true) {
    diags.push(error(
      'REPAIR_REPORT_INCONSISTENT',
      'repair.failedCriteriaOnly must be true.',
      { path: '/repair/failedCriteriaOnly' },
    ));
  }

  // repair.mayModifyAcceptanceCriteria must be false
  if (plan.repair.mayModifyAcceptanceCriteria !== false) {
    diags.push(error(
      'REPAIR_REPORT_INCONSISTENT',
      'repair.mayModifyAcceptanceCriteria must be false.',
      { path: '/repair/mayModifyAcceptanceCriteria' },
    ));
  }

  // repair.mayModifyPlan must be false
  if (plan.repair.mayModifyPlan !== false) {
    diags.push(error(
      'REPAIR_REPORT_INCONSISTENT',
      'repair.mayModifyPlan must be false.',
      { path: '/repair/mayModifyPlan' },
    ));
  }
}
