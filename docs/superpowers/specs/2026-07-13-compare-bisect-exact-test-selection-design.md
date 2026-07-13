# Compare Bisect Exact AB-Test Selection Design

## Goal

Narrow good-ref and midpoint compare runs to the exact AB tests needed by active regression targets, while leaving initial bad-ref discovery, per-category scheduling, cached observations, and target-specific intervals unchanged.

## Selection Contract

Introduce one serializable selection shape:

```ts
export interface BisectTestSelection {
  testFile: string;
  testName: string;
}
```

Candidate work, dry-run `nextAction`, compare-run requests, commit-run records, decision-log entries, and terminal previews use `tests: BisectTestSelection[]` instead of file-only selections. Each requested test is identified by the pair `(testFile, testName)`. Selections are deduplicated by that full pair, so multiple targets for one AB test schedule it once, distinct tests in one file remain distinct, and equal test names in different files do not collide.

New session output records exact selections. Legacy file-only fields remain optional only where useful for interpreting older diagnostic JSON; new writes do not populate them. The session format remains diagnostic rather than resumable, so compatibility does not require translating an old file-only selection into an exact selection.

## Scheduling and Data Flow

Initial bad-ref discovery passes `tests: []`. At this one call site, an empty selection retains the existing meaning: run every frozen test already admitted by the CLI filters. Reused bad-ref results remain unchanged.

Good-ref validation derives `tests` from all active targets. Midpoint work derives `tests` from exactly the active targets selected for that candidate SHA. Category selection remains the independent union of those targets' categories.

The scheduler continues to:

1. Reapply cached observations.
2. Select the next target by category priority and stable ID.
3. Choose that target's midpoint.
4. Batch active, unobserved targets whose intervals include the midpoint.
5. Apply each resulting observation only to its own target interval.

Only the test-selection projection changes; observation caching and interval updates do not.

## Frozen-Test Filtering

The compare runner filters the invocation-time frozen `AbTestDefinition[]`. For each definition with a source file, it computes the normalized relative path from the invocation working directory and matches both:

```text
normalized relative test.file === selection.testFile
test.name === selection.testName
```

Path comparison normalizes separators and relative path syntax consistently on both sides. A definition without a source file cannot satisfy a non-empty exact selection. An empty selection returns all frozen definitions and is used only for initial bad-ref discovery.

## Persisted Diagnostics and Preview Output

`CommitRun` records `requestedTests`. `BisectNextAction` records `tests`. Candidate-selection and good-ref-start decision events include `tests`. The dry-run terminal preview prints each exact selection as a file-and-test pair rather than listing only files.

Optional legacy properties such as `requestedTestFiles` and `testFiles` may remain on diagnostic types for older serialized state, but all new execution paths write exact-test properties. Summary persistence passes through the new `nextAction` shape unchanged.

## Testing Strategy

Use red-green TDD around the existing pure scheduler and session harness:

- Scheduler tests prove one selected test from a multi-test file, multiple selected tests from one file, and equal names in different files.
- Cached-observation and divergent-interval tests prove later candidates request a smaller exact-test subset without changing category or interval behavior.
- Session tests prove bad-ref discovery uses an empty selection, good-ref and midpoint requests use exact selections, dry-run `nextAction` records them, and commit-run and decision-log snapshots retain them.
- Frozen-test filtering tests prove matching uses normalized relative file path plus exact test name.
- Persistence and CLI tests prove the new state and preview are serializable and visible.

Verification is limited to focused unit tests and TypeScript typecheck. No real compare or bisect invocation is run.

## Documentation

Update the compare-bisect README algorithm and scheduler descriptions to say candidate runs narrow to categories and individual AB tests, not entire AB-test files.
