# Claude Code Plugin Bridge Design

> This document defines the Claude Code plugin bridge for PRAXIS v0.1 MVP. The plugin bridge is how Claude Code interacts with the PRAXIS Truth Kernel during an agent session.

## Design Principle

**The plugin is a read-only display + slash command dispatcher.** It NEVER:
- Decides truth (Law 1 violation)
- Modifies acceptance criteria (Law 3 violation)
- Overrides gate verdicts
- Executes gate logic
- Writes to the evidence store directly

The plugin displays what the kernel decided. Nothing more.

## Architecture

```
Claude Code Session
    │
    ├── /praxis slash commands
    │       │
    │       ▼
    │   Claude Code Plugin Handler
    │       │  (regex matches /praxis <command>)
    │       │
    │       ▼
    │   child_process.exec("praxis <args>")
    │       │
    │       ▼
    │   praxis CLI (separate process)
    │       │  delegates to @praxis/kernel
    │       │  returns results
    │       │
    │       ▼
    │   Plugin Handler
    │       │  formats result for Claude Code
    │       │  NEVER modifies result data
    │       │
    │       ▼
    │   Response to Claude
    │
    └── praxis-hook (PreToolUse / PostToolUse)
            │  captures tool events
            │  POSTs to evidence ledger
            │  NEVER evaluates or judges
            │
            ▼
        .praxis/runs/<id>/evidence.jsonl
```

## Slash Commands

### Command Table

| Command | Args | What It Does | Display |
|---------|------|-------------|---------|
| `/praxis init` | `[--plan <path>]` | Initialize PRAXIS in current repo | Initialization result |
| `/praxis plan validate` | `<path>` | Validate plan schema | PASS/FAIL with diagnostics |
| `/praxis plan lock` | `<path>` | Lock the plan | Lock created/verified |
| `/praxis verify` | `[--plan <path>]` | Run full verification pipeline | Per-gate results + overall verdict |
| `/praxis status` | `[--run-id <id>]` | Show verification status | Current state summary |
| `/praxis report` | `[--run-id <id>]` | Show last report | Report summary |
| `/praxis ledger` | `[--kind <k>]` `[--limit <n>]` | Show evidence records | Evidence record table |
| `/praxis repair show` | `[--run-id <id>]` | Show repair packet | Failed gates + strategy |
| `/praxis help` | — | Show available commands | Command list |

### Command Handler Interface

```typescript
interface SlashCommandHandler {
  command: string           // e.g. "verify"
  description: string       // Human-readable help text
  args: ArgDefinition[]     // Argument definitions
  execute(args: ParsedArgs): Promise<CommandResult>
}

interface CommandResult {
  success: boolean
  message: string           // Formatted display text
  data?: object             // Structured data (for machine use)
  exitCode: number          // 0 = PASS, 1 = HOLD, 2 = FAIL, 3+ = error
}
```

## Hook Integration

### PreToolUse Hook

Before Claude Code executes a tool:

```
Event: PreToolUse
  1. praxis-hook captures: tool name, inputs, timestamp
  2. Creates evidence record: kind='session_start', source='kernel_hook'
  3. Appends to .praxis/runs/<current-run-id>/evidence.jsonl
  4. Does NOT block or modify the tool call
```

### PostToolUse Hook

After Claude Code completes a tool:

```
Event: PostToolUse
  1. praxis-hook captures: tool output, exit code, duration
  2. For Write/Edit tools: captures git diff snapshot
  3. Creates evidence records:
     - kind='post_tool', source='kernel_hook' (tool metadata)
     - kind='diff', source='git' (if files changed)
     - kind='file_change', source='filesystem' (if files changed)
  4. Appends to evidence.jsonl
  5. Does NOT evaluate, judge, or block
```

### Stop Hook

When Claude Code stops (session end):

```
Event: Stop
  1. praxis-hook captures: final state, summary
  2. Creates evidence record: kind='session_end', source='kernel_hook'
  3. Finalizes evidence ledger (closes file handles)
  4. Optionally triggers praxis verify (configurable)
```

## Display Format

### Verify Result Display (in Claude Code)

```
/praxis verify

──────────────────────────────────────────
  PRAXIS Verify — plan-20260620-001
  Run: run-001 | Attempt: 1
──────────────────────────────────────────

  SchemaGate:   ✅ PASS
  LockGate:     ✅ PASS
  EvidenceGate: ✅ PASS (42 evidence records)
  WiringGate:   ✅ PASS (7 units verified)
  ExecGate:     ⚠️ HOLD (2/3 commands passed)
  FinalGate:    ⚠️ HOLD (4/5 criteria passed)

  Overall: HOLD
  Repair: RepairPacket generated (strategy: initial)

  Next: Review criteria failures and retry with /praxis verify --attempt 2
──────────────────────────────────────────
```

### Status Display

```
/praxis status

──────────────────────────────────────────
  Plan: my-plan.yaml
  Lock: ✅ LOCKED (plan-20260620-001)
  Last Run: run-001 (attempt 1)
  Verdict: HOLD
  
  Runs:
  ├── run-001  HOLD  2026-06-20T10:00:00Z  (current)
  └── (no prior runs)
──────────────────────────────────────────
```

## Safety Boundaries

