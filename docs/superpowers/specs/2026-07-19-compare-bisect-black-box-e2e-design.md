# Compare Bisect Black-Box Jest E2E Design

## Summary

Add a Jest end-to-end suite around the public `runBisect(...)` API. Each test
creates a real temporary Git repository, clones it into separate control and
experiment checkouts, seeds a deterministic linear or merge history, and lets
the production bisect implementation discover and traverse that history.

The only fabricated domain input is the compare outcome for each immutable
commit SHA. The test harness returns deterministic `TestResult[]` for the SHA
requested by `runBisect(...)`; it does not mock the scheduler, Git range
discovery, first-parent traversal, merge investigation, checkout restoration,
or persisted session state.

## Scope

### Goals

- Exercise `runBisect(...)` as a black box with real control and experiment
  checkouts.
- Cover visual, performance, and accessibility targets introduced at different
  commits.
- Cover first-parent merge attribution and second-parent source investigation.
- Verify exact test and category narrowing as target intervals diverge.
- Verify successful and failed runs restore the experiment checkout.
- Put a readable commit graph directly above every Jest case.

### Non-goals

- Starting Docker, twin-server processes, browsers, or application servers.
- Running real visreg, performance, or accessibility measurements.
- Testing Commander option parsing; existing CLI tests cover that boundary.
- Re-testing every persistence or infrastructure failure already covered by
  focused unit tests.
- Supporting non-monotonic regressions that disappear and later reappear; the
  current bisect contract assumes monotonic target presence.

## Test Boundary

Create `packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts` and call
`runBisect(...)` without supplying a precomputed `gitRange`. This forces the
production code to:

1. inspect both repositories;
2. resolve the good and bad refs;
3. load the first-parent history and merge parents;
4. select and check out candidates;
5. discover targets from the bad-ref result;
6. independently narrow each target interval;
7. investigate eligible merge sources;
8. persist terminal state; and
9. restore the experiment checkout.

The injected dependency adapter retains real Git checkout and restoration plus
real filesystem persistence. Server lease, materialization, and refresh hooks
are inert because the test has no application runtime. `compare(request)` is
the single behavior-bearing stub: it looks up the current SHA in the scenario's
regression timeline and builds category-correct `TestResult[]` for only the
requested categories and exact tests.

No production behavior or application source files need to change for this
suite.

## Fixture Architecture

### Repository builder

A fixture builder creates one source repository and two clones:

- `control/` is detached at the scenario's known-good commit.
- `experiment/` remains on a named branch at the scenario's bad commit.

Each synthetic commit updates an innocuous fixture file so every node is a real
commit. Merge scenarios create real topic branches and non-fast-forward merge
commits. The scenario records semantic labels such as `G`, `V`, `M`, and `P`
alongside their generated SHAs so assertions remain readable.

### Regression timeline

Each scenario declares when a target first becomes present. The compare stub
derives the result at any SHA by walking that SHA's declared target state. It
must return realistic result shapes for:

- visreg: a visual measurement with or without a diff;
- perf: the persisted performance measurement used by target discovery; and
- accessibility: violations present or absent for a stable rule identifier.

The fixture data is keyed by SHA rather than commit subject so the production
code cannot accidentally rely on test labels.

### Assertions

Every successful case asserts the returned session rather than internal helper
calls first. Where the behavior matters, it additionally asserts:

- requested SHA/category/exact-test history captured by the compare stub;
- exact named commit traversal, including every binary-search midpoint;
- merge investigation target results;
- written `session.json` and `summary.json` terminal state; and
- experiment branch and SHA after completion.

The failure case asserts the rejected error, failed persisted state, and restored
experiment branch/SHA.

## Test Cases

The same graph is copied as a block comment immediately above each corresponding
`it(...)` in the Jest file.

### 1. Linear history with different regression types

```text
known-good -> visual-regression-introduced -> visual-regression-confirmed
              ^ first visual
-> performance-regression-introduced -> visual-and-performance-confirmed
   ^ first performance
-> accessibility-regression-introduced -> known-bad
   ^ first accessibility
```

