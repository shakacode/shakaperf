# Compare Bisect Exact AB-Test Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make good-ref and midpoint compare runs select exact AB tests by normalized file path plus exact test name while preserving all-test bad-ref discovery and target-level bisect behavior.

**Architecture:** Add a shared serializable `BisectTestSelection` value type and carry `tests` through scheduler work, session actions, compare requests, persisted commit runs, decision events, and previews. Keep scheduling logic intact and change only the projection from selected targets to deduplicated `(testFile, testName)` pairs; the candidate runner filters the frozen definitions against those pairs.

**Tech Stack:** TypeScript strict mode, Jest, Yarn 4 workspaces, Node.js path utilities.

## Global Constraints

- Initial bad-ref discovery must continue to run all frozen tests allowed by CLI filters.
- Empty `tests` means all frozen tests only for initial bad-ref discovery.
- Good-ref and midpoint selections use both `target.testFile` and `target.testName`.
- Categories, cached observations, and target-specific intervals retain their existing behavior.
- New session diagnostics record exact test selections; legacy file-only properties may remain optional for older serialized diagnostics.
- Do not run a real compare or bisect invocation.
- Verification is limited to unit tests and TypeScript typecheck.
- Produce one focused implementation commit after the red-green cycles and verification.

---

### Task 1: Exact-Test Scheduler Contract

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/types.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/search.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/search.test.ts`

**Interfaces:**
- Produces: `BisectTestSelection { testFile: string; testName: string }`.
- Produces: `CandidateWork.tests: BisectTestSelection[]`.
- Preserves: `nextCandidate(session): CandidateWork | null` scheduling and cache semantics.

- [ ] **Step 1: Write failing scheduler tests**

Add target helpers that can assign an explicit file and name, then assert exact pair behavior:

```ts
expect(nextCandidate(normalized)?.tests).toEqual([
  { testFile: 'tests/account.abtest.ts', testName: 'Account overview' },
]);

expect(nextCandidate(normalized)?.tests).toEqual([
  { testFile: 'tests/account.abtest.ts', testName: 'Account overview' },
  { testFile: 'tests/account.abtest.ts', testName: 'Account settings' },
]);

expect(nextCandidate(normalized)?.tests).toEqual([
  { testFile: 'tests/account.abtest.ts', testName: 'Overview' },
  { testFile: 'tests/admin.abtest.ts', testName: 'Overview' },
]);
```

Extend the cached/divergent-target case so a later `nextCandidate` contains only the exact test whose interval remains active.

- [ ] **Step 2: Run scheduler tests and verify RED**

Run:

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/search.test.ts --runInBand
```

Expected: FAIL because `CandidateWork` still exposes `testFiles` and no `tests` property.

- [ ] **Step 3: Implement the selection type and scheduler projection**

Add:

```ts
export interface BisectTestSelection {
  testFile: string;
  testName: string;
}
```

Replace `CandidateWork.testFiles` with `tests`. Derive and deduplicate selections by the full pair, using a stable serialized key rather than either field alone:

```ts
function testsForTargets(targets: readonly BisectTarget[]): BisectTestSelection[] {
  const selections = new Map<string, BisectTestSelection>();
  for (const target of targets) {
    const selection = { testFile: target.testFile, testName: target.testName };
    selections.set(JSON.stringify([selection.testFile, selection.testName]), selection);
  }
  return [...selections.values()];
}
```

- [ ] **Step 4: Run scheduler tests and verify GREEN**

Run the Task 1 Jest command. Expected: PASS with category priority, cached observations, and interval tests still green.

### Task 2: Exact Selections Through Candidate Execution

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/types.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/run-candidate.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `BisectTestSelection` and `CandidateWork.tests` from Task 1.
- Produces: `CompareRunRequest.tests`, `RunCandidateOptions.tests`, `BisectNextAction.tests`, and `CommitRun.requestedTests`.
- Preserves legacy diagnostic properties as optional only: `BisectNextAction.testFiles?` and `CommitRun.requestedTestFiles?`.

- [ ] **Step 1: Write failing session tests for request and persisted data**

Change the harness to capture:

```ts
compares: Array<{
  sha: string;
  categories: string[];
  tests: Array<{ testFile: string; testName: string }>;
}>;
```

Add test results with two named tests in one file and assert:

```ts
expect(harness.calls.compares).toContainEqual({
  sha: 'a',
  categories: ['visreg'],
  tests: [{ testFile: 'tests/account.abtest.ts', testName: 'Account overview' }],
});
```

Assert dry-run state, commit-run checkpoints, and candidate decision data use exact selections:

```ts
expect(session.nextAction?.tests).toEqual([
  { testFile: 'tests/account.abtest.ts', testName: 'Account overview' },
]);
expect(session.commitRuns.a?.requestedTests).toEqual(session.nextAction?.tests);
expect(candidateDecision?.data?.tests).toEqual(session.nextAction?.tests);
```

Assert bad-ref discovery is the only compare call with `tests: []`.

