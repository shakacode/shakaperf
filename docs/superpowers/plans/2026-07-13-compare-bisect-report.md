# Compare Bisect Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a self-contained `compare-bisect-results/bisect-report.html` whose commit tree filters the bad-ref compare cards to regressions first introduced by the selected commit.

**Architecture:** Preserve commit subjects in the session, map session state plus bad-ref `TestResult[]` into a pure view model, and render it through the existing single-file compare report shell. The session keeps bad-ref cards only in memory and rewrites the HTML at persistence checkpoints; report generation never invokes compare or changes a checkout.

**Tech Stack:** TypeScript strict mode, Jest 30, React 19, Vite single-file build, Playwright Chromium, existing pipeline report renderer.

## Global Constraints

- Never run `shaka-perf compare`, `shaka-perf compare bisect`, or twin-server lifecycle commands during implementation or verification.
- Write `compare-bisect-results/bisect-report.html` from already-collected data.
- Use bad-ref compare cards as the only card dataset; midpoint runs are intentionally partial.
- Apply existing lightweight stage strippers so the HTML is portable.
- Preserve normal compare-report behavior when the optional bisect payload is absent.
- Match the existing terminal-brutalist report-shell and keyboard-accessibility patterns.

---

### Task 1: Commit Metadata and Report Model

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/git.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/types.ts`
- Create: `packages/shaka-perf/src/compare/bisect/report-model.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/git.test.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/report-model.test.ts`

**Interfaces:**
- Produces: `PreparedGitRange.commitSubjects: Record<string, string>`.
- Produces: `BisectSession.commitSubjects: Record<string, string>`.
- Produces: `buildBisectReportModel(session, badRefTests, generatedAt): BisectReportModel`.
- Produces: `BisectReportData = ReportData & { bisect: BisectReportModel }`.

- [ ] **Step 1: Write failing Git metadata assertion**

```ts
expect(prepared.commitSubjects).toEqual(Object.fromEntries(
  fixture.commits.map((sha, index) => [sha, `commit-${index}`]),
));
```

- [ ] **Step 2: Verify the Git test fails**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/git.test.ts --runInBand`

Expected: FAIL because `PreparedGitRange` lacks `commitSubjects`.

- [ ] **Step 3: Collect subjects without checkout changes**

After computing `orderedCommits`, call:

```ts
git show --no-patch --format=%H%x00%s <ordered commit SHAs>
```

Parse each NUL-separated SHA/subject pair and return `commitSubjects` with the existing range.

- [ ] **Step 4: Write failing report-model tests**

Use four commits and targets covering found visual/perf/accessibility regressions, one unresolved target, one invalid target, one clean commit, and one target that cannot map to a card. Assert exact per-commit category counts, synthetic view membership, bad-ref observation retention, and `testId: null` for the unmapped target.

```ts
expect(model.commits[1].counts).toEqual({ visreg: 1, perf: 0, accessibility: 0 });
expect(model.views.unresolved.targetIds).toEqual(['unresolved-target']);
expect(model.views.invalid.targetIds).toEqual(['invalid-target']);
expect(model.targetsById['missing-card'].testId).toBeNull();
```

- [ ] **Step 5: Verify the report-model test fails**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report-model.test.ts --runInBand`

Expected: FAIL because `report-model.ts` is missing.

- [ ] **Step 6: Implement the pure model**

Export `BisectReportCounts`, `BisectReportCommit`, `BisectReportTarget`, `BisectReportView`, `BisectReportModel`, and `BisectReportData`. Map tests by normalized `filePath + name`; count only `status === 'found'` targets on commits; source details from `target.observations[session.badSha]`; keep unresolved and invalid targets in synthetic views.

- [ ] **Step 7: Run focused checks**

```bash
yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/git.test.ts src/compare/bisect/__tests__/report-model.test.ts --runInBand
yarn workspace shaka-perf typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shaka-perf/src/compare/bisect/git.ts packages/shaka-perf/src/compare/bisect/types.ts packages/shaka-perf/src/compare/bisect/report-model.ts packages/shaka-perf/src/compare/bisect/__tests__/git.test.ts packages/shaka-perf/src/compare/bisect/__tests__/report-model.test.ts
git commit -m "feat(shaka-perf): model compare bisect reports"
```

### Task 2: Self-Contained Report Writer

**Files:**
- Modify: `packages/shaka-perf/src/pipeline/report.ts`
- Create: `packages/shaka-perf/src/compare/bisect/report.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/report.test.ts`

**Interfaces:**
- Produces: `reportDataForMode<T extends ReportData>(data, mode, stages): T`.
- Produces: `BISECT_REPORT_FILENAME = 'bisect-report.html'`.
- Produces: `writeBisectReport(options): string` returning the absolute path.

- [ ] **Step 1: Write a failing writer test**

Write fixture data to a temporary directory with a fake stage stripper that converts `/tmp/control.png` to `data:image/png;base64,fixture`. Assert the file name, embedded bisect payload, inlined URI, and absence of the source path.

- [ ] **Step 2: Verify failure**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report.test.ts --runInBand`

