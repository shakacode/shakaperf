# Unversioned Bisect Session Design

## Goal

Keep one canonical persisted compare-bisect session shape. Remove session V1 handling,
the `BisectSessionV2` type, and compatibility fields that duplicate canonical state.

## Session contract

`BisectSession` becomes the current resumable session structure and has no `version`
field. Canonical search data lives in `primary`; the session no longer persists the
legacy top-level copies of `goodSha`, `badSha`, `commitSubjects`,
`selectedCategories`, `orderedCommits`, and `targets`. The current checkpoint map
`commitRuns` remains explicit persisted state because resume and report generation
consume it. Dry-run options and the planned next action remain runtime/output data,
not persisted session fields.

Existing versioned session files are intentionally rejected by strict schema
validation. There is no migration, special V1 error, or fallback materialization.

## Runtime and reporting

The bisect engine reads and updates targets through `session.primary`. Search-only
helpers consume a dedicated derived search input instead of pretending that the
flat search shape is a persisted session. Ephemeral run state that is not part of
the persisted contract stays local to execution rather than being copied onto the
session. Report generation derives its range, commits, targets, and categories from
`primary`, so report-only and live reports consume the same canonical session object.

## Validation

Tests will first establish that an unversioned current session parses and that
versioned or legacy-shaped sessions fail strict validation. Existing state,
resume, report-only, report-model, persistence, and session tests will be updated
to build the canonical shape. Focused Jest tests, TypeScript validation, and the
repository validation command will verify the refactor.
