# Compare Bisect V0 Design

Status: Draft for user review

## Summary

Add `shaka-perf compare bisect [good-ref] [bad-ref]`. The command repeatedly
checks out candidate commits in the configured experiment checkout, refreshes
the running experiment twin server, runs narrowed compare measurements, and
finds the first commit that introduced each visual, performance, and
accessibility regression observed at the bad ref.

The control server remains fixed for the entire session. V0 assumes each
regression is monotonic between the good and bad refs.

## Goals

- Find a first bad commit for every regression target present at the bad ref.
- Track visual, performance, and accessibility targets independently.
- Run one candidate comparison for all active targets that can use it.
- Narrow categories and AB-test files as target intervals diverge.
- Preserve category-specific measurements, not only binary classifications.
- Refresh the experiment quickly with configured commands when possible.
- Fall back to rebuilding the experiment image when an in-place refresh fails.
- Restore the user's original experiment checkout and running server state.
- Persist enough state to inspect completed or interrupted sessions.

## Non-goals

- Handling regressions that are fixed and later reintroduced.
- Searching unrelated Git branches or histories containing merge commits.
- Mutating or rebuilding the control side.
- Automatically stashing a dirty experiment worktree.
- An HTML bisect dashboard in V0.
- Resuming an interrupted search in V0. Persisted state is diagnostic only.

## Command

```bash
shaka-perf compare bisect [good-ref] [bad-ref]
```

The command is a child command of `compare`. It reuses compare options including
`--config`, `--categories`, `--filter`, `--testPathPattern`, and `--headed`.

- `good-ref` defaults to the configured control checkout's `HEAD` SHA.
- `bad-ref` defaults to the configured experiment checkout's `HEAD` SHA.
- User-supplied refs are resolved to full immutable SHAs before the session.
- The command refuses to start unless the control checkout SHA equals the
  resolved good SHA.
- The good SHA must be an ancestor of the bad SHA.
- V0 requires one linear ancestry path from good to bad and rejects any merge
  commit in the candidate range.

## Configuration

Add an optional top-level `bisect` section to `abtests.config.ts`:

```ts
bisect: {
  rebuildCommands: [
    {
      description: 'Rebuild application assets',
      command: 'yarn build',
    },
  ],
  rebuildContainer: false,
}
```

`rebuildCommands` uses the existing command object shape and executes
sequentially inside the experiment container.

Refresh strategy resolution:

1. `rebuildContainer: true`: rebuild and recreate the experiment container for
   every candidate. Configured rebuild commands are not run.
2. Commands exist and `rebuildContainer` is false or absent: run commands and
   restart the experiment process in place. If commands or the health check
   fail, rebuild the experiment image/container and retry startup once.
3. No commands exist: rebuild and recreate the experiment container for every
   candidate.

The parsed config owns the default values: `rebuildCommands: []` and
`rebuildContainer: false`.

## Preconditions

Before changing state, the command:

1. Requires `twinServers` config.
2. Requires an active `shaka-perf servers` menu session for the project.
3. Resolves the control and experiment checkout directories.
4. Requires a clean experiment worktree, including no untracked files.
5. Records the original experiment branch, SHA, and whether it was detached.
6. Resolves and validates the good and bad refs.
7. Loads and freezes the parsed config and AB-test definitions from the command
   invocation checkout before the first candidate checkout.
8. Acquires a bisect session lease from twin-servers so menu auto-sync and other
   lifecycle actions cannot race the search.

The command does not automatically stash, discard, or commit user changes.

## Regression Targets

The first bad-ref comparison discovers targets. Each target has a stable ID and
category-specific values.

### Visual

Identity:

```text
test file + test identity + viewport + screenshot selector
```

Stored values include mismatch percentage, diff pixels, configured threshold,
image artifact paths, and retry-stability state. A target is present when the
matching screenshot artifact has a non-null diff image.

### Performance

Identity:

```text
test file + test identity + viewport + metric label
```

Stored values include numeric control and experiment medians, formatted values,
absolute delta, percentage delta, p-value, and direction. The existing perf
artifact model must expose the numeric values it already reads from the bench
report rather than retaining only formatted strings. A target is present when
the matching metric is classified as a regression.

### Accessibility

Identity:

```text
test file + test identity + viewport + axe rule ID
```

Stored values include control and experiment violation counts, affected-node
counts, impact, and matching artifact paths. DOM target fingerprints do not
participate in target identity. A target is present when the rule has at least
one `new` or `changed` finding for that test and viewport.

## Persistent Session Model

