# Compare Bisect Merge Investigation Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a merge commit block select its regressions and open an accessible modal that traces the investigated source commits and identifies which commit or merge result introduced every regression.

**Architecture:** Extend the server-built bisect report model with a UI-owned merge-investigation projection, validate it at the report-shell boundary, and render it through a focused React dialog component. Keep persistence and Git topology out of the browser; consume only stable report data and reuse the native `Dialog` lifecycle.

**Tech Stack:** TypeScript 5.9, React 19, Zod 3, Jest 30, Playwright, Vite, CSS.

## Global Constraints

- A merge click both preserves the existing commit selection/filter and opens the modal.
- List source commits after the merge base in oldest-to-newest order.
- Attribute `source-found` and `nested-merge` regressions to their exact source SHA.
- Present `merge-introduced` regressions separately; never assign them to a source commit.
- Explain every non-complete state without presenting partial evidence as confirmed.
- Continue accepting old report payloads without the optional projection.
- Use the existing `Dialog`; add no dependency, browser fetch, or browser Git query.
- Preserve keyboard behavior, focus restoration, responsiveness, and reduced motion.
- Do not run a real `shaka-perf compare bisect` pipeline.

---

## File Structure

- Modify `packages/shaka-perf/src/compare/bisect/report-model.ts`: build the report-owned projection.
- Modify `packages/shaka-perf/src/compare/bisect/__tests__/report-model.test.ts`: prove ordering and attribution.
- Modify `packages/shaka-perf/report-shell/src/report-data.ts`: validate the JSON shape.
- Modify `packages/shaka-perf/test/compare/report-data_spec.ts`: prove malformed data is rejected.
- Create `packages/shaka-perf/report-shell/src/components/MergeInvestigationDialog.tsx`: render the modal.
- Modify `packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx`: connect selection and dialog state.
- Modify `packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`: cover static semantics and states.
- Modify `packages/shaka-perf/report-shell/src/styles.css`: style the source trace.
- Modify `packages/shaka-perf/test/compare/bisect-report-ui_spec.ts`: cover runtime interaction and layout.

---

### Task 1: Build the report projection

**Files:**
- Modify: `packages/shaka-perf/src/compare/bisect/report-model.ts`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/report-model.test.ts`

**Interfaces:**
- Consumes: `MergeInvestigation` and `BisectReportTarget`.
- Produces: `BisectReportMergeInvestigation`, `BisectReportMergeSourceCommit`, and `BisectReportCommit.mergeInvestigation`.

- [ ] **Step 1: Write a failing projection test**

Create three primary targets whose first bad SHA is `merge`: visual `source-found` at `source-bad`, accessibility `nested-merge` at `source-tip`, and performance `merge-introduced`. Give the child phase this evidence:

```ts
phase: {
  id: 'merge:merge',
  status: 'complete',
  goodSha: 'source-base',
  badSha: 'source-tip',
  orderedCommits: ['source-base', 'source-clean', 'source-bad', 'source-tip'],
  commitSubjects: {
    'source-base': 'shared baseline',
    'source-clean': 'prepare source branch',
    'source-bad': 'introduce visual regression',
    'source-tip': 'merge nested source',
  },
  commitParents: {
    'source-base': [],
    'source-clean': ['source-base'],
    'source-bad': ['source-clean'],
    'source-tip': ['source-bad', 'nested-parent'],
  },
  targets: [],
  attempts: [
    { id: 'clean', sha: 'source-clean', status: 'incomplete' },
    { id: 'bad', sha: 'source-bad', status: 'complete' },
    { id: 'tip', sha: 'source-tip', status: 'complete' },
  ],
},
targetResults: {
  'source-target': { kind: 'source-found', sourceSha: 'source-bad' },
  'nested-target': { kind: 'nested-merge', sourceSha: 'source-tip' },
  'introduced-target': { kind: 'merge-introduced' },
},
```

Assert the merge base is excluded and the exact projection is:

```ts
expect(model.commits.find(({ sha }) => sha === 'merge')?.mergeInvestigation).toEqual({
  status: 'complete',
  mergeBase: 'source-base',
  secondParent: 'source-tip',
  sourceCommits: [
    {
      sha: 'source-clean', subject: 'prepare source branch', measured: false,
      isMerge: false, targetIds: [],
      counts: { visreg: 0, perf: 0, accessibility: 0 },
    },
    {
      sha: 'source-bad', subject: 'introduce visual regression', measured: true,
      isMerge: false, targetIds: ['source-target'],
      counts: { visreg: 1, perf: 0, accessibility: 0 },
    },
    {
      sha: 'source-tip', subject: 'merge nested source', measured: true,
      isMerge: true, targetIds: ['nested-target'],
      counts: { visreg: 0, perf: 0, accessibility: 1 },
    },
  ],
  mergeIntroducedTargetIds: ['introduced-target'],
});
```

- [ ] **Step 2: Run RED**

```bash
yarn workspace shaka-perf test --runInBand src/compare/bisect/__tests__/report-model.test.ts
```

Expected: FAIL because the commit has no `mergeInvestigation` projection.

- [ ] **Step 3: Define the report interfaces**

```ts
export interface BisectReportMergeSourceCommit {
  sha: string;
  subject: string;
  measured: boolean;
  isMerge: boolean;
  targetIds: string[];
  counts: BisectReportCounts;
}

