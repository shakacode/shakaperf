# Compare Bisect Black-Box Jest E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nine Jest cases that exercise `runBisect(...)` against real temporary linear and merge Git histories while stubbing only SHA-specific compare outcomes.

**Architecture:** A test-only fixture module creates a source repository and two clones, maps readable labels to generated SHAs, and provides production Git checkout/restoration plus real persistence around an inert server lifecycle. The Jest suite calls `runBisect(...)` without a precomputed range and supplies deterministic category-correct `TestResult[]` from the compare adapter.

**Tech Stack:** TypeScript, Jest, Node.js filesystem/child-process APIs, Git CLI, existing `runBisect`, bisect Git helpers, persistence helpers, and `shaka-shared` viewport types.

## Global Constraints

- Work only in temporary repositories; never mutate the workspace repository or global Git config.
- Do not start Docker, twin servers, browsers, or application servers.
- Do not change production behavior; all new support stays under `src/compare/bisect/__tests__/`.
- Stub compare outcomes by immutable SHA; do not mock scheduler, range discovery, first-parent traversal, merge investigation, checkout restoration, or terminal session persistence.
- Put the commit graph block comment immediately above every Jest `it(...)` case.
- Use descriptive commit labels such as `known-good` and
  `performance-regression-introduced`; do not use single-letter stand-ins.
- Assert the exact commit comparison order in every case to prove midpoint
  selection and effective binary-search traversal.
- Express first-bad and merge-source expectations through readable helpers,
  not ad hoc `Object.fromEntries(...)` transformations.
- Preserve the current monotonic-regression contract.

---

### Task 1: Real-Git fixture and boundary cases

**Files:**
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts`

**Interfaces:**
- Produces: `createLinearFixture(labels: string[]): E2eRepositoryFixture`
- Produces: `createMergeFixture(): E2eRepositoryFixture`
- Produces: `createE2eDependencies(options): { dependencies: ExecuteBisectDependencies; compareCalls: CompareRunRequest[] }`
- Produces: `resultTimeline(...targets): Record<string, readonly TestResult[]>`
- Produces: `assertExperimentRestored(fixture): void`

- [ ] **Step 1: Write boundary tests before the fixture exists**

Add `e2e.test.ts` imports for the wished-for fixture API and cases 5 and 6 with their graph comments. Case 5 asserts no targets and only the bad-ref compare. Case 6 asserts the first commit after good is returned.

- [ ] **Step 2: Run the focused suite and verify RED**

Run:

```bash
yarn workspace shaka-perf test src/compare/bisect/__tests__/e2e.test.ts --runInBand
```

Expected: FAIL because `./e2e-fixture` does not exist.

- [ ] **Step 3: Implement the minimum real-Git fixture**

Implement source-repository initialization, local author configuration, real commits, two clones, control detachment at the first SHA, experiment branch retention at the last SHA, temporary cleanup, category-correct result builders, and an `ExecuteBisectDependencies` adapter. The adapter must use `checkoutDetached`, `restoreCheckout`, `writeSessionAtomic`, and `writeSummary`; lease/materialize/refresh are inert; `compare` filters complete result shapes by requested category and exact test.

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run the command from Step 2. Expected: 2 tests pass.

- [ ] **Step 5: Commit the fixture and boundary slice**

```bash
git add packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts \
  packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts
git commit -m "test(compare): add real-git bisect e2e fixture"
```

### Task 2: Linear multi-target scenarios

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts`

**Interfaces:**
- Consumes: the fixture and dependency adapter from Task 1.
- Produces: category-specific visreg, perf, and accessibility timelines plus exact-test selection assertions.

- [ ] **Step 1: Add cases 1, 2, and 7 with graph comments**

Case 1 declares independent visreg, perf, and accessibility introduction SHAs. Case 2 declares visreg and perf together. Case 7 declares Homepage and Cart visreg targets at distinct SHAs.

- [ ] **Step 2: Run the new named cases and verify RED**

Run:

```bash
yarn workspace shaka-perf test src/compare/bisect/__tests__/e2e.test.ts \
  --runInBand --testNamePattern='different regression types|multiple regressions|different exact tests'
```

Expected: FAIL until the fixture can emit all three category shapes and filter exact tests.

- [ ] **Step 3: Extend only the fixture result builders needed by the failures**

