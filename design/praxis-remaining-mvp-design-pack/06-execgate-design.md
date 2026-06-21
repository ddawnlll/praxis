# ExecGate v0.1 Design

> This document defines ExecGate — the fifth gate in the PRAXIS Truth Kernel pipeline. ExecGate runs declared commands (tests, typechecks, builds, probes) with strict safety controls and captures their output as evidence.

## Purpose

ExecGate answers: **"Did the declared commands actually run, did they complete within bounds, and what were their results?"**

It ensures that:
- Only pre-declared `exactAllowedCommands` are executed
- `hardDeniedCommands` are blocked before execution
- Commands run with proper timeout enforcement
- stdout/stderr/exit codes are captured as evidence
- Watch mode, infinite loops, and unsafe commands are prevented
- Test results are validated (no tests found = failure when configured)

## Position in Pipeline

```
SchemaGate → LockGate → EvidenceGate → WiringGate → [ExecGate] → FinalGate
                                                     ↑ we are here (P5)
```

ExecGate runs AFTER WiringGate confirms artifact structure, but BEFORE FinalGate evaluates acceptance criteria. This ensures we only run commands against properly wired code.

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| `plan.commands` | PlanSpec | Exact allowed commands + denied commands + validation rules |
| `task.acceptanceCriteria` | PlanSpec | Criteria that may reference commands via `commandRef` |
| `repoRoot` | KernelContext | Repository root for CWD resolution |
| `attemptId` | CLI/runtime | Current attempt for evidence linkage |

## Core Safety Model

### Command Categories

```
exactAllowedCommands[].kind:
  - final_validation   → Primary validation command (required for PASS)
  - targeted_test      → Specific test suite
  - typecheck          → TypeScript/type checking
  - lint               → Linting
  - build              → Build/compile
  - runtime_probe      → Runtime probe (deferred to v0.2)
  - discovery          → Informational only (cannot satisfy FinalGate)
```

### The Golden Rule

**Only commands in `plan.commands.exactAllowedCommands` may be executed.**  
Any command execution request not in this list is rejected before any process is spawned.

## Core Checks

### Check 1: Command Validation (Pre-Execution)

```
FOR EACH command requested for execution:
  
  // Is it in the allowed list?
  IF command NOT IN plan.commands.exactAllowedCommands:
    → FAIL (COMMAND_NOT_ALLOWED, command.id or command string)
    → "Command not in exactAllowedCommands"
  
  // Is it denied?
  FOR EACH deniedCommand IN plan.commands.hardDeniedCommands:
    IF command.command matches deniedCommand.pattern OR command.command === deniedCommand.command:
      → FAIL (COMMAND_DENIED, deniedCommand.id)
      → "Command is hard-denied: ${deniedCommand.reason}"
  
  // Is it a discovery command trying to do final validation?
  IF command.kind === 'discovery' AND discoveryCommandsMayNotSatisfyFinalValidation:
    → Note: command may execute but its output will not satisfy FinalGate
    → INFO (DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL)
```

### Check 2: Command Execution

```
FOR EACH validated command:
  
  // Spawn process
  child_process.spawn(command.command, {
    cwd: command.cwd ?? repoRoot,
    shell: command.shellAllowed ?? false,
    timeout: command.timeoutSeconds * 1000,
    env: { ...process.env, ...command.env },
  })
  
  // Capture output
  stdout = ''
  stderr = ''
  child.stdout.on('data', chunk => stdout += chunk)
  child.stderr.on('data', chunk => stderr += chunk)
  
  // Wait for completion or timeout
  const { exitCode, signal, timedOut } = await wait(child, timeout)
```

### Check 3: Timeout Enforcement

```
IF command.timeoutSeconds is set AND command.timeoutSeconds > 0:
  timeoutMs = command.timeoutSeconds * 1000
  
  // Timer
  setTimeout(() => {
    IF child is still running:
      child.kill('SIGTERM')
      setTimeout(() => {
        IF child is still running:
          child.kill('SIGKILL')
      }, 5000)  // Grace period after SIGTERM
  }, timeoutMs)
  
  IF timedOut:
    → FAIL (COMMAND_TIMEOUT, command.id)
    → "Command exceeded timeout of ${command.timeoutSeconds}s"
```

**Safety:** Default timeout enforced even when `timeoutSeconds` is not set:
- Default timeout: 300 seconds (5 minutes)
- PlanSpec `maxRepairLoops` bound: 10 maximum repair loops
- Infinite loops are prevented by timeout enforcement

### Check 4: Watch Mode Prevention

```
IF command.watchModeForbidden === true:
  // Validate that command does not contain watch-related flags
  const watchPatterns = [/--watch/, /--noEmit\/?--watch/, /-w\b/, /nodemon/, /chokidar/]
  
  IF watchPatterns.some(p => p.test(command.command)):
    → FAIL (WATCH_MODE_DETECTED, command.id)
    → "Watch mode is forbidden for this command"
  
  // Run command with a short initial timeout to detect watch processes
  // If process runs longer than 10s without producing output, it may be watching
  const outputTimeout = setTimeout(() => {
    IF no output produced yet AND process still running:
      → HOLD (POSSIBLE_WATCH_MODE, command.id)
      kill process
  }, 10000)
```

