# PRAXIS / Pi Project

## First thing every session

Read `ai_summary.md` — it contains the project state, file map, recent changes, and active work. Use it to orient before any other action.

## After any change

Update `ai_summary.md` as follows:
- **File Map**: add new files, remove deleted ones, note purpose changes
- **Recent Changes**: append a log entry for what was done (date, files touched, summary)
- **Known Issues**: add or resolve entries as they arise
- **Active Work**: track what's in flight

`ai_summary.md` is how agents pass context between sessions. Keeping it accurate is critical.

## Project overview

PRAXIS v2.0 is a parallel runtime for autonomous AI coding execution. The Pi implementation lives in `pi/` — a monorepo with packages for the execution engine, cognitive OS (brain), web server, dashboard, and ACCP compiler.

## Key files

| Path | Purpose |
|------|---------|
| `README.md` | PRAXIS v2.0 architecture document |
| `architecture.md` | Architecture baseline / ADRs |
| `todo.md` | Project todo list |
| `ai_summary.md` | Project state — update on every change |
| `pi/` | Pi implementation monorepo |

## Development rules

See `pi/AGENTS.md` for detailed rules: commit format, code quality, parallel agent safety, testing requirements.
