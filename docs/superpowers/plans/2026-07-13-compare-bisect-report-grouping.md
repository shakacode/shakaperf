# Compare Bisect Report Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse all zero-regression commits into one disclosure and group selected regression targets into readable AB-test panels.

**Architecture:** Keep the persisted report model and selection semantics unchanged. Derive clean and regression commit collections inside `BisectNavigator`, and derive stable test groups inside `BisectSelectionSummary`; presentation-only React components render those derived collections with focused CSS.

**Tech Stack:** React 19, TypeScript strict mode, Vite single-file report shell, Jest server rendering, Playwright browser acceptance.

## Global Constraints

- Do not change bisect target identity, search behavior, or persisted report schemas.
- One global clean-history disclosure owns every zero-count commit.
- Only commits with a positive category count render selectable commit cards.
- Summary grouping is by mapped test ID, falling back to normalized test file plus test name.
- Preserve keyboard semantics, live-region behavior, card focusing, and responsive layout.

---

### Task 1: Collapse Clean Commit History

**Files:**
- Modify: `packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx`
- Modify: `packages/shaka-perf/report-shell/src/styles.css`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`

**Interfaces:**
- Produces a presentational `CleanCommitGroup` receiving zero-count commits and the report model.
- Existing `CommitNode` remains the only selectable commit component.

- [ ] **Step 1: Write failing server-render tests**

Add a mixed model with multiple clean commits and positive-count commits. Assert:

```ts
expect(html).toContain('data-bisect-clean-history="true"');
expect(html).toContain('3 commits with no first-bad regressions');
expect(html).toContain('clean-one');
expect(html).not.toContain('data-bisect-sha="clean-one"');
expect(html).toContain('data-bisect-sha="visual-commit"');
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/app-report.test.ts --runInBand`

Expected: FAIL because clean commits still render individual selection cards.

- [ ] **Step 3: Implement clean/regression derivation and disclosure**

Use one predicate:

```ts
function hasRegressions(commit: BisectReportCommit): boolean {
  return commit.counts.visreg > 0
    || commit.counts.perf > 0
    || commit.counts.accessibility > 0;
}
```

Partition `model.commits` once during render. Render a native `details` box for clean commits, with measured/unmeasured totals and an internal SHA/subject list. Map only regression commits to `CommitNode`.

- [ ] **Step 4: Add compact disclosure and lane styles**

Keep the existing industrial report language: strong border, compact monospace metadata, wrapped list rows, and no new color system. Ensure the disclosure is fixed-width enough to scan but does not force page overflow.

- [ ] **Step 5: Run test and verify GREEN**

Run the Task 1 test command. Expected: PASS.

- [ ] **Step 6: Commit navigator grouping**

```bash
git add packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx packages/shaka-perf/report-shell/src/styles.css packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts
git commit -m "feat(shaka-perf): collapse clean bisect commits"
```

---

### Task 2: Group Regression Targets by Test

**Files:**
- Modify: `packages/shaka-perf/report-shell/src/components/BisectSelectionSummary.tsx`
- Modify: `packages/shaka-perf/report-shell/src/styles.css`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`

**Interfaces:**
- Produces `TestRegressionGroup` values with test identity and ordered targets.
- Produces a `RegressionTargetRow` for one category/viewport/subject.
- Consumes unchanged `selectionTargetIds` output.

- [ ] **Step 1: Write failing grouped-summary tests**

Render targets where Homepage has accessibility and performance regressions across phone and desktop, while Product has one visual regression. Assert one test panel per test and multiple target rows inside Homepage:

```ts
expect(html.match(/data-bisect-test-group="homepage"/g)).toHaveLength(1);
expect(testGroupMarkup(html, 'homepage')).toContain('button-name');
expect(testGroupMarkup(html, 'homepage')).toContain('LH Score');
expect(testGroupMarkup(html, 'homepage')).toContain('phone');
expect(testGroupMarkup(html, 'homepage')).toContain('desktop');
```

Assert readable labels `Control`, `Experiment`, and `Change`, and assert raw keys such as `controlDisplay` are absent.

- [ ] **Step 2: Run the component test and verify RED**

Run the Task 1 test command. Expected: FAIL because each target is still its own card.

- [ ] **Step 3: Implement stable grouping and readable values**

Group with:

```ts
const key = target.testId ?? JSON.stringify([target.testFile, target.testName]);
```

Preserve first-seen test order and target order. Render the test heading/file once, category-tagged rows, viewport badges, and a compact value triplet. Prefer display values over raw numbers and suppress duplicate raw properties already represented by the triplet.

- [ ] **Step 4: Replace target-card CSS with test-panel CSS**

Use a responsive panel grid, a single test header, category-accented rows, and compact value cells resembling the hierarchy of actual test report cards. At narrow widths, rows stack without clipping.

- [ ] **Step 5: Run component and acceptance tests**

Run:

```bash
yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/app-report.test.ts test/compare/bisect-report-ui_spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit grouped summaries**

```bash
git add packages/shaka-perf/report-shell/src/components/BisectSelectionSummary.tsx packages/shaka-perf/report-shell/src/styles.css packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts
git commit -m "feat(shaka-perf): group bisect regressions by test"
```

---

### Task 3: Regenerate and Visually Verify the Current Report

**Files:**
- Modify if assertions need refinement: `packages/shaka-perf/test/compare/bisect-report-ui_spec.ts`
- Regenerate ignored artifact: `demo-ecommerce/compare-bisect-results/bisect-report.html`
- Regenerate ignored artifact: `demo-ecommerce/compare-bisect-results/bisect-report.json`

**Interfaces:**
- Uses the existing `compare bisect --report-only` command only.

- [ ] **Step 1: Build the current report shell**

Run: `yarn workspace shaka-perf build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 2: Regenerate via report-only**

From `demo-ecommerce`, run:

```bash
yarn node ../packages/shaka-perf/dist/cli.js compare bisect --report-only
```

Expected: prints the bisect report path, does not log bisect lifecycle work, and leaves the checkout unchanged.

- [ ] **Step 3: Inspect desktop and narrow layouts**

Open the generated HTML in the browser. Verify one clean box, only positive regression commit cards, grouped Homepage/Product/etc. panels, commit filtering, readable values, and no horizontal page overflow at narrow width.

- [ ] **Step 4: Run complete verification**

Run the focused UI tests, `yarn workspace shaka-perf test --runInBand`, `yarn build`, and `git diff --check`.

Expected: all tests and build pass; generated ignored artifacts remain available for manual review.