### Check 5: NoTestsFoundIsFailure

```
IF command.noTestsFoundIsFailure === true:
  // Parse test output for "no tests found" patterns
  const noTestsPatterns = [
    /no tests? (found|ran|executed)/i,
    /No test files/i,
    /0 tests/i,
    /tests? suite? did not run/i,
    /no test files found/i,
    /test.*empty/i,
  ]
  
  IF any pattern matches stdout or stderr:
    → HOLD (NO_TESTS_FOUND, command.id)
    → "No tests found but noTestsFoundIsFailure is true"
```

### Check 6: Expected Exit Code

```
IF command.expectedExitCode is defined AND exitCode !== command.expectedExitCode:
  → HOLD (UNEXPECTED_EXIT_CODE, command.id)
  → "Expected exit code ${expectedExitCode}, got ${exitCode}"
  IF exitCode !== 0 AND command.expectedExitCode === 0:
    → Additional: HOLD (EXIT_CODE_NONZERO, command.id)
```

### Check 7: Expected Output Patterns

```
IF command.expectedOutputPatterns is non-empty:
  FOR EACH pattern IN command.expectedOutputPatterns:
    IF pattern NOT matched in stdout + stderr:
      → HOLD (EXPECTED_OUTPUT_MISSING, command.id, pattern)
```

### Check 8: Evidence Capture

```
FOR EACH executed command:
  // Create evidence records
  const startRecord = {
    evidence_id: `evt-${nanoid()}`,
    attempt_id: attemptId,
    kind: 'command_start',
    source: 'command_runner',
    content_hash: sha256(JSON.stringify({ command, cwd, timeout })),
    timestamp: startTime.toISOString(),
    metadata: { command: command.command, commandId: command.id, cwd: command.cwd },
  }
  
  const outputRecord = {
    evidence_id: `evt-${nanoid()}`,
    attempt_id: attemptId,
    kind: 'command_output',
    source: 'command_runner',
    content_hash: sha256(stdout + stderr),
    content_ref: `command-output/${command.id}.txt`,
    timestamp: endTime.toISOString(),
    metadata: { exitCode, durationMs, timedOut, signal },
  }
  
  // Persist evidence
  appendToLedger(evidenceLedgerPath, startRecord)
  appendToLedger(evidenceLedgerPath, outputRecord)
  writeContent(contentDir, `command-output/${command.id}.txt`, stdout + stderr)
```

## Outputs

### ExecGateResult

```
interface ExecGateResult {
  gateName: 'ExecGate'
  verdict: 'PASS' | 'HOLD' | 'FAIL'
  reasonCodes: string[]
  diagnostics: Diagnostic[]
  failedCriteriaIds: string[]
  evidenceRefs: string[]    // References to command_output records
  repairHint?: string
  
  contextUpdates: {
    commandResults: CommandResult[]  // per-command results
    testResults: TestResult[]         // aggregated test results
    totalTestsRun: number
    totalTestsPassed: number
    totalTestsFailed: number
  }
  
  timestamp: string
  attemptId: string
}

interface CommandResult {
  commandId: string
  command: string
  verdict: 'PASS' | 'HOLD' | 'FAIL'
  exitCode: number
  timedOut: boolean
  durationMs: number
  stdoutTruncated: string   // First 10KB for display
  evidenceRef: string        // Link to full output
  reasonCodes: string[]
}
```

## Reason Codes

| Code | Verdict | Condition |
|------|---------|-----------|
| `EXEC_PASS` | PASS | All commands pass |
| `COMMAND_NOT_ALLOWED` | FAIL | Command not in exactAllowedCommands |
| `COMMAND_DENIED` | FAIL | Command matches hardDeniedCommands |
| `COMMAND_TIMEOUT` | FAIL | Command exceeded timeout |
| `WATCH_MODE_DETECTED` | FAIL | Watch mode flag detected |
| `POSSIBLE_WATCH_MODE` | HOLD | Process may be in watch mode |
| `NO_TESTS_FOUND` | HOLD | No tests but noTestsFoundIsFailure |
| `UNEXPECTED_EXIT_CODE` | HOLD | Exit code != expected |
| `EXIT_CODE_NONZERO` | HOLD | Non-zero exit code |
| `EXPECTED_OUTPUT_MISSING` | HOLD | Expected output pattern not found |
| `COMMAND_CRASHED` | FAIL | Process crashed with signal |
| `DISCOVERY_COMMAND_CANNOT_SATISFY_FINAL` | INFO | Discovery-only command |
| `COMMAND_SUCCEEDED` | PASS | Single command success |

