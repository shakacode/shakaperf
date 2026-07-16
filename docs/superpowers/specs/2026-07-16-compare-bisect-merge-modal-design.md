# Compare Bisect Merge Investigation Modal Design

## Goal

Make every merge commit in the compare-bisect navigator explorable. Clicking a
merge block must preserve the existing commit selection/filtering behavior and
also open a modal that shows the investigated source-branch commits, clearly
identifies the commit or nested merge responsible for each regression, and
separately explains regressions introduced only by the merge result.

The feature extends the existing report artifact. It must not rerun a bisect,
read Git at report-view time, or expose the persisted session schema directly to
the React application.

## Current-State Decision

The review worktree is clean. The three changes shown relative to the remote
branch are committed, unpushed commits rather than uncommitted files, so there
is no pre-existing work to commit before this feature.

The report already has:

- primary merge nodes and per-target merge outcomes;
- child investigation phases with ordered commits, subjects, parents, attempts,
  and first-bad results;
- an accessible native `Dialog` component used by clean commit groups; and
- an industrial, print-like bisect navigator visual language.

The missing boundary is a report-specific child-investigation view model. The
current flattened target fields reveal a responsible source SHA but cannot show
all source commits or their subjects.

## Interaction

### Merge node activation

Activating a merge node by pointer or keyboard performs two actions together:

1. select the mainline merge so the existing regression cards below remain
   filtered to that commit; and
2. open its merge investigation modal.

Non-merge commit nodes retain their existing selection-only behavior. A merge
node declares `aria-haspopup="dialog"`; the modal uses the existing `Dialog`
component for focus transfer, focus restoration, Escape handling, close button,
and backdrop dismissal.

Closing the modal does not clear the selected merge. Reopening it does not
change the selected target set.

### Modal information hierarchy

The modal title identifies the mainline merge by short SHA. Its metadata shows:

- investigation status;
- source range, from merge base to second parent when available; and
- the number of regressions attributed to source commits versus the merge
  result itself.

The body is a compact vertical source trace ordered from oldest to newest. The
merge base is context in the modal metadata, not a source commit row. Each row
after the merge base shows:

- short SHA and commit subject;
- measured/not-measured state;
- a nested-merge badge when the source result is itself a merge; and
- an attribution state.

Responsible rows receive strong visual emphasis and list their attributed
regressions grouped by category. Each regression entry includes the test name,
viewport when present, and target subject (metric, rule, or visual comparison).
Rows with no first-bad regressions remain visible but visually subdued so the
user can understand the investigated path rather than only the answer.

Targets classified as `merge-introduced` cannot truthfully be assigned to a
source commit. They appear in a distinct "introduced by merge" panel beneath
the source trace and use the same category/test/subject presentation.

## Report Model

`BisectReportCommit` gains an optional report-owned investigation object rather
than exposing `MergeInvestigation` directly:

```ts
interface BisectReportMergeInvestigation {
  status: MergeInvestigation['status'];
  failure?: string;
  mergeBase?: string;
  secondParent?: string;
  sourceCommits: BisectReportMergeSourceCommit[];
  mergeIntroducedTargetIds: string[];
}

interface BisectReportMergeSourceCommit {
  sha: string;
  subject: string;
  measured: boolean;
  isMerge: boolean;
  targetIds: string[];
  counts: BisectReportCounts;
}
```

`buildBisectReportModel` derives this data from the investigation phase and its
target results:

- the phase good SHA becomes `mergeBase`;
- the phase bad SHA becomes `secondParent`;
- phase commits after the good SHA become `sourceCommits`;
- `source-found` and `nested-merge` target results are assigned to their
  `sourceSha` row;
- `merge-introduced` target results populate
  `mergeIntroducedTargetIds`; and
- measurement state comes from completed phase attempts, not primary
  `commitRuns`, because child investigations own their own attempt history.

The model preserves source commits with zero attributed targets. It also keeps
status and failure information when no child phase exists. The report-shell Zod
schema validates the new optional payload while continuing to accept older
reports without it.

## React Components

`CommitNode` owns only the open/closed state and its combined select/open click
handler. Merge-specific presentation is extracted into focused components:

- `MergeInvestigationDialog` renders metadata, states, and the source trace;
- `MergeSourceCommitRow` renders one child commit and its attribution; and
- `MergeRegressionList` renders target details consistently for responsible
  source rows and the merge-introduced panel.

These components consume the report view model only. They perform no fetching,
session interpretation, or derived-state effects. Static arrays and labels are
defined outside components, and category grouping is computed directly from
the supplied IDs.

## Visual Direction

The modal extends the report's existing industrial trace aesthetic rather than
introducing a separate design system:

- squared borders, monospace labels, and existing category colors;
- a strong left rail connecting ordered source commits;
- solid dark emphasis for responsible commits;
- quiet hatched or pale treatment for non-responsible commits; and
- a visually separate merge-result panel so attribution is never ambiguous.

The modal is wider than the clean-run dialog but remains bounded by the viewport.
The source trace scrolls inside the dialog body when long. At narrow widths,
metadata stacks and regression details wrap without horizontal page overflow.
Motion is limited to the existing dialog transition and respects the report's
current reduced-motion behavior.

## Non-Complete States

The modal always explains the current state:

- `merge-uninvestigated`: no source attribution is available yet;
- `running`: show available source-range context plus an in-progress message,
  without presenting partial evidence as a confirmed responsible commit;
- `failed`: show the persisted failure message and retain the mainline result;
- `octopus-unsupported`: explain that source attribution is unavailable for a
  merge with more than two parents; and
- `complete`: show the source trace and merge-introduced panel as applicable.

Missing optional investigation data in an older report is treated as not
investigated. Empty complete investigations render an explicit "no attributable
source regressions" state rather than a blank modal.

## Testing

Implementation follows red-green-refactor cycles. Coverage includes:

1. report-model tests proving source ordering, merge-base exclusion, child
   attempt measurement state, source/nested-merge attribution, clean source
   commits, and merge-introduced separation;
2. payload parsing tests for the optional investigation view model and backward
   compatibility;
3. static React rendering tests for dialog semantics, status states, commit
   subjects, responsible markers, regression details, and nested-merge labels;
4. browser acceptance tests proving a merge click both selects the node and
   opens the modal, keyboard activation works, the responsible commit is
   visible, and closing restores focus without clearing selection; and
5. focused package tests, TypeScript/build validation, the repository validation
   command, and `git diff --check`.

No verification command runs a real compare-bisect pipeline.

## Scope Boundaries

This change does not add deeper recursive investigation, links to external Git
hosts, live Git queries, modal-side filtering, or changes to bisect scheduling.
It reports the one-level investigation evidence already persisted by the branch.

