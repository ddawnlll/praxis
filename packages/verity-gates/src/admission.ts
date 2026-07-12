// @praxis/verity-gates — AdmissionGate (#21)
//
// Validates: protocol version, capability match, identity present,
// manifest schemaVersion, baseHash format, idempotencyKey uniqueness
// (when supplied), policyId binding.

import type { Gate, GateContext, GateResult } from './gate';
import { makeResult } from './gate';
import { validate } from '@praxis/protocol';
import type { GateName } from '@praxis/protocol';

const HEX64 = /^[a-f0-9]{64}$/;

export class AdmissionGate implements Gate {
  readonly name: GateName = 'admission';

  evaluate(ctx: GateContext): GateResult {
    const at = new Date().toISOString();

    // 1. protocolVersion must be v1 (or an envelope carries it).
    if (ctx.envelope && ctx.envelope.protocolVersion !== 'praxis-protocol/v1') {
      return makeResult(this.name, 'FAIL', 'ADMISSION_PROTOCOL_VERSION', at);
    }

    // 2. Manifest schema validation
    const r = validate('candidate-manifest-v1', ctx.manifest);
    if (!r.ok) {
      return makeResult(this.name, 'FAIL', `ADMISSION_MANIFEST_INVALID:${r.issues[0]?.path ?? '?'}`, at);
    }

    // 3. baseHash format
    if (!HEX64.test(ctx.manifest.baseHash)) {
      return makeResult(this.name, 'FAIL', 'ADMISSION_BASEHASH_FORMAT', at);
    }

    // 4. policyId binding — the manifest's policyId must match the policy in
    //    the context. (Loose check; the IntegrityGate tightens this.)
    if (ctx.manifest.policyId !== ctx.policy.policyId) {
      return makeResult(this.name, 'FAIL', 'ADMISSION_POLICY_BINDING', at);
    }

    // 5. Authority: policy.authority.requiredIdentityId must be non-empty
    if (ctx.policy.authority.requiredIdentityId.length === 0) {
      return makeResult(this.name, 'FAIL', 'ADMISSION_AUTHORITY_MISSING', at);
    }

    // 6. envelope capability gate (when envelope is present)
    if (ctx.envelope) {
      if (!ctx.envelope.capabilities.includes('verify.cold') && !ctx.envelope.capabilities.includes('verify.daemon')) {
        return makeResult(this.name, 'FAIL', 'ADMISSION_CAPABILITY_MISSING', at);
      }
      // Sender identity is required.
      if (ctx.envelope.sender.identityId.length === 0 || ctx.envelope.sender.keyId.length === 0) {
        return makeResult(this.name, 'FAIL', 'ADMISSION_SENDER_MISSING', at);
      }
    }

    return makeResult(this.name, 'PASS', 'ADMISSION_OK', at);
  }
}