Write V0 output under:

```text
compare-bisect-results/
  session.json
  summary.json
  commits/<sha>/compare-results/...
```

The implementation adds `compare-bisect-results/` to the repository's ignored
runtime-output paths so session artifacts do not dirty the checkout during the
search.

`session.json` is rewritten atomically after every state transition. It stores:

```ts
interface BisectSession {
  version: 1;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  goodSha: string;
  badSha: string;
  originalExperiment: {
    sha: string;
    branch: string | null;
  };
  selectedCategories: BisectCategory[];
  orderedCommits: string[];
  targets: BisectTarget[];
  commitRuns: Record<string, CommitRun>;
  startedAt: string;
  finishedAt?: string;
  failure?: string;
}
```

Each target stores its good and bad boundary indexes into `orderedCommits`, its
status, optional first bad SHA, and observations keyed by commit SHA.

Each commit run stores requested categories, requested test files, refresh mode,
fallback use, compare result path, timestamps, and infrastructure errors.

`summary.json` is the stable final machine-readable result. The terminal prints
the same information grouped by category, AB-test file, test, viewport, and
target metric/rule/selector.

## Search Algorithm

### Endpoint measurements

1. Checkout and measure the bad ref against the fixed control using all selected
   categories and user filters.
2. Create one target for every observed bad-ref regression.
3. Checkout and measure the good ref, narrowed to the discovered target files
   and categories.
4. Mark a target invalid if it is still present at the good ref. Invalid/noisy
   targets are reported but never searched.
5. Seed every valid target with the full `[goodIndex, badIndex]` interval.

If the bad ref contains no targets, the command restores the experiment and
finishes successfully with an empty summary.

### Candidate scheduling

The scheduler orders active targets by category priority:

```text
visreg -> perf -> accessibility
```

For the highest-priority active target, choose the midpoint of its current
interval. At that candidate, include every active target whose interval contains
the candidate. Group the run by the union of their categories and AB-test files.

The candidate comparison produces an observation for every requested target:

- Present: set the target's bad boundary to the candidate.
- Absent: set the target's good boundary to the candidate.
- Missing because its category/test did not execute successfully: leave both
  boundaries unchanged and fail the candidate run.

Targets can move in opposite directions after one candidate. Their intervals
remain independent. The scheduler continues prioritizing active visual targets;
perf and accessibility intervals retain every boundary update learned during
those visual rounds.

When a target's good and bad boundary indexes are adjacent, the bad boundary is
its first bad commit and its status becomes `found`.

### Observation reuse

Observations are keyed by commit SHA and target ID. Before a candidate run, the
scheduler subtracts already-known observations. If all required observations
exist, it updates intervals without rebuilding or comparing that commit.

If only part of a commit is known, the next run requests only missing categories
and AB-test files. This is the mechanism that narrows work as search branches
diverge.

## Checkout and Volume Synchronization

The experiment checkout is the candidate workspace.

At session start, the synchronizer establishes a trustworthy volume baseline.
If a volume marker already matches the original experiment SHA, it can continue
from that marker. Otherwise it reconciles the complete set of files from the
recorded experiment image manifest against the original checkout, removes stale
manifest-owned paths, copies current files, and then writes the marker. It does
not delete generated or dependency paths that the image manifest does not own.

For each transition from `previousSha` to `candidateSha`:

1. Calculate the Git name-status delta between the two SHAs.
2. Checkout `candidateSha` detached in the experiment directory.
3. Copy added, modified, and renamed paths from the checked-out tree into the
   experiment bind-mount volume.
4. Delete removed and rename-source paths from the volume.
5. Preserve file modes and create parent directories as needed.
6. Ignore paths excluded from the experiment image's recorded build manifest.
7. Atomically write a volume marker containing the materialized candidate SHA.

This is an explicit synchronization step. V0 does not rely on the existing
working-tree `sync-changes` command or asynchronous menu watcher to determine
when candidate files are ready.

The twin-server bisect lease pauses auto-sync while the session is active.

## Experiment Refresh

### In-place path

1. Execute configured rebuild commands sequentially in the experiment
   container.
2. Restart only experiment-owned Overmind processes.
3. Wait for the experiment URL to become healthy and remain stable for the
   normal readiness settle period.

### Container path

1. Build only the experiment image from the currently checked-out candidate.
2. Stop only experiment-owned Overmind processes.
3. Recreate only the experiment container and experiment bind volume.
4. Run setup commands only in the experiment container.
5. Start only experiment-owned Overmind processes.
6. Wait for the experiment URL health check.

