#!/usr/bin/env node
// @praxis/mcp-server — MCP Server for PRAXIS Truth Kernel
//
// Model Context Protocol server that exposes Praxis verification as MCP tools.
// Designed for autonomous agents (Hermes, Claude Code, etc.) to call
// verification/validation/locking directly without CLI overhead.
//
// The MCP server IS the Praxis daemon — it holds warm state (parsed plan,
// lock cache, evidence index) and serves near-instant verification.
//
// Protocol: JSON-RPC 2.0 over stdio (standard MCP transport)
// No external MCP SDK needed — lightweight implementation.

import {
  createDaemon,
  type DaemonServer,
  type ValidateRequest,
  type VerifyRequest,
} from '@praxis/kernel';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// MCP Protocol Constants
// ---------------------------------------------------------------------------

const MCP_VERSION = '2025-03-26';
const SERVER_NAME = 'praxis-truth-kernel';
const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// MCP Server Implementation
// ---------------------------------------------------------------------------

/**
 * PRAXIS MCP Server
 *
 * stdio transport is inherently single-client (one stdin/stdout pipe).
 * The WarmState singleton is safe for stdio — only one agent connects.
 *
 * For TCP daemon (multi-client), session isolation is needed:
 * - Each connection should get its own WarmState or planId-namespaced state
 * - Rate limiting should be added for non-stdio transports
 * - Auth via environment variable token for non-stdio
 *
 * Current limitation: singleton WarmState shared across all connections.
 * This is correct for stdio (single client) but not for TCP daemon.
 */
class PraxisMcpServer {
  private daemon: DaemonServer;
  private requestId = 0;
  private initialized = false;
  private buffer = '';

  constructor(repoRoot: string) {
    this.daemon = createDaemon({ repoRoot, idleTimeoutMs: 0 }); // no auto-shutdown for MCP
  }