Expect the three named introduction commits. Assert the exact binary-search
traversal from `known-bad` through each midpoint and verify later candidate
requests narrow to unresolved categories and exact tests.

### 2. One commit introduces multiple regressions

```text
known-good -> clean-before-regressions -> visual-and-performance-regressions-introduced
                                           ^ first visual/performance
-> regressions-confirmed -> known-bad
```

Expect both targets at the named introduction commit. Verify the exact midpoint
order and that shared candidate work measures the introduction commit once.

### 3. Regression originates on a merged branch

```text
known-good ------------> mainline-before-merge ------> merge-topic-branch -> known-bad
 \                                                    /
  -> topic-first-commit -> topic-second-commit -------
     ^ source first bad                                ^ primary first bad is merge
```

Expect the primary first-parent result at `merge-topic-branch`, followed by a
`source-found` result at `topic-first-commit`. Assert primary and child-history
traversal in one exact sequence.

### 4. Compare failure restores the experiment checkout

```text
known-good -> clean-before-failure -> compare-failure -> known-bad
```

Expect `runBisect(...)` to reject, persist failed state, and restore the
experiment checkout to its original named branch and SHA. Assert traversal
stops exactly at `compare-failure`.

### 5. No regressions at the bad ref

```text
known-good -> clean-midpoint-one -> clean-midpoint-two -> known-bad-clean
```

Expect zero targets, only the bad-ref comparison, a complete session, and a
restored experiment checkout.

### 6. First bad commit is adjacent to good

```text
known-good -> visual-regression-introduced -> regression-confirmed -> known-bad
              ^ first bad
```

Expect `visual-regression-introduced` and assert only `known-bad` plus that
adjacent midpoint are compared.

### 7. Same category, different exact tests, different first-bad commits

```text
known-good -> homepage-regression-introduced -> homepage-regression-confirmed
              ^ first homepage
-> cart-regression-introduced -> known-bad
   ^ first cart
```

Expect the named Homepage and Cart commits. Verify the exact traversal and
candidate narrowing by `(testFile, testName)` even though both targets use
visreg.

### 8. Merge resolution introduces the regression

```text
known-good ------------> mainline-before-merge ------> merge-topic-branch -> known-bad
 \                                                    /
  -> topic-first-commit -> topic-second-commit -------
                                                        ^ first bad after merge
```

Expect primary first bad `merge-topic-branch`, then `merge-introduced` because
the target is absent at the second parent. Assert the exact primary traversal
and second-parent validation.

### 9. Multiple source commits inside a merge plus a later normal regression

```text
known-good ------------> mainline-before-merge ------> merge-topic-branch
 \                                                    /
  -> topic-first-commit -> topic-second-commit -------
     ^ visual source       ^ accessibility source
-> post-merge-clean-commit -> mainline-performance-regression-introduced -> known-bad
                              ^ regression outside merge
```

Expect primary visreg and accessibility targets at `merge-topic-branch` and the
perf target at `mainline-performance-regression-introduced`. Merge investigation
must attribute visreg to `topic-first-commit` and accessibility to
`topic-second-commit`. Assert the full primary-plus-child traversal so the test
proves midpoint reuse and binary narrowing instead of merely checking the final
answers.

## Test Isolation and Cleanup

- Use a fresh temporary root per test and remove it in `afterEach`.
- Configure Git author identity inside the source fixture only.
- Never modify the working repository or global Git configuration.
- Use deterministic commit subjects and result data, but assert generated SHAs.
- Run the suite serially if process-level signal handlers make parallel execution
  unsafe.
- Preserve any pre-existing workspace files and results outside the temporary
  root.

## Verification

Run the focused Jest suite first:

```bash
yarn workspace shaka-perf test \
  packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts \
  --runInBand
```

Then run the package bisect tests and typecheck through the repository's normal
tooling. The implementation is complete when all nine cases pass without
Docker, network access, or changes to either checkout outside the temporary
fixture.