export interface BisectReportMergeInvestigation {
  status: MergeInvestigation['status'];
  failure?: string;
  mergeBase?: string;
  secondParent?: string;
  sourceCommits: BisectReportMergeSourceCommit[];
  mergeIntroducedTargetIds: string[];
}
```

Add `mergeInvestigation?: BisectReportMergeInvestigation` to `BisectReportCommit`.

- [ ] **Step 4: Implement projection from authoritative evidence**

```ts
function buildMergeInvestigationReport(
  investigation: MergeInvestigation | undefined,
  targetsById: Record<string, BisectReportTarget>,
): BisectReportMergeInvestigation | undefined {
  if (!investigation) return undefined;
  const targetIdsBySourceSha = new Map<string, string[]>();
  const mergeIntroducedTargetIds: string[] = [];
  for (const targetId of investigation.targetIds) {
    const result = investigation.targetResults[targetId];
    if (result?.kind === 'merge-introduced') mergeIntroducedTargetIds.push(targetId);
    if (result?.kind === 'source-found' || result?.kind === 'nested-merge') {
      const ids = targetIdsBySourceSha.get(result.sourceSha) ?? [];
      ids.push(targetId);
      targetIdsBySourceSha.set(result.sourceSha, ids);
    }
  }
  const phase = investigation.phase;
  const measuredShas = new Set((phase?.attempts ?? [])
    .filter(({ status }) => status === 'complete')
    .map(({ sha }) => sha));
  const sourceCommits = (phase?.orderedCommits ?? [])
    .filter((sha) => sha !== phase?.goodSha)
    .map((sha) => {
      const targetIds = targetIdsBySourceSha.get(sha) ?? [];
      return {
        sha,
        subject: phase?.commitSubjects[sha] || sha.slice(0, 7),
        measured: measuredShas.has(sha),
        isMerge: (phase?.commitParents[sha] ?? []).length > 1,
        targetIds,
        counts: countsFor(targetIds, targetsById),
      };
    });
  return {
    status: investigation.status,
    failure: investigation.failure,
    mergeBase: phase?.goodSha,
    secondParent: phase?.badSha,
    sourceCommits,
    mergeIntroducedTargetIds,
  };
}
```

Set `mergeInvestigation: buildMergeInvestigationReport(investigation, targetsById)` in the commit builder.

- [ ] **Step 5: Run GREEN and commit**

Run the Task 1 test, then:

```bash
git add packages/shaka-perf/src/compare/bisect/report-model.ts \
  packages/shaka-perf/src/compare/bisect/__tests__/report-model.test.ts