Expected: FAIL because the writer is missing.

- [ ] **Step 3: Generalize pipeline report mode stripping**

Export a generic `reportDataForMode<T extends ReportData>` from `pipeline/report.ts`. Preserve `...data` so extension fields survive while outcomes are stripped. Make existing `writeReport` call the new helper unchanged.

- [ ] **Step 4: Implement the bisect writer**

```ts
export function writeBisectReport(options: WriteBisectReportOptions): string {
  const outputPath = path.join(options.resultsDirectory, BISECT_REPORT_FILENAME);
  const portable = reportDataForMode(options.data, 'lightweight', options.stages);
  fs.mkdirSync(options.resultsDirectory, { recursive: true });
  fs.writeFileSync(outputPath, renderReportHtml(portable), 'utf8');
  return outputPath;
}
```

- [ ] **Step 5: Run writer and existing report checks**

```bash
yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report.test.ts src/pipeline/__tests__/pipeline.test.ts --runInBand
yarn workspace shaka-perf typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shaka-perf/src/pipeline/report.ts packages/shaka-perf/src/compare/bisect/report.ts packages/shaka-perf/src/compare/bisect/__tests__/report.test.ts
git commit -m "feat(shaka-perf): write portable bisect reports"
```

### Task 3: Session Persistence Integration

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/session.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/persistence.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts`
- Modify: `packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts`

**Interfaces:**
- Adds: `ExecuteBisectDependencies.writeReport(session, badRefTests): void`.
- Guarantees: no report write before successful bad-ref target discovery.

- [ ] **Step 1: Write failing orchestration tests**

Extend the harness with `calls.reports`. Assert the first report uses bad-ref test names and running state, the last uses terminal state, failure before target discovery writes no report, and summary JSON contains `commitSubjects`.

- [ ] **Step 2: Verify interface failures**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/session.test.ts src/compare/bisect/__tests__/persistence.test.ts --runInBand`

Expected: FAIL because report persistence and subjects are absent.

- [ ] **Step 3: Retain bad-ref cards and write reports**

```ts
let badRefTests: readonly TestResult[] | null = null;
const persist = (): void => {
  deps.writeSession(session);
  if (badRefTests) deps.writeReport(session, badRefTests);
};
```

Assign only after bad-ref error validation and target discovery. Use the same helper for terminal persistence.

- [ ] **Step 4: Wire the default writer**

Populate `initialSession.commitSubjects`, build `BisectReportData` from the existing compare pipeline configuration, and call `writeBisectReport`. Include subjects in compact summary JSON. Print the report path only after it exists.

- [ ] **Step 5: Run focused checks**

```bash
yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/session.test.ts src/compare/bisect/__tests__/persistence.test.ts src/compare/bisect/__tests__/report.test.ts --runInBand
yarn workspace shaka-perf typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shaka-perf/src/compare/bisect/session.ts packages/shaka-perf/src/compare/bisect/persistence.ts packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts packages/shaka-perf/src/compare/bisect/__tests__/persistence.test.ts
git commit -m "feat(shaka-perf): persist bisect HTML reports"
```

### Task 4: Navigator and Card Filtering

**Files:**
- Create: `packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx`
- Create: `packages/shaka-perf/report-shell/src/components/BisectSelectionSummary.tsx`
- Create: `packages/shaka-perf/report-shell/src/bisect-selection.ts`
- Modify: `packages/shaka-perf/report-shell/src/App.tsx`
- Modify: `packages/shaka-perf/report-shell/src/types.ts`
- Create: `packages/shaka-perf/src/compare/bisect/__tests__/report-selection.test.ts`

**Interfaces:**
- Produces: discriminated `BisectSelection` for all, commit, unresolved, and invalid views.
- Produces: `selectionTargetIds`, `selectionTestIds`, and `selectionCategories`.

- [ ] **Step 1: Write failing selection tests**

Assert a visual commit returns only its target/card and `visreg`; a clean commit returns empty sets; synthetic views return their exact target sets.

- [ ] **Step 2: Verify failure**

Run: `yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report-selection.test.ts --runInBand`

Expected: FAIL because the selection module is missing.

- [ ] **Step 3: Implement selection helpers**

```ts
export type BisectSelection =
  | { kind: 'all' }
  | { kind: 'commit'; sha: string }
  | { kind: 'unresolved' }
  | { kind: 'invalid' };
```

