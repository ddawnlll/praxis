// @praxis/kernel — Network Sandboxing
// ExecGate enhancement: network isolation rules per command execution.
// v0.4: advisory-only network blocking, full sandboxing deferred to v0.5.

export interface NetworkPolicy {
  allow: 'all' | 'none' | 'loopback' | 'specific';
  allowedHosts?: string[];
  allowedPorts?: number[];
  blockLoopback?: boolean;
}

export interface SandboxResult {
  allowed: boolean;
  reason?: string;
}

const DEFAULT_POLICY: NetworkPolicy = { allow: 'all' };

export function checkNetworkAccess(
  command: string,
  policy: NetworkPolicy = DEFAULT_POLICY,
): SandboxResult {
  if (policy.allow === 'all') return { allowed: true };

  // Detect network-related commands
  const networkCmds = ['curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'telnet', 'ftp', 'socat'];
  const cmdName = command.trim().split(/\s+/)[0];
  const isNetworkCommand = networkCmds.some(n => cmdName === n || cmdName.startsWith(n));

  if (!isNetworkCommand) return { allowed: true };

  if (policy.allow === 'none') {
    return { allowed: false, reason: `Command '${cmdName}' requires network access but policy is 'none'` };
  }

  if (policy.allow === 'loopback') {
    // Extract host from command (simple heuristic)
    const urlMatch = command.match(/https?:\/\/([^\/:\s]+)/);
    const hostMatch = command.match(/(?:-H\s+)?(?:\w+\s+)?(?:(?:\d{1,3}\.){3}\d{1,3}|localhost|127\.0\.0\.1|::1)/);
    if (urlMatch) {
      const host = urlMatch[1];
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
        return { allowed: false, reason: `Host '${host}' not in loopback range` };
      }
    }
    return { allowed: true };
  }

  return { allowed: true };
}

export function createNetworkPolicy(policy: Partial<NetworkPolicy> & { allow: NetworkPolicy['allow'] }): NetworkPolicy {
  return { ...DEFAULT_POLICY, ...policy };
}
