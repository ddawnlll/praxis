// @praxis/verity-gates — Isolation policy + dry-run verifier (#25)
//
// Network, resource, and process isolation. Real enforcement requires
// Linux namespaces/cgroups or Docker. This module provides the policy
// types and a dry-run verifier that checks the policy shape.

export interface IsolationPolicy {
  /** Network: default-deny with allowlist. */
  network: {
    /** Default policy: 'deny' or 'allow'. */
    defaultPolicy: 'deny' | 'allow';
    /** Host allowlist (hostnames or IPs:port). */
    hostAllowlist?: string[];
    /** Loopback allowed. */
    loopbackAllowed: boolean;
  };
  /** Resource limits. */
  resources: {
    maxCpuCores?: number;
    maxMemoryMb?: number;
    maxPids?: number;
    maxOutputBytes?: number;
    timeoutMs?: number;
  };
  /** Process isolation. */
  process: {
    /** Prevent new privileges. */
    noNewPrivileges: boolean;
    /** Kill child process tree on timeout. */
    killTreeOnTimeout: boolean;
  };
}

const DEFAULT_ISOLATION: IsolationPolicy = {
  network: { defaultPolicy: 'deny', hostAllowlist: [], loopbackAllowed: true },
  resources: { maxCpuCores: 2, maxMemoryMb: 1024, maxPids: 64, maxOutputBytes: 10 * 1024 * 1024, timeoutMs: 60000 },
  process: { noNewPrivileges: true, killTreeOnTimeout: true },
};

export function defaultIsolationPolicy(): IsolationPolicy {
  return JSON.parse(JSON.stringify(DEFAULT_ISOLATION)) as IsolationPolicy;
}

export interface IsolationCheckResult {
  ok: boolean;
  violations: string[];
}

/**
 * Dry-run verifier: checks that the isolation policy is well-formed.
 * Does NOT enforce — use the real OCI runner for enforcement.
 */
export function verifyIsolationPolicy(policy: IsolationPolicy): IsolationCheckResult {
  const violations: string[] = [];
  if (policy.network.defaultPolicy !== 'deny' && policy.network.defaultPolicy !== 'allow') {
    violations.push('network.defaultPolicy must be "deny" or "allow"');
  }
  if (policy.resources.maxCpuCores !== undefined && policy.resources.maxCpuCores < 0.1) {
    violations.push('maxCpuCores too low');
  }
  if (policy.resources.maxMemoryMb !== undefined && policy.resources.maxMemoryMb < 8) {
    violations.push('maxMemoryMb too low');
  }
  if (policy.resources.maxPids !== undefined && policy.resources.maxPids < 2) {
    violations.push('maxPids too low');
  }
  if (policy.resources.maxOutputBytes !== undefined && policy.resources.maxOutputBytes < 1024) {
    violations.push('maxOutputBytes too low');
  }
  if (policy.resources.timeoutMs !== undefined && policy.resources.timeoutMs < 100) {
    violations.push('timeoutMs too low');
  }
  return { ok: violations.length === 0, violations };
}