- [ ] **Step 2: Run session tests and verify RED**

Run:

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__/session.test.ts --runInBand
```

Expected: FAIL because compare requests, commit runs, next actions, and decision data still use file-only fields.

- [ ] **Step 3: Carry exact selections through runtime state**

Update the runtime interfaces and construction sites:

```ts
export interface CompareRunRequest {
  sha: string;
  categories: readonly BisectCategory[];
  tests: readonly BisectTestSelection[];
}

export interface CommitRun {
  requestedTests: BisectTestSelection[];
  requestedTestFiles?: string[];
}
```

Use a shared `testsForTargets()` helper for good-ref validation and dry-run planning. Pass `work.tests` for candidates. Record `tests` in `good-ref-start` and `candidate-selected` decision data. Bad-ref measure/reuse records `requestedTests: []`.

- [ ] **Step 4: Implement exact frozen-definition filtering**

Change `runCompareForCandidate` and the filter to consume exact selections:

```ts
function filterFrozenTests(
  tests: readonly AbTestDefinition[],
  cwd: string,
  selections: readonly BisectTestSelection[],
): AbTestDefinition[] {
  if (selections.length === 0) return [...tests];
  const wanted = new Set(selections.map(testSelectionKey));
  return tests.filter((test) => test.file !== null && wanted.has(testSelectionKey({
    testFile: normalizeRelativeTestFile(cwd, test.file),
    testName: test.name,
  })));
}
```

Normalize both selected and loaded paths with `path.normalize`, convert platform separators to `/`, and remove redundant leading `./` syntax before pairing with the exact name.

- [ ] **Step 5: Run session tests and verify GREEN**

Run the Task 2 Jest command. Expected: PASS, including all-test bad-ref discovery and exact-test good/midpoint runs.

### Task 3: Persistence and Terminal Preview

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/cli.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`

**Interfaces:**
- Consumes: `BisectNextAction.tests` and `CommitRun.requestedTests` from Task 2.
- Produces: JSON summaries and terminal preview containing exact file/name pairs.

- [ ] **Step 1: Write failing persistence and CLI tests**

Change the persisted action fixture to:

```ts
tests: [{ testFile: 'tests/checkout.abtest.ts', testName: 'Checkout' }]
```

Change the CLI preview assertion to an unambiguous exact pair, for example:

```ts
'Tests: tests/homepage.abtest.ts :: Homepage'
```

- [ ] **Step 2: Run persistence and CLI tests and verify RED**

Run:

```bash
yarn workspace shaka-perf jest \
  src/compare/bisect/__tests__/persistence.test.ts \
  src/compare/bisect/__tests__/cli.test.ts \
  --runInBand
```

Expected: FAIL while the terminal still reads `nextAction.testFiles`.

- [ ] **Step 3: Update the preview output**

Render exact selections without collapsing equal names or same-file tests:

```ts
console.log(`Tests: ${session.nextAction.tests
  .map((test) => `${test.testFile} :: ${test.testName}`)
  .join(', ')}`);
```

Leave summary persistence as a pass-through of `nextAction`, which now serializes `tests`.

- [ ] **Step 4: Run persistence and CLI tests and verify GREEN**

Run the Task 3 Jest command. Expected: PASS.

### Task 4: Documentation, Compatibility Audit, and Verification

**Files:**
- Modify: `packages/shaka-perf/README-compare-bisect.md`
- Modify: any bisect tests still constructing legacy file-only runtime state
- Include: `docs/superpowers/plans/2026-07-13-compare-bisect-exact-test-selection.md`

**Interfaces:**
- Documents: candidate batching by categories and individual AB tests.
- Verifies: no new execution path writes file-only selections.

- [ ] **Step 1: Update user documentation**

Replace algorithm language such as “test files” and “AB-test files” with “individual AB tests.” Explain that a candidate batch deduplicates exact `(test file, test name)` pairs.

- [ ] **Step 2: Audit file-only fields**

Run:

```bash
rg -n "testFiles|requestedTestFiles|Test files" packages/shaka-perf/src/compare/bisect packages/shaka-perf/README-compare-bisect.md
```

Expected: only explicitly optional legacy diagnostic declarations or compatibility tests remain; no new-session write path uses them.

- [ ] **Step 3: Run all bisect unit tests**

Run:

```bash
yarn workspace shaka-perf jest src/compare/bisect/__tests__ --runInBand
```

Expected: all bisect suites pass with zero failures.

- [ ] **Step 4: Run package typecheck**

Run:

```bash
yarn workspace shaka-perf typecheck
```

Expected: exit 0.

- [ ] **Step 5: Verify diff scope and requirements**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD
```

Confirm each of the seven requested cases has a direct test and that no real compare/bisect command was invoked.

- [ ] **Step 6: Create the focused implementation commit**

Stage only the exact-selection implementation, tests, README, and this plan, then commit:

```bash
git commit -m "feat(compare): narrow bisect runs to exact tests"
```