git commit -m "feat(compare): project merge investigation reports"
```

---

### Task 2: Validate projection JSON

**Files:**
- Modify: `packages/shaka-perf/report-shell/src/report-data.ts`
- Test: `packages/shaka-perf/test/compare/report-data_spec.ts`

**Interfaces:**
- Consumes: Task 1's exact JSON shape.
- Produces: validated optional `commit.mergeInvestigation`.

- [ ] **Step 1: Write a failing malformed-data test**

Add a valid minimal bisect payload containing one otherwise-valid commit whose nested value is:

```ts
mergeInvestigation: {
  status: 'complete',
  sourceCommits: 'not-an-array',
  mergeIntroducedTargetIds: [],
},
```

Assert `parseReportData(JSON.stringify(payload))` is null. The current passthrough schema will make this test fail correctly.

- [ ] **Step 2: Run RED**

```bash
yarn workspace shaka-perf test --runInBand test/compare/report-data_spec.ts
```

Expected: FAIL because malformed unknown commit fields are currently accepted.

- [ ] **Step 3: Add exact Zod schemas**

Place these after `countsSchema`, then add `mergeInvestigation: mergeInvestigationSchema.optional()` to `commitSchema`:

```ts
const mergeSourceCommitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  measured: z.boolean(),
  isMerge: z.boolean(),
  counts: countsSchema,
  targetIds: z.array(z.string()),
});
const mergeInvestigationSchema = z.object({
  status: mergeStatusSchema,
  failure: z.string().optional(),
  mergeBase: z.string().optional(),
  secondParent: z.string().optional(),
  sourceCommits: z.array(mergeSourceCommitSchema),
  mergeIntroducedTargetIds: z.array(z.string()),
});
```

- [ ] **Step 4: Add valid and backward-compatible assertions**

Replace the malformed string with a valid source row and assert non-null:

```ts
sourceCommits: [{
  sha: 'source-bad',
  subject: 'introduce regression',
  measured: true,
  isMerge: false,
  counts: { visreg: 1, perf: 0, accessibility: 0 },
  targetIds: ['visual'],
}],
```

Keep the existing structurally valid payload without `mergeInvestigation`; it proves old payload compatibility.

- [ ] **Step 5: Run GREEN and commit**

Run Task 2's test command, then:

```bash
git add packages/shaka-perf/report-shell/src/report-data.ts \
  packages/shaka-perf/test/compare/report-data_spec.ts
