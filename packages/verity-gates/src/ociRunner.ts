// @praxis/verity-gates — OCI runner interface (#24)
//
// Interface for running commands in pinned OCI containers. The mock
// adapter is used for tests; the real adapter (Docker/containerd) is
// wired in CI.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface OciMount {
  /** Host source path. */
  source: string;
  /** Container target path. */
  target: string;
  /** Read-only by default. */
  readonly?: boolean;
}

export interface OciRunOptions {
  image: string;
  /** Image digest for pinning (e.g. 'sha256:abc...'). */
  imageDigest: string;
  command: string[];
  mounts: OciMount[];
  workingDir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Run as non-root. */
  nonRoot?: boolean;
}

export interface OciRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  /** SHA-256 of stdout + stderr for diff-based integrity. */
  outputDigest: string;
}

export interface OciRunner {
  readonly name: string;
  run(opts: OciRunOptions): Promise<OciRunResult>;
  /** Check if the runner image is available. */
  checkImage(opts: OciRunOptions): Promise<boolean>;
}

export abstract class BaseOciRunner implements OciRunner {
  abstract readonly name: string;
  abstract run(opts: OciRunOptions): Promise<OciRunResult>;
  abstract checkImage(opts: OciRunOptions): Promise<boolean>;

  protected digestOutput(stdout: string, stderr: string): string {
    return createHash('sha256').update(`stdout:${stdout}\nstderr:${stderr}`).digest('hex');
  }
}

class MockOciInstance extends BaseOciRunner {
  readonly name = 'mock-oci';
  async run(opts: OciRunOptions): Promise<OciRunResult> {
    const stdout = `[mock-oci] ran ${opts.command.join(' ')} in ${opts.image}@${opts.imageDigest}`;
    const stderr = '';
    return { stdout, stderr, exitCode: 0, timedOut: false, outputDigest: this.digestOutput(stdout, stderr) };
  }
  async checkImage(): Promise<boolean> { return true; }
}

export const mockOciRunner = new MockOciInstance();

/**
 * Docker-based OCI runner. Requires Docker on the host.
 */
export class DockerOciRunner extends BaseOciRunner {
  readonly name = 'docker';
  constructor(public readonly dockerBinary: string = 'docker') { super(); }

  async run(opts: OciRunOptions): Promise<OciRunResult> {
    return new Promise((resolve, reject) => {
      const args = ['run', '--rm'];
      if (opts.nonRoot !== false) args.push('--user', '1000:1000');
      for (const m of opts.mounts) {
        args.push('--mount', `type=bind,source=${m.source},target=${m.target}${m.readonly !== false ? ',readonly' : ''}`);
      }
      if (opts.workingDir) args.push('--workdir', opts.workingDir);
      if (opts.env) for (const [k, v] of Object.entries(opts.env)) args.push('--env', `${k}=${v}`);
      args.push(`${opts.image}@${opts.imageDigest}`, ...opts.command);
      let stdout = '', stderr = '';
      const proc = spawn(this.dockerBinary, args, { timeout: opts.timeoutMs ?? 30000 });
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1, timedOut: false, outputDigest: this.digestOutput(stdout, stderr) }));
      proc.on('error', (e) => reject(e));
    });
  }

  async checkImage(opts: OciRunOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.dockerBinary, ['image', 'inspect', `${opts.image}@${opts.imageDigest}`]);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}