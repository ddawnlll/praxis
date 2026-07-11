# PRAXIS Schemas

This directory contains canonical JSON Schema definitions for PRAXIS.

## PlanSpec v5-alpha2 (current)

**File:** `planspec.v5alpha2.schema.json` (symlink → `../../planspec.json`)
**Version:** `5.0.0-alpha2`
**Profile:** `praxis-v5-alpha2`
**Kind:** `ImplementationPlan`
**JSON Schema Draft:** 2020-12

The v5-alpha2 schema is the active PRAXIS plan format. v0.1 is archived
in `archive/v0.1/` for historical reference and to keep prior plan files
(`issue-*.plan.yaml`) parsable during migration.

### Identity

| Field | Value |
|-------|-------|
| `planSpecVersion` | `"5.0.0-alpha2"` |
| `kind` | `"ImplementationPlan"` |

### Top-level required fields

`$schema`, `planSpecVersion`, `kind`, `metadata`, `compatibility`,
`intent`, `authority`, `enforcementRegistry`, `security`, `commands`,
`locking`, `brief`, `waves`, `workspaces`, `validation`, `evidence`,
`reports`.

## PlanSpec v0.1 (archived)

`archive/v0.1/planspec.v0.1.schema.yaml` — kept for parsing prior
plan files during migration. Not the active schema.

## Migration notes

When introducing a new v0.6.x plan file:
1. Use `planSpecVersion: "5.0.0-alpha2"` and `kind: "ImplementationPlan"`.
2. Mirror v0.1 acceptance criteria into the v5-alpha2 `validation` block
   per wave task.
3. Do not delete or rewrite historical v0.1 plan files; the archive
   keeps them reproducible.