git commit -m "feat(compare): validate merge investigation report data"
```

---

### Task 3: Render attribution and non-complete states

**Files:**
- Create: `packages/shaka-perf/report-shell/src/components/MergeInvestigationDialog.tsx`
- Modify: `packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx`
- Test: `packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts`

**Interfaces:**
- Consumes: Task 1's projection, `BisectReportModel.targetsById`, and `Dialog`.
- Produces: `MergeInvestigationDialog({ commit, targetsById, open, onClose })` plus stable source/result data attributes.

- [ ] **Step 1: Write failing static-render tests**

Extend the merge fixture with clean `source-clean`, responsible `source-bad`, and `mergeIntroducedTargetIds`. Assert:

```ts
expect(html).toContain('data-bisect-merge-dialog="mixed-commit"');
expect(html).toContain('source-base → source-t');
expect(html).toContain('prepare source branch');
expect(html).toContain('introduce hero regression');
expect(html).toContain('data-merge-source-result="responsible"');
expect(html).toContain('data-merge-source-result="clear"');
expect(html).toContain('nested merge');
expect(html).toContain('introduced by merge');
expect(html).toContain('Hero section');
expect(html).toContain('LCP regression');
```

Add state-copy cases:

```ts
it.each([
  ['merge-uninvestigated', 'Source attribution has not been run.'],
  ['running', 'Source investigation is still running.'],
  ['failed', 'Source investigation failed.'],
  ['octopus-unsupported', 'Source attribution is unavailable for octopus merges.'],
] as const)('explains the %s modal state', (status, message) => {
  const data = bisectReportWithMergeInvestigation();
  data.bisect!.commits[2].mergeInvestigation = {
    status,
    failure: status === 'failed' ? 'merge-base failed' : undefined,
    sourceCommits: [],
    mergeIntroducedTargetIds: [],
  };
  expect(renderApp(data)).toContain(message);
});
```

- [ ] **Step 2: Run RED**

```bash
yarn workspace shaka-perf test --runInBand src/compare/bisect/__tests__/app-report.test.ts
```

Expected: FAIL because there is no merge dialog markup.

- [ ] **Step 3: Create `MergeInvestigationDialog.tsx`**

Define props and stable copy:

```tsx
interface Props {
  commit: BisectReportCommit;
  targetsById: Record<string, BisectReportTarget>;
  open: boolean;
  onClose: () => void;
}
const categories: BisectCategory[] = ['visreg', 'perf', 'accessibility'];
const categoryLabels = {
  visreg: 'visual', perf: 'performance', accessibility: 'accessibility',
} satisfies Record<BisectCategory, string>;
const stateCopy = {
  'merge-uninvestigated': 'Source attribution has not been run.',
  running: 'Source investigation is still running.',
  failed: 'Source investigation failed.',
  'octopus-unsupported': 'Source attribution is unavailable for octopus merges.',
} as const;
```

Render regression IDs grouped by category:

```tsx
function MergeRegressionList({ targetIds, targetsById }: {
  targetIds: readonly string[];
  targetsById: Record<string, BisectReportTarget>;
}) {
  return <div className="merge-regression-list">{categories.map((category) => {
    const targets = targetIds.map((id) => targetsById[id])
      .filter((target): target is BisectReportTarget => target?.category === category);
    if (targets.length === 0) return null;
    return <section key={category} className="merge-regression-group" data-category={category}>
      <h4>{categoryLabels[category]}</h4>
      <ul>{targets.map((target) => <li key={target.id} data-target-id={target.id}>
        <strong>{target.testName}</strong>
        {target.viewport ? <span>{target.viewport}</span> : null}
        <span>{target.subject}</span>
      </li>)}</ul>
    </section>;
  })}</div>;
}
```

Render one source row. `showAttribution` is true only for a complete investigation:

```tsx
function MergeSourceCommitRow({ sourceCommit, targetsById, showAttribution }: {
  sourceCommit: BisectReportMergeSourceCommit;
  targetsById: Record<string, BisectReportTarget>;
  showAttribution: boolean;
}) {
  const responsible = showAttribution && sourceCommit.targetIds.length > 0;
  return <li className="merge-source-commit"
    data-merge-source-sha={sourceCommit.sha}
    data-merge-source-result={responsible ? 'responsible' : 'clear'}>
    <header>
      <code>{sourceCommit.sha.slice(0, 7)}</code>
      <strong>{sourceCommit.subject}</strong>
      {sourceCommit.isMerge ? <span className="merge-source-commit__merge">nested merge</span> : null}
      <span>{sourceCommit.measured ? 'measured' : 'not measured'}</span>
    </header>
    {responsible ? <MergeRegressionList
      targetIds={sourceCommit.targetIds} targetsById={targetsById}
    /> : null}
  </li>;
}
```

Export a dialog that derives status from the projection, falling back to the existing status and then `merge-uninvestigated`. It must render:

```tsx
<Dialog
  open={open}
  onClose={onClose}
  title={<span className="ui-dialog__title-text">merge investigation · {commit.sha.slice(0, 7)}</span>}
  meta={<dl className="ui-dialog__meta">
    <div><dt>status</dt><dd>{status}</dd></div>
    <div><dt>source range</dt><dd>{range}</dd></div>
    <div><dt>attribution</dt><dd>{sourceCount} source · {mergeCount} merge</dd></div>
  </dl>}
>
  <div className="merge-investigation-dialog" data-bisect-merge-dialog={commit.sha}>
    {status !== 'complete' ? <div className="merge-investigation-dialog__state">
      <strong>{nonCompleteStateCopy(status)}</strong>
      {status === 'failed' && investigation?.failure ? <p>{investigation.failure}</p> : null}
    </div> : null}
    {investigation?.sourceCommits.length ? <ol className="merge-source-trace">
      {investigation.sourceCommits.map((sourceCommit) => <MergeSourceCommitRow
        key={sourceCommit.sha}
        sourceCommit={sourceCommit}
        targetsById={targetsById}
        showAttribution={status === 'complete'}
      />)}
    </ol> : null}
    {status === 'complete' && mergeCount > 0 ? <section className="merge-introduced-panel">
      <h3>introduced by merge</h3>
      <MergeRegressionList
        targetIds={investigation?.mergeIntroducedTargetIds ?? []}
        targetsById={targetsById}
      />
    </section> : null}
    {status === 'complete' && sourceCount === 0 && mergeCount === 0
      ? <p className="merge-investigation-dialog__empty">No attributable source regressions.</p>
      : null}
  </div>