Build complete visreg, perf, and accessibility outcomes matching the production analyzer schemas. Filter results to `request.categories` and `request.tests`, retaining one outcome per requested stage and one `TestResult` per requested exact test.

- [ ] **Step 4: Run all focused E2E cases and verify GREEN**

Run the full focused command. Expected: 5 tests pass.

- [ ] **Step 5: Commit the linear scenarios**

```bash
git add packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts \
  packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts
git commit -m "test(compare): cover linear bisect regression histories"
```

### Task 3: Merge-aware scenarios

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts`

**Interfaces:**
- Consumes: real repository fixture and compare timeline.
- Produces: real non-fast-forward merge histories with label-to-SHA assertions.

- [ ] **Step 1: Add cases 3, 8, and 9 with graph comments**

Use real topic branches and `git merge --no-ff`. Assert `source-found` for a topic regression, `merge-introduced` for a resolution regression, and independent attribution when a later ordinary commit introduces perf.

- [ ] **Step 2: Run merge cases and verify RED**

Run:

```bash
yarn workspace shaka-perf test src/compare/bisect/__tests__/e2e.test.ts \
  --runInBand --testNamePattern='merged branch|merge resolution|later normal'
```

Expected: FAIL until the merge fixture creates the required topology and timeline states.

- [ ] **Step 3: Implement the minimum merge fixture behavior**

Create the topic branch from `G`, commit `S1` and `S2`, return to the mainline branch, create `M1`, merge topic with `--no-ff -m M`, then append optional ordinary commits. Preserve the merge SHA and parent relationships from real Git.

- [ ] **Step 4: Run all focused E2E cases and verify GREEN**

Run the full focused command. Expected: 8 tests pass.

- [ ] **Step 5: Commit merge coverage**

```bash
git add packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts \
  packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts
git commit -m "test(compare): cover merge-aware bisect histories"
```

### Task 4: Failure restoration and final verification

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts`

**Interfaces:**
- Consumes: the completed fixture adapter.
- Produces: deterministic compare failure injection keyed by SHA.

- [ ] **Step 1: Add case 4 with its graph comment**

Configure the compare adapter to throw at `X`. Assert the original error, persisted failed `session.json`, and the experiment's original branch and SHA.

- [ ] **Step 2: Run the failure case and verify RED**

Run:

```bash
yarn workspace shaka-perf test src/compare/bisect/__tests__/e2e.test.ts \
  --runInBand --testNamePattern='restores the experiment checkout'
```

Expected: FAIL until SHA-specific failure injection and failed-session reading are implemented.

- [ ] **Step 3: Add minimum failure injection and assertions**

Throw only when `request.sha` matches the configured failure SHA. Read persisted state from the temporary results directory and assert terminal failure plus restored Git state.

- [ ] **Step 4: Run focused and package verification**

Run:

```bash
yarn workspace shaka-perf test src/compare/bisect/__tests__/e2e.test.ts --runInBand
yarn workspace shaka-perf test src/compare/bisect/__tests__ --runInBand
yarn workspace shaka-perf typecheck
git diff --check
```

Expected: 9 E2E tests pass, all bisect tests pass, typecheck exits 0, and diff check prints nothing.

- [ ] **Step 5: Commit the failure case**

```bash
git add packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts \
  packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts
git commit -m "test(compare): verify bisect checkout restoration"
```

### Task 5: Readable traversal and multi-source merge refinement

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e-fixture.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/e2e.test.ts`
- Modify: `docs/superpowers/specs/2026-07-19-compare-bisect-black-box-e2e-design.md`

**Interfaces:**
- Produces: `expectBinarySearchTraversal(harness, fixture, commitLabels)`
- Produces: `expectFirstBadCommits(session, fixture, expectations)`
- Produces: `expectMergeAttributions(session, fixture, mergeCommit, expectations)`

- [ ] Replace abbreviated labels with descriptive commit subjects in every
  fixture, graph, timeline, and assertion.
- [ ] Assert the exact compare-call commit order in all nine cases.
- [ ] Expand case 9 to locate visual and accessibility regressions at different
  commits inside the merged branch while retaining a later mainline performance
  regression.
- [ ] Run the focused E2E suite, full bisect suite, package typecheck, and
  `git diff --check`.