The control image, container, volume, and process are never touched.

The existing twin-server lifecycle currently rebuilds and recreates both sides,
so V0 introduces experiment-only lifecycle primitives rather than calling the
current broad operations.

## Compare Execution

The bisect command invokes the compare pipeline in-process so it can reuse
parsed config, frozen tests, and typed stage measurements.

Required pipeline changes:

- Accept a frozen test-definition override instead of reloading tests from the
  candidate checkout.
- Accept an artifact root so each candidate writes under its own directory.
- Return or expose typed per-test/per-viewport outcomes to the bisect analyzer.
- Preserve existing standalone `shaka-perf compare` behavior.

Every candidate uses the fixed control URL and experiment URL. Categories and
test files come from the scheduler's missing-observation set. Existing compare
thresholds remain the only regression-classification authority.

## Failure Handling

- A rebuild command failure triggers one experiment-container fallback.
- An experiment startup or health-check failure triggers one container fallback.
- A fallback build/start failure aborts the search.
- A stage/infrastructure error aborts that candidate without classifying it.
- V0 does not implement `git bisect skip`; it fails rather than deriving a
  boundary from incomplete evidence.
- A measurement regression is normal data and never triggers infrastructure
  fallback.

On `SIGINT`, `SIGTERM`, or an exception, cleanup runs once:

1. Checkout the original experiment branch or detached SHA.
2. Explicitly synchronize the original tree back into the experiment volume.
3. Refresh the experiment server, using container rebuild if required.
4. Release the twin-server bisect lease and resume auto-sync.
5. Persist `interrupted` or `failed` session status.

Cleanup errors are reported in addition to the original error and never hide it.

## Components

V0 introduces focused modules with single responsibilities:

- `compare/bisect/cli.ts`: command definition and option resolution.
- `compare/bisect/session.ts`: orchestration, persistence, and cleanup.
- `compare/bisect/search.ts`: pure target interval scheduler.
- `compare/bisect/analyze.ts`: stage outcomes to target observations.
- `compare/bisect/git.ts`: ref validation, ordered commits, clean checks, and
  detached checkout transitions.
- `compare/bisect/sync.ts`: explicit checkout-to-volume delta synchronization.
- `compare/bisect/types.ts`: persisted versioned model.
- Twin-server experiment-only refresh and lease modules behind a typed IPC
  request.

The analyzer owns category-specific target extraction polymorphically. Shared
search code does not switch on target names or metric names.

## Testing

### Pure unit tests

- Config defaults and refresh-strategy resolution.
- Target identity and category-specific observation extraction.
- Numeric perf value preservation.
- Accessibility grouping by rule ID, test, and viewport.
- Independent interval updates when categories or test files disagree.
- Visreg-first scheduling.
- Observation reuse and missing-work narrowing.
- Adjacent-boundary completion.
- Invalid target detection at the good endpoint.
- Atomic session serialization and version validation.

### Git fixture tests

Create temporary linear repositories to verify:

- Default and explicit ref resolution.
- Control/good mismatch rejection.
- Non-ancestor and unsupported-history rejection.
- Dirty experiment checkout rejection.
- Added, modified, renamed, deleted, and executable files synchronize correctly.
- Original branch/SHA restoration after success and simulated interruption.

### Twin-server tests

Mock Docker/Overmind boundaries to verify:

- Commands run only in experiment.
- Experiment-only restart leaves control untouched.
- Command and health-check failures trigger exactly one container fallback.
- Forced container mode skips rebuild commands.
- Missing commands select container mode.
- Lease pauses auto-sync and rejects competing lifecycle work.

### Pipeline integration tests

- Frozen test definitions survive candidate checkout changes.
- Per-candidate artifact roots do not overwrite each other.
- Typed outcomes produce visual, perf, and accessibility targets.
- Filtered candidate runs execute only requested categories and files.

### Demo acceptance

Against the dedicated demo seed-history branch, a full V0 run must report the
documented first bad commit for visual, performance, and accessibility targets,
including their affected AB-test files and category-specific values.

## V0 Completion Criteria

V0 is complete when:

- `shaka-perf compare bisect` implements the command and config contract.
- The search finds independent first bad commits for every valid bad-ref target.
- Candidate runs narrow categories and AB-test files and reuse observations.
- Both refresh strategies and fallback behavior work without mutating control.
- Success, failure, and cancellation restore the experiment checkout/server.
- JSON output records target values, observations, and first bad commits.
- Focused unit/integration tests pass.
- The demo seed history verifies the expected category results end to end.