</Dialog>
```

`nonCompleteStateCopy` must use an exhaustive switch over the four non-complete statuses; do not index with an unsafe cast. `sourceCount` is the sum of source row target IDs only when status is complete. `mergeCount` is `mergeIntroducedTargetIds.length` only when complete. `range` is the short merge-base-to-second-parent range or `unavailable`.

- [ ] **Step 4: Render the inactive dialog beside merge nodes**

Import the component in `BisectNavigator.tsx` and render it after the merge button with `open={false}` and a module-level no-op close callback. This isolates content rendering from interaction until Task 4's browser RED test exists.

- [ ] **Step 5: Run GREEN, typecheck, and commit**

```bash
yarn workspace shaka-perf test --runInBand src/compare/bisect/__tests__/app-report.test.ts
yarn workspace shaka-perf typecheck
git add packages/shaka-perf/report-shell/src/components/MergeInvestigationDialog.tsx \
  packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx \
  packages/shaka-perf/src/compare/bisect/__tests__/app-report.test.ts
git commit -m "feat(compare): render merge investigation details"
```

---

### Task 4: Wire interaction and industrial trace styling

**Files:**
- Modify: `packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx`
- Modify: `packages/shaka-perf/report-shell/src/styles.css`
- Test: `packages/shaka-perf/test/compare/bisect-report-ui_spec.ts`

**Interfaces:**
- Consumes: Task 3's component and existing native `Dialog` behavior.
- Produces: select-and-open behavior, `aria-haspopup`, focus restoration, and responsive visual hierarchy.

- [ ] **Step 1: Write the failing browser interaction test**

Add source SHAs and a complete projection to the `VISUAL_SHA` fixture. After clicking the merge node, assert:

```ts
const mergeDialog = page.locator('.ui-dialog[open]').filter({
  has: page.locator(`[data-bisect-merge-dialog="${VISUAL_SHA}"]`),
});
await expectCount(mergeDialog, 1);
expect(await visualNode.getAttribute('aria-pressed')).toBe('true');
await expectText(mergeDialog, 'prepare source branch');
await expectText(mergeDialog, 'introduce hero regression');
await expectText(mergeDialog.locator('[data-merge-source-result="responsible"]'), 'hero diff');
await expectCount(mergeDialog.locator('[data-merge-source-result="clear"]'), 1);
await page.keyboard.press('Escape');
await expectCount(page.locator('.ui-dialog[open]'), 0);
expect(await visualNode.evaluate((element) => element === document.activeElement)).toBe(true);
expect(await visualNode.getAttribute('aria-pressed')).toBe('true');
```

In the keyboard test, require Enter to open the modal, close with Escape, then run the 430px assertions. Require the dialog surface and document scroll width to stay within 430px.

- [ ] **Step 2: Run RED**

```bash
yarn workspace shaka-perf test --runInBand test/compare/bisect-report-ui_spec.ts
```

Expected: FAIL because the Task 3 dialog is permanently closed.

- [ ] **Step 3: Implement combined selection and modal state**

Inside `CommitNode`:

```tsx
const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
const handleClick = useCallback(() => {
  onSelect({ kind: 'commit', sha: commit.sha });
  if (commit.isMerge) setMergeDialogOpen(true);
}, [commit.isMerge, commit.sha, onSelect]);
const handleMergeDialogClose = useCallback(() => setMergeDialogOpen(false), []);
```

Add `aria-haspopup={commit.isMerge ? 'dialog' : undefined}` to the button. Replace the inactive dialog with `open={mergeDialogOpen}` and `onClose={handleMergeDialogClose}`. Ordinary commits continue through the same handler but never open a dialog.

- [ ] **Step 4: Add scoped modal CSS**

Use the existing CSS variable names discovered at implementation time; do not add literal theme colors. Implement these rules:

```css
.merge-investigation-dialog { min-width: min(52rem, calc(100vw - 5rem)); }
.merge-source-trace {
  display: grid; margin: 0; padding: 0 0 0 1.5rem; list-style: none;
}
.merge-source-commit {
  position: relative; border: 1px solid var(--border-strong);
  border-bottom: 0; padding: 1rem; background: var(--bg);
}
.merge-source-commit:last-child { border-bottom-width: 1px; }
.merge-source-commit::before {
  position: absolute; inset: 0 auto 0 -1.5rem; width: 3px;
  background: var(--fg); content: '';
}
.merge-source-commit[data-merge-source-result="responsible"] {
  border-color: var(--fg); background: var(--fg);
  color: var(--bg);
}
.merge-source-commit[data-merge-source-result="clear"] {
  background-image: repeating-linear-gradient(-45deg, transparent 0 8px,
    color-mix(in srgb, var(--border-strong) 18%, transparent) 8px 9px);
}
.merge-source-commit > header {
  display: grid; grid-template-columns: auto minmax(12rem, 1fr) auto auto;
  gap: .75rem; align-items: baseline;
}
.merge-regression-list {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: .75rem; margin-top: 1rem;
}
.merge-introduced-panel {
  margin-top: 1rem; border: 2px solid var(--regression); padding: 1rem;
}
@media (max-width: 720px) {
  .merge-investigation-dialog { min-width: 0; }
  .merge-source-commit > header,
  .merge-regression-list { grid-template-columns: 1fr; }
}
```

Add compact uppercase badges and list spacing consistent with `.bisect-node__merge` and `.bisect-clean-run-dialog`. Ensure responsible-row text contrast is at least 4.5:1.

- [ ] **Step 5: Run GREEN and commit**

```bash
yarn workspace shaka-perf test --runInBand \
  test/compare/bisect-report-ui_spec.ts \
  src/compare/bisect/__tests__/app-report.test.ts