  /** Process a single JSON-RPC message and return the response. */
  private async handleMessage(msg: unknown): Promise<string | null> {
    if (!msg || typeof msg !== 'object') return null;

    const request = msg as Record<string, unknown>;
    const method = request.method as string | undefined;
    const id = request.id;
    const params = request.params as Record<string, unknown> | undefined;

    if (!method) return null;

    // Notification-style messages (no id) don't get responses
    const respond = (result: unknown) =>
      id !== undefined
        ? JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'
        : null;

    const respondError = (code: number, message: string) =>
      id !== undefined
        ? JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'
        : null;

    try {
      switch (method) {
        // -----------------------------------------------------------------------
        // Lifecycle
        // -----------------------------------------------------------------------
        case 'initialize':
          this.initialized = true;
          return respond({
            protocolVersion: MCP_VERSION,
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          });

        case 'initialized':
          return null; // No response needed

        // -----------------------------------------------------------------------
        // Tools
        // -----------------------------------------------------------------------
        case 'tools/list':
          return respond({
            tools: [
              {
                name: 'praxis_verify',
                description: 'Run the full 6-gate Truth Kernel verification pipeline. '
                  + 'Parses the plan, checks locks, validates evidence, verifies wiring, '
                  + 'executes commands, and evaluates acceptance criteria. '
                  + 'Returns structured verdict with per-gate results.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    planYaml: { type: 'string', description: 'PlanSpec YAML content' },
                    planPath: { type: 'string', description: 'Path to plan YAML file (alternative to planYaml)' },
                    evidenceLedgerPath: { type: 'string', description: 'Path to evidence JSONL file' },
                    attemptId: { type: 'string', description: 'Custom attempt ID (default: auto-generated)' },
                    lockMode: {
                      type: 'string',
                      enum: ['verify_existing', 'create_if_missing', 'refresh_explicit'],
                      description: 'Lock mode (default: verify_existing)',
                    },
                    gates: {
                      type: 'array',
                      items: { type: 'string', enum: ['schema', 'lock', 'evidence', 'wiring', 'exec', 'final'] },
                      description: 'Gate filter — only run these gates (default: all 6)',
                    },
                    stopOnHold: { type: 'boolean', description: 'Stop pipeline on HOLD verdict' },
                  },
                  required: [],
                },
              },
              {
                name: 'praxis_validate',
                description: 'Validate a PlanSpec against the schema. Fast path — runs SchemaGate only, '
                  + 'typically <500ms. Returns PASS/HOLD/FAIL with reason codes and diagnostics.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    planYaml: { type: 'string', description: 'PlanSpec YAML content' },
                    planPath: { type: 'string', description: 'Path to plan YAML file' },
                  },
                  required: ['planYaml'],
                },
              },
              {
                name: 'praxis_status',
                description: 'Get the current Praxis daemon status: loaded plan, evidence record count, '
                  + 'cache statistics, and running state.',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
              {
                name: 'praxis_cache_stats',
                description: 'Get gate cache statistics: hit/miss counts per gate namespace. '
                  + 'Useful for understanding which gates benefit from caching.',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
            ],
          });

        case 'tools/call': {
          const toolName = params?.name as string | undefined;
          const arguments_ = (params?.arguments ?? {}) as Record<string, unknown>;

          switch (toolName) {
            case 'praxis_verify': {
              let planYaml = arguments_.planYaml as string | undefined;
              const planPath = arguments_.planPath as string | undefined;

              if (!planYaml && planPath) {
                const resolved = resolve(this.daemon.config.repoRoot, planPath);
                if (existsSync(resolved)) {
                  planYaml = readFileSync(resolved, 'utf-8');
                }
              }

              if (!planYaml) {
                return respondError(-32602, 'Missing required argument: planYaml or planPath');
              }

              const request: VerifyRequest = {
                planYaml,
                evidenceLedgerPath: arguments_.evidenceLedgerPath as string | undefined,
                attemptId: arguments_.attemptId as string | undefined,
                lockMode: (arguments_.lockMode as VerifyRequest['lockMode']) ?? 'create_if_missing',
                gates: arguments_.gates as string[] | undefined,
                stopOnHold: arguments_.stopOnHold as boolean | undefined,
              };

              const result = await this.daemon.handleVerify(request);
              return respond({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      verdict: result.verdict,
                      ok: result.ok,
                      attemptId: result.attemptId,
                      timeMs: result.timeMs,
                      gates: result.gateResults.map(g => ({
                        name: g.gateName,
                        verdict: g.verdict,
                        reasonCodes: g.reasonCodes,
                        cached: g.cached,
                      })),
                      diagnostics: result.diagnostics,
                    }, null, 2),
                  },
                ],
              });
            }

            case 'praxis_validate': {
              const planYaml = arguments_.planYaml as string | undefined;
              if (!planYaml) {
                return respondError(-32602, 'Missing required argument: planYaml');
              }

              const result = await this.daemon.handleValidate({ planYaml });
              return respond({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                  },
                ],
              });
            }

            case 'praxis_status': {
              return respond({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      running: this.daemon.state.running,
                      planLoaded: !!this.daemon.state.plan,
                      planId: this.daemon.state.plan?.metadata?.planId ?? null,
                      planTitle: this.daemon.state.plan?.metadata?.title ?? null,
                      evidenceRecords: this.daemon.state.evidenceCount,
                      lockLoaded: !!this.daemon.state.lock,
                      cacheStats: this.daemon.state.gateCache.stats(),
                    }, null, 2),
                  },
                ],
              });
            }

            case 'praxis_cache_stats': {
              return respond({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(this.daemon.state.gateCache.stats(), null, 2),
                  },
                ],
              });
            }

            default:
              return respondError(-32601, `Unknown tool: ${toolName}`);
          }
        }

        // -----------------------------------------------------------------------
        // Resources
        // -----------------------------------------------------------------------
        case 'resources/list':
          return respond({
            resources: [
              {
                uri: 'praxis://status',
                name: 'Current Daemon Status',
                description: 'Praxis daemon status: plan loaded, evidence count, cache stats',
                mimeType: 'application/json',
              },
              {
                uri: 'praxis://cache-stats',
                name: 'Gate Cache Statistics',
                description: 'Hit/miss counts per gate namespace',
                mimeType: 'application/json',
              },
            ],
          });

        case 'resources/read': {
          const uri = params?.uri as string | undefined;
          if (uri === 'praxis://status') {
            return respond({
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  running: this.daemon.state.running,
                  planLoaded: !!this.daemon.state.plan,
                  planId: this.daemon.state.plan?.metadata?.planId ?? null,
                  evidenceRecords: this.daemon.state.evidenceCount,
                  cacheStats: this.daemon.state.gateCache.stats(),
                }, null, 2),
              }],
            });
          }
          if (uri === 'praxis://cache-stats') {
            return respond({
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(this.daemon.state.gateCache.stats(), null, 2),
              }],
            });
          }
          return respondError(-32602, `Unknown resource: ${uri}`);
        }

        // -----------------------------------------------------------------------
        // Prompts
        // -----------------------------------------------------------------------
        case 'prompts/list':
          return respond({
            prompts: [
              {
                name: 'review-evidence',
                description: 'Generate a structured review prompt for evidence records',
                arguments: [
                  {
                    name: 'attemptId',
                    description: 'Filter by attempt ID',
                    required: false,
                  },
                ],
              },
            ],
          });

        case 'prompts/get': {
          const promptName = params?.name as string | undefined;
          if (promptName === 'review-evidence') {
            return respond({
              messages: [{
                role: 'user',
                content: {
                  type: 'text',
                  text: 'Review the evidence records from the last Praxis verification run. '
                    + 'Check: (1) Are all required evidence types present? '
                    + '(2) Are there any divergence records? '
                    + '(3) Is deterministic evidence available for required criteria?',
                },
              }],
            });
          }
          return respondError(-32602, `Unknown prompt: ${promptName}`);
        }

        // -----------------------------------------------------------------------
        // Unknown method
        // -----------------------------------------------------------------------
        default:
          return respondError(-32601, `Unknown method: ${method}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return respondError(-32603, `Internal error: ${msg}`);
    }
  }

  /** Stream data from stdin, process messages, write responses to stdout. */
  async run(): Promise<void> {
    const stdin = process.stdin;
    const stdout = process.stdout;

    // Use stderr for logging (MCP protocol: stdout is for JSON-RPC only)
    process.stderr.write('praxis-mcp: server starting\n');

    stdin.setEncoding('utf-8');
    stdin.on('data', async (chunk: string) => {
      this.buffer += chunk;

      // Support both Content-Length framing (LSP style) and newline-delimited
      while (this.buffer.length > 0) {
        // Try Content-Length framing first
        if (this.buffer.startsWith('Content-Length:')) {
          const headerEnd = this.buffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) break; // incomplete header

          const header = this.buffer.slice(0, headerEnd);
          const lengthMatch = header.match(/Content-Length:\s*(\d+)/);
          if (!lengthMatch) {
            this.buffer = this.buffer.slice(headerEnd + 4);
            continue;
          }

          const contentLength = parseInt(lengthMatch[1], 10);
          const bodyStart = headerEnd + 4;
          if (this.buffer.length < bodyStart + contentLength) break; // incomplete body

          const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
          this.buffer = this.buffer.slice(bodyStart + contentLength);

          try {
            const msg = JSON.parse(body);
            const response = await this.handleMessage(msg);
            if (response) {
              stdout.write(`Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`);
            }
          } catch (parseErr) {
            const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            const errorResponse = JSON.stringify({
              jsonrpc: '2.0', id: null,
              error: { code: -32700, message: `Parse error: ${parseMsg}` },
            });
            stdout.write(`Content-Length: ${Buffer.byteLength(errorResponse)}\r\n\r\n${errorResponse}`);
          }
        } else {
          // Fall back to newline-delimited JSON
          const newlineIdx = this.buffer.indexOf('\n');
          if (newlineIdx === -1) break;

          const line = this.buffer.slice(0, newlineIdx);
          this.buffer = this.buffer.slice(newlineIdx + 1);

          if (!line.trim()) continue;

          try {
            const msg = JSON.parse(line);
            const response = await this.handleMessage(msg);
            if (response) {
              stdout.write(response);
            }
          } catch (parseErr) {
            const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            const errorResponse = JSON.stringify({
              jsonrpc: '2.0', id: null,
              error: { code: -32700, message: `Parse error: ${parseMsg}` },
            }) + '\n';
            stdout.write(errorResponse);
          }
        }
      }
    });

    stdin.on('end', () => {
      this.daemon.stop();
    });

    // Keep alive
    return new Promise(() => {});
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const repoRoot = process.env.PRAXIS_REPO_ROOT ?? process.cwd();
  const server = new PraxisMcpServer(repoRoot);
  await server.run();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`praxis-mcp: fatal error — ${msg}\n`);
  process.exit(1);
});