### MUST Implement

| Rule | Reason |
|------|--------|
| Plugin delegates all gate operations to CLI | Prevents plugin logic errors from producing false PASS |
| Plugin displays kernel output as-is | Prevents display-layer data transformation from hiding failures |
| Plugin captures hooks as raw evidence | Hook layer never judges — captures raw events |
| Plugin respects .praxis/config.yaml display settings | User controls verbosity, not plugin |
| Plugin errors are reported to user, not swallowed | Transparent error communication |

### MUST NOT Implement

| Rule | Reason |
|------|--------|
| Plugin MUST NOT produce GateVerdicts | Law 1: Only Truth Kernel produces verdicts |
| Plugin MUST NOT modify .praxis/ files directly (except evidence append) | Only CLI and hooks write to .praxis/ |
| Plugin MUST NOT skip gates in pipeline | All gates always run in order |
| Plugin MUST NOT override HOLD/FAIL verdicts | Plugin displays, never overrides |
| Plugin MUST NOT modify PlanSpec or acceptance criteria | Law 3: Only human-authored criteria count |
| Plugin MUST NOT execute commands outside exactAllowedCommands | Command safety |
| Plugin MUST NOT cache verdicts across sessions | Each run is independent |

## Claude Code Integration Points

### In-Session Integration

```yaml
# .claude/settings.json (in repo)
{
  "plugins": {
    "praxis": {
      "slash_commands": true,
      "hooks": {
        "preToolUse": true,
        "postToolUse": true,
        "stop": true
      },
      "auto_verify_on_stop": true,
      "evidence_dir": ".praxis/runs"
    }
  }
}
```

### Settings Per Command

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `slash_commands` | boolean | true | Enable /praxis slash commands |
| `hooks.preToolUse` | boolean | true | Capture pre-tool events |
| `hooks.postToolUse` | boolean | true | Capture post-tool events |
| `hooks.stop` | boolean | true | Capture stop events |
| `auto_verify_on_stop` | boolean | false | Run verify pipeline when Claude stops |
| `evidence_dir` | string | ".praxis/runs" | Where to store evidence |
| `display_compact` | boolean | false | Compact display mode |

## Implementation Guidance

### File Structure

```
packages/claude-plugin/           ← NOT created yet (P6)
  src/
    index.ts                      ← Plugin entry point
    slashCommands.ts              ← /praxis command handler
    hooks/
      preToolUse.ts               ← PreToolUse hook handler
      postToolUse.ts              ← PostToolUse hook handler
      stopHandler.ts              ← Stop hook handler
    display/
      formatVerdict.ts            ← Verdict display formatting
      formatLedger.ts             ← Evidence display formatting
      formatReport.ts             ← Report display formatting
    config.ts                     ← Plugin configuration reader
```

### Key Interfaces

```typescript
// Plugin entry point
export function createPraxisPlugin(config: PraxisPluginConfig): ClaudeCodePlugin

interface ClaudeCodePlugin {
  name: 'praxis'
  slashCommands: SlashCommandHandler[]
  hooks: {
    preToolUse?: (event: ToolUseEvent) => Promise<void>
    postToolUse?: (event: ToolUseResult) => Promise<void>
    stop?: () => Promise<void>
  }
}
```

### Interaction Pattern (Agent Side)

When Claude Code is running with the PRAXIS plugin:

1. **Start of session:** Agent plans work. User may run `/praxis plan validate` to confirm plan is valid.
2. **During session:** Hooks passively capture evidence. Agent works normally.
3. **Agent claims done:** User runs `/praxis verify` to check completion.
4. **If HOLD:** User sees what's missing. May ask agent to fix it.
5. **If FAIL:** Human review needed. Agent can't fix safety violations.
6. **If PASS:** Task complete. Report generated.
7. **Loop:** For HOLD, user runs `/praxis repair show` to see what failed, then `/praxis verify --attempt 2` after fixes.

### Example Agent Session

```
Human: Claude, implement the auth module per plan.yaml.

Agent: I'll start implementing the auth module.
  [writes files, hooks capture evidence]

Agent: Done. I've created the auth module with login/logout/register endpoints.

Human: /praxis verify
  → EvidenceGate: PASS (diff found, namespace clean)
  → WiringGate: PASS (all declared units exist)
  → ExecGate: HOLD (2/5 tests fail)
  → FinalGate: HOLD (1 criterion not met: AC-002)
  → Overall: HOLD

Human: Claude, AC-002 fails because some tests don't pass. Can you fix them?

Agent: Let me look at the failing tests and fix them.
  [fixes tests, hooks capture evidence]

Human: /praxis verify --attempt 2
  → All gates PASS
  → Overall: PASS
```

## Design Decisions

| Decision | Answer | Rationale |
|----------|--------|-----------|
| Plugin or standalone CLI? | Both. CLI is primary. Plugin is convenience layer. | Plugin depends on CLI being installed. |
| Hooks synchronous or async? | Async (fire-and-forget) | Sync hooks would slow Claude Code's tool execution |
| Auto-verify on stop? | Configurable, default off | Some sessions are exploratory — auto-verify would produce spurious HOLD |
| Plugin modifies agent behavior? | No | Plugin is passive observer. It does not inject instructions into agent prompts. |