git add packages/shaka-perf/report-shell/src/components/BisectNavigator.tsx \
  packages/shaka-perf/report-shell/src/styles.css \
  packages/shaka-perf/test/compare/bisect-report-ui_spec.ts
git commit -m "feat(compare): open merge investigation modal"
```

---

### Task 5: Verify and review the exact final head

**Files:**
- Verify only; modify code only when a failing check exposes a defect, with a new failing regression test first.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: completion evidence for model truthfulness, parser compatibility, UI semantics, interaction, accessibility, layout, and repository policy.

- [ ] **Step 1: Run the complete focused suite**

```bash
yarn workspace shaka-perf test --runInBand \
  src/compare/bisect/__tests__/report-model.test.ts \
  test/compare/report-data_spec.ts \
  src/compare/bisect/__tests__/app-report.test.ts \
  test/compare/bisect-report-ui_spec.ts
```

Expected: all four suites PASS without new console errors.

- [ ] **Step 2: Run package typecheck and production report build**

```bash
yarn workspace shaka-perf typecheck
yarn workspace shaka-perf build-report-shell
```

Expected: both exit 0 and Vite emits the single-file report shell.

- [ ] **Step 3: Perform visual QA**

Temporarily set the browser fixture's Chromium launch to `headless: false`, run `test/compare/bisect-report-ui_spec.ts`, and inspect 1280×900 and 430×900. Confirm the responsible commit dominates, clean commits remain readable, merge-introduced results are distinct, text does not clip, and no horizontal overflow appears. Revert only the temporary `headless` change before continuing; it must never be committed.

- [ ] **Step 4: Run repository validation**

```bash
PATH=/Users/ramezweissa/.rbenv/shims:$PATH .agents/bin/validate
```

Expected: build, typecheck, all package tests, and demo production builds PASS. Existing baseline deprecation warnings are acceptable; new errors are not.

- [ ] **Step 5: Audit cleanliness**

```bash
git diff --check
git status --short
git log --oneline --max-count=8
```

Expected: the first two commands emit nothing and feature commits appear above `f403b407`.

- [ ] **Step 6: Request final code review**

Use `superpowers:requesting-code-review` against the exact final head. Require review against the approved spec, report-model truthfulness, backward compatibility, React semantics, focus behavior, responsive styling, and coverage. Address findings test-first and repeat until approved.