Derive target IDs first, then non-null card IDs and category sets.

- [ ] **Step 4: Implement navigator components**

Render summary selections and every commit as semantic buttons with `aria-pressed`, endpoint labels, measured state, subject, short SHA, and labelled visreg/perf/accessibility counters. Render selected target rows with category, test, viewport, subject, values, and invalid reason.

- [ ] **Step 5: Compose with existing filters**

Keep bisect selection separate from chip/search/sort state. Intersect card IDs for dimming and intersect visible stage sections with selected target categories when selection is not `all`. A clean commit must produce an explicit empty state, not restore all cards.

- [ ] **Step 6: Run checks**

```bash
yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/report-selection.test.ts --runInBand
yarn workspace shaka-perf build-report-shell
yarn workspace shaka-perf typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx packages/shaka-perf/report-shell/src/components/BisectSelectionSummary.tsx packages/shaka-perf/report-shell/src/bisect-selection.ts packages/shaka-perf/report-shell/src/App.tsx packages/shaka-perf/report-shell/src/types.ts packages/shaka-perf/src/compare/bisect/__tests__/report-selection.test.ts
git commit -m "feat(shaka-perf): add bisect report navigator"
```

### Task 5: Styling, Browser Acceptance, and Documentation

**Files:**
- Modify: `packages/shaka-perf/report-shell/src/styles.css`
- Create: `packages/shaka-perf/test/compare/bisect-report-ui_spec.ts`
- Modify: `packages/shaka-perf/README-compare-bisect.md`

**Interfaces:**
- Uses only static fixture data and `writeBisectReport`; never invokes compare.
- Verifies nodes, counters, card dimming, stage focus, synthetic views, clean-commit state, and responsive layout.

- [ ] **Step 1: Write failing Playwright acceptance**

Generate a four-commit, three-card report in a temp directory. Open it via `file://`, select a visual commit, and assert one card is focused while perf/accessibility sections are hidden. Select the clean commit and assert the explicit no-regressions state. Select unresolved/invalid views and assert their target summaries. At phone width assert vertical tree flow.

- [ ] **Step 2: Verify browser failure**

```bash
yarn workspace shaka-perf build-report-shell
yarn workspace shaka-perf test --runTestsByPath test/compare/bisect-report-ui_spec.ts --runInBand
```

Expected: FAIL until styles and DOM hooks are complete.

- [ ] **Step 3: Implement report styling**

Add `.bisect-*` styles using existing report variables, borders, mono type, focus rings, and reduced-motion behavior. Use horizontal connected nodes on wide screens and a vertical connector under `@media (max-width: 760px)`.

- [ ] **Step 4: Document output and behavior**

Update the README output tree and explain that the report uses bad-ref cards, node counters represent first-bad targets, and selecting nodes filters without rerunning compare.

- [ ] **Step 5: Run final focused verification**

```bash
yarn workspace shaka-perf build-report-shell
yarn workspace shaka-perf test --runTestsByPath src/compare/bisect/__tests__/git.test.ts src/compare/bisect/__tests__/report-model.test.ts src/compare/bisect/__tests__/report.test.ts src/compare/bisect/__tests__/report-selection.test.ts src/compare/bisect/__tests__/session.test.ts src/compare/bisect/__tests__/persistence.test.ts test/compare/bisect-report-ui_spec.ts --runInBand
yarn workspace shaka-perf typecheck
git diff --check
```

Expected: PASS with no compare invocation.

- [ ] **Step 6: Commit**

```bash
git add packages/shaka-perf/report-shell/src/styles.css packages/shaka-perf/test/compare/bisect-report-ui_spec.ts packages/shaka-perf/README-compare-bisect.md
git commit -m "feat(shaka-perf): finish interactive bisect report"
```

### Task 6: Completion Audit

**Files:**
- Inspect only: all changed files and the synthetic output artifact.

**Interfaces:**
- Proves every approved requirement from source, tests, and rendered artifact evidence.

- [ ] **Step 1: Generate a synthetic report without compare**

Write `/tmp/shaka-perf-bisect-report-acceptance/bisect-report.html` directly from static fixture data.

- [ ] **Step 2: Inspect with Playwright**

Verify commit nodes and counters, bad-ref card content, node filtering, unresolved/invalid views, clean-commit state, keyboard focus, and phone layout.

- [ ] **Step 3: Verify repository state**

```bash
test -f /tmp/shaka-perf-bisect-report-acceptance/bisect-report.html
git status --short --branch
git log --oneline codex/compare-bisect-v0..HEAD
```

Expected: the HTML exists, worktree is clean, and the branch contains granular design/model/writer/session/UI commits.

- [ ] **Step 4: Mark the goal complete**

Only after all checks pass, mark the goal complete and report output, commits, and verification evidence.
