// @praxis/claude-plugin — Configuration reader
// Reads plugin configuration from praxis plugin config file and Claude Code settings.
// Plugin is READ-ONLY display + dispatch. Never decides truth.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Plugin configuration shape. */
export interface PluginConfig {
  /** Path to the praxis CLI binary. */
  cliPath: string;
  /** Default plan file path relative to repo root. */
  defaultPlanPath: string;
  /** Whether to auto-verify on session stop. */
  autoVerifyOnStop: boolean;
  /** Whether to capture pre-tool events. */
  capturePreTool: boolean;
  /** Whether to capture post-tool events. */
  capturePostTool: boolean;
  /** Maximum diff size to capture in bytes (default 1MB). */
  maxDiffBytes: number;
  /** Evidence ledger directory relative to repo root. */
  evidenceDir: string;
  /** Run ID prefix. */
  runIdPrefix: string;
  /**
   * Enforcement mode for pre-tool scope checking.
   * - 'advisory' (default): violations are logged but never block the tool.
   * - 'blocking': scope violations cause the tool call to be rejected.
   */
  enforcementMode: 'advisory' | 'blocking';
}

/** Default plugin configuration. */
const DEFAULT_CONFIG: PluginConfig = {
  cliPath: 'praxis',
  defaultPlanPath: '.praxis/plan.yaml',
  autoVerifyOnStop: false,
  capturePreTool: true,
  capturePostTool: true,
  maxDiffBytes: 1024 * 1024, // 1MB
  evidenceDir: '.praxis/runs',
  runIdPrefix: 'plugin-run',
  enforcementMode: 'advisory',
};

/**
 * Read plugin configuration from a JSON or YAML config file.
 * Falls back to defaults for any missing fields.
 */
export function readPluginConfig(repoRoot: string): PluginConfig {
  const configPaths = [
    resolve(repoRoot, '.praxis/plugin.json'),
    resolve(repoRoot, '.praxis/plugin.yaml'),
    resolve(repoRoot, 'praxis-plugin.json'),
  ];

  for (const cfgPath of configPaths) {
    if (!existsSync(cfgPath)) continue;

    try {
      const raw = readFileSync(cfgPath, 'utf-8');

      if (cfgPath.endsWith('.json')) {
        const parsed = JSON.parse(raw) as Partial<PluginConfig>;
        return { ...DEFAULT_CONFIG, ...parsed };
      }

      // YAML config — simple top-level key: value parsing only
      // (full YAML parsing would pull in the yaml dependency; we keep it light)
      if (cfgPath.endsWith('.yaml')) {
        const overrides: Partial<PluginConfig> = {};
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const colonIdx = trimmed.indexOf(':');
          if (colonIdx === -1) continue;
          const key = trimmed.slice(0, colonIdx).trim();
          let value: string = trimmed.slice(colonIdx + 1).trim();

          // Strip quotes
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          switch (key) {
            case 'cliPath': (overrides as Record<string, string>).cliPath = value; break;
            case 'defaultPlanPath': (overrides as Record<string, string>).defaultPlanPath = value; break;
            case 'autoVerifyOnStop': overrides.autoVerifyOnStop = value === 'true'; break;
            case 'capturePreTool': overrides.capturePreTool = value === 'true'; break;
            case 'capturePostTool': overrides.capturePostTool = value === 'true'; break;
            case 'maxDiffBytes': overrides.maxDiffBytes = parseInt(value, 10) || DEFAULT_CONFIG.maxDiffBytes; break;
            case 'evidenceDir': (overrides as Record<string, string>).evidenceDir = value; break;
            case 'runIdPrefix': (overrides as Record<string, string>).runIdPrefix = value; break;
            case 'enforcementMode':
              if (value === 'blocking' || value === 'advisory') {
                overrides.enforcementMode = value;
              }
              break;
          }
        }
        return { ...DEFAULT_CONFIG, ...overrides };
      }
    } catch {
      // Ignore parse errors; fall through to defaults
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Validate that the configured CLI path is executable.
 * Returns null on success, or an error message.
 */
export function validateCliPath(cliPath: string): string | null {
  // Simple validation: check that the binary name looks reasonable
  if (!cliPath || cliPath.trim().length === 0) {
    return 'CLI path is empty';
  }
  if (cliPath.includes(';') || cliPath.includes('&&') || cliPath.includes('|')) {
    return 'CLI path contains shell metacharacters (unsafe)';
  }
  return null;
}