## Verdict Ladder

```
All commands pass, no tests fail, no timeout    → PASS
Some tests fail, nonzero exit                    → HOLD
No tests found (with noTestsFoundIsFailure)      → HOLD
Expected output pattern missing                  → HOLD
Possible watch mode                              → HOLD
Command not in allowed list                      → FAIL
Hard-denied command                              → FAIL
Command timeout                                  → FAIL
Watch mode confirmed                             → FAIL
Command crashed (signal)                         → FAIL
```

## Command Spoofing Prevention

To prevent command spoofing (where a malicious agent claims to have run a command but actually ran something different):

### Method 1: Exact Command Matching

ExecGate compares the requested command string against `exactAllowedCommands[].command` using **exact match**, not substring match. `"bun test"` does not match `"bun test --coverage"` unless `--coverage` is part of the declared command.

```
"bun test"                    → matches only "bun test"
"bun test --coverage"         → matches only "bun test --coverage"
"bun test && rm -rf /"        → does NOT match "bun test" (FAIL: COMMAND_NOT_ALLOWED)
```

### Method 2: Shell Safety

```
IF command.shellAllowed === false OR undefined:
  // Use process.spawn with command splitting, NOT shell
  // This prevents shell injection
  spawn(command.command, [], { shell: false })
  
IF command.shellAllowed === true:
  // Use shell explicitly — only for commands requiring pipes, globs, etc.
  spawn(command.command, [], { shell: true })
```

**Default:** `shellAllowed: false` — commands are executed directly, not through a shell.

### Method 3: Network Control

```
IF command.networkAllowed === false OR undefined:
  // Set NODE_OPTIONS=--experimental-vm-modules or similar restrictions
  // In v0.1, this is advisory — full network sandboxing is complex
  // Documented limitation: network blocking is best-effort in v0.1
```

## HOLD vs FAIL Semantics

| Verdict | Meaning | Recovery |
|---------|---------|----------|
| PASS | All commands ran successfully within bounds | Proceed to FinalGate |
| HOLD | Commands ran but some failed or had unexpected results | Repair: fix code, fix tests, or adjust command config |
| FAIL | Command integrity violated (not allowed, denied, timeout) | Human review: potential safety issue |

FAIL means "the execution environment was unsafe or violated."  
HOLD means "execution happened but results were unsatisfactory."

## Environment Safety

```
ExecGate runs commands in a restricted environment:
  - CWD: repoRoot or command.cwd (subdirectory of repoRoot only)
  - PATH: inherited from parent process (can be overridden per command)
  - Network: controlled per command.networkAllowed
  - Shell: disabled by default, enabled per command.shellAllowed
  - Timeout: mandatory, enforced, no unbounded execution
  - Environment variables: inherited, can be overridden per command
  
Restrictions:
  - CWD MUST be within repoRoot (checked before execution)
  - No interactive terminal (stdio piped, not TTY)
  - No display/GUI (DISPLAY unset, no X11 forwarding)
  - No elevated privileges (runs as same user)
```

## Example Scenarios

| Scenario | Result |
|----------|--------|
| `bun test` declared, runs, 42/42 tests pass | PASS |
| `bun test` declared, runs, 40/42 pass, exit 1 | HOLD |
| `bun test` not declared, agent tries to run it | FAIL |
| `rm -rf /` matches hardDeniedCommands | FAIL |
| `bun test --watch` with watchModeForbidden=true | FAIL |
| `bun test` runs for 600s but timeoutSeconds=120 | FAIL |
| `bun test` with noTestsFoundIsFailure=true, 0 tests | HOLD |
| `bun run build` with expectedExitCode=0, gets 1 | HOLD |
| `my-tool --output something` stdout contains expected pattern | PASS |
| Typecheck command runs with no errors | PASS |

## Implementation Guidance

### File Structure

```
packages/kernel/src/
  gates/
    execGate.ts               ← Main gate logic
  executor/
    commandRunner.ts          ← Process spawning + timeout
    commandValidator.ts       ← Allowed/denied command checking
    testOutputParser.ts       ← Test output analysis
    evidenceCapture.ts        ← stdout/stderr evidence recording
    commandSafety.ts          ← Shell/network/timeout safety
```

### Key Constraints

1. ExecGate MUST NOT execute any command not in `exactAllowedCommands`
2. ExecGate MUST enforce timeout on every command
3. ExecGate MUST capture stdout/stderr as evidence
4. ExecGate MUST NOT execute commands that match `hardDeniedCommands`
5. ExecGate MUST NOT allow interactive or TTY commands
6. ExecGate MUST NOT run with elevated privileges
7. ExecGate MUST handle process crashes gracefully (signal → FAIL, not exception)
8. ExecGate MUST NOT modify the plan or acceptance criteria
9. ExecGate MUST produce at least one evidence record per executed command
10. ExecGate SHOULD limit stdout capture to 10MB per command (prevent memory exhaustion)
