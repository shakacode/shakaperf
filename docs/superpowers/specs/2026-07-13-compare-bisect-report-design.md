# Compare Bisect Report Design

Status: Approved for implementation

## Summary

Add a self-contained `compare-bisect-results/bisect-report.html` that combines
the existing compare report cards from the bad-ref measurement with a commit
tree for the bisect result. Each commit node shows how many visual,
performance, and accessibility targets were first introduced there. Selecting
a node focuses the bad-ref cards containing those targets and limits their
visible stage sections to the affected categories.

The report is generated from data already collected by the current bisect
session. It does not check out commits, restart servers, or invoke compare.

## Goals

- Show the complete good-to-bad commit range as an ordered tree/timeline.
- Show first-bad regression counts per category on every commit node.
- Filter the existing bad-ref compare cards by the selected commit.
- Preserve rich bad-ref screenshots, metrics, accessibility findings, and
  artifact dialogs in the filtered cards.
- Represent found, unresolved, and invalid regression targets explicitly.
- Produce one portable HTML file inside `compare-bisect-results/`.
- Refresh the HTML from in-memory session state as the bisect progresses.

## Non-goals

- Running or rerunning compare measurements for report generation.
- Reconstructing a complete compare report for every midpoint commit.
- Showing Git branches or merge topology; compare bisect already requires a
  linear ancestry path.
- Adding a separate command to rebuild a report from an old session.
- Persisting enough source compare data to resume report generation in another
  process.

## Data Sources

The report has two data sources from the active process:

1. The bad-ref `TestResult[]` returned by the initial compare measurement or
   loaded by `--reuse-current-results`. These are the cards and artifacts shown
   in the report.
2. The current `BisectSession`, including ordered commits, targets,
   observations, statuses, and first-bad SHAs.

No midpoint `TestResult[]` is embedded. Midpoint runs are intentionally narrowed
to only active categories and test files, so combining them would produce an
incomplete and inconsistent card set.

The prepared Git range also records each commit subject. Session persistence
stores that metadata so the report remains understandable after the experiment
checkout is restored.

## Report Model

The HTML payload extends the normal compare `ReportData` with a bisect section:

```ts
interface BisectReportModel {
  status: BisectSession['status'];
  goodSha: string;
  badSha: string;
  generatedAt: string;
  commits: BisectReportCommit[];
  targets: BisectReportTarget[];
}

interface BisectReportCommit {
  sha: string;
  subject: string;
  position: number;
  measured: boolean;
  counts: Record<BisectCategory, number>;
  targetIds: string[];
}

interface BisectReportTarget {
  id: string;
  category: BisectCategory;
  testId: string;
  testFile: string;
  testName: string;
  viewport: string;
  subject: string;
  status: TargetStatus;
  firstBadSha?: string;
  invalidReason?: string;
  badRefObservation?: TargetObservation;
}
```

`testId` is resolved against the bad-ref card set by the stable combination of
test file and test name. A commit count includes only `found` targets whose
`firstBadSha` equals that commit. Unresolved and invalid targets are kept in
separate synthetic views rather than assigned to a commit.

## Generation

The bisect layer owns a report-model builder and writer. The generic pipeline
report renderer continues to own HTML-template injection and stage-specific
lightweight artifact stripping.

After bad-ref target discovery, every normal session persistence point writes:

1. `session.json`
2. `bisect-report.html`, using the latest session plus the retained bad-ref
   compare data

Terminal cleanup performs one final report write after the session reaches
`complete`, `interrupted`, or `failed`. Report-write failures are treated like
other persistence failures and are surfaced rather than silently ignored.

The report uses the lightweight stage strippers so all renderable artifacts are
inlined. The output file therefore remains usable without the sibling commit
artifact directories.

## User Interface

The existing terminal-brutalist compare report remains the visual foundation.
A new bisect navigator appears between the report header and existing search
and filter controls.

### Summary Strip

The strip shows the range, current session status, total found targets, and
unresolved/invalid totals. It also provides an `All regressions` selection that
restores the full bad-ref card set.

### Commit Tree

The linear range renders left to right on wide screens and vertically on narrow
screens. Each node includes:

- seven-character SHA
- commit subject
- measured/unmeasured state
- compact category counters for visual, performance, and accessibility

Good and bad endpoints are labelled. Nodes without first-bad targets remain
visible but subdued so the search path and clean commits are clear. A selected
node receives a strong focus state and exposes an accessible pressed state.

### Filtering

Selecting a commit derives the set of target IDs whose `firstBadSha` matches the
commit, then derives the matching bad-ref test-card IDs.

- Matching cards move first and render at full opacity.
- Non-matching cards remain in the grid but are dimmed, consistent with the
  existing chip-filter behavior.
- Visible stage sections are intersected with the selected targets' categories:
  `visreg`, `perf`, and/or `accessibility`.
- A compact selection summary above the cards lists the exact target subjects,
  viewports, and counts.
- Existing search, chip, sort, accessibility, and stage controls continue to
  refine the focused card set.

Separate `Unresolved` and `Invalid` selections focus those target sets. Invalid
targets display their reason. A node with zero first-bad targets is selectable
and produces a clear empty selection state rather than silently restoring all
cards.

## Component Boundaries

- `compare/bisect/report.ts`: builds and writes the bisect report payload.
- `compare/bisect/report-model.ts`: pure mapping from session plus bad-ref cards
  to commit and target view models.
- `report-shell/components/BisectNavigator.tsx`: commit tree, totals, and
  selection controls.
- `report-shell/components/BisectSelectionSummary.tsx`: selected target detail.
- `report-shell/App.tsx`: owns the selected bisect view and composes its card and
  stage focus with existing filters.
- `report-shell/styles.css`: responsive tree and selection styling within the
  existing report visual language.

The report-model builder remains independent from React and filesystem I/O so
its grouping and identity rules can be tested directly.

## Error Handling

- A target that cannot be mapped to a bad-ref card remains visible in the
  selection summary and contributes to counts, but no card is focused for it.
- Unknown or missing commit subjects fall back to the short SHA.
- Missing bad-ref observations omit value details without hiding the target.
- Invalid report payloads keep the existing `no report data` fallback.
- Report write failures fail persistence with the output path in the error.

## Testing

- Unit-test report-model grouping, category counts, card identity mapping,
  unresolved/invalid views, and clean commits.
- Unit-test persistence integration so the report is written only after bad-ref
  data exists and is refreshed at later session transitions.
- Unit-test navigator selection and App-level card/stage focusing with static
  report data.
- Build the single-file report shell.
- Generate a synthetic `bisect-report.html` directly from fixture data, without
  invoking compare, and inspect it with Playwright for node counts, selection,
  card dimming, stage filtering, and narrow-screen layout.

## Output

```text
compare-bisect-results/
  bisect-report.html
  session.json
  summary.json
  decision-log.md
  decision-log.jsonl
  commits/<sha>/...
```

The CLI prints the bisect report path beside the summary and decision-log paths
when the report has been created.
