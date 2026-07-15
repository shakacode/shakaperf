# Compare Bisect

`shaka-perf compare bisect [good-ref] [bad-ref]` repeatedly runs the unified
compare pipeline against candidate experiment commits and reports the first
commit that introduced each regression observed at the bad ref.

The command is designed for local, deterministic investigation after a normal
`compare` run shows a visual, performance, or accessibility regression. It does
not replace `git bisect`; it adds compare-aware target discovery, persistence,
and category-specific analysis on top of a stable twin-server setup.

## When to Use It

Use compare bisect when:

- You have an A/B twin-server setup with control and experiment checkouts.
- A known good ref and known bad ref can bracket the regression.
- The regression is expected to be monotonic: absent at the good ref, present at
  the bad ref, and introduced by one commit in between.
- You want first-bad answers for individual compare targets, not a single
  repository-wide good/bad verdict.

## Basic Flow

Compare bisect requires clean control and experiment worktrees, an experiment
build manifest, and an active twin-server menu. Generate the manifest before a
first run or after removing the experiment volume:

```bash
yarn shaka-perf servers build --target experiment
```

Then start the twin-server menu:

```bash
yarn shaka-perf servers
```

Then run bisect from the invocation checkout:

```bash
yarn shaka-perf compare bisect
```

With no refs, `good-ref` defaults to the configured control checkout's `HEAD`
and `bad-ref` defaults to the configured experiment checkout's `HEAD`. If only
`good-ref` is supplied, only `bad-ref` uses its default. The control checkout
must remain at the resolved good SHA for the whole run.

Explicit refs and optional category narrowing work the same way as `compare`:

```bash
yarn shaka-perf compare bisect <good-ref> <bad-ref> --categories visreg,perf
```

To iterate without repeating the initial bad-ref comparison, reuse the current
`compare-results/` tree:

```bash
yarn shaka-perf compare bisect <good-ref> <bad-ref> \
  --categories accessibility \
  --reuse-current-results
```

`--reuse-current-results` applies only to bad-ref target discovery. Good-ref
validation, when explicitly enabled, and every midpoint still rebuild and run
compare normally. The selected categories must already have persisted outcomes in
`compare-results/`; otherwise the command fails with the compare command to run
first.

By default, bisect trusts the control checkout as the good endpoint and starts
with the first midpoint. To additionally rebuild the experiment at `good-ref`
and compare both sides before midpoint search, opt in with:

```bash
yarn shaka-perf compare bisect <good-ref> <bad-ref> --validate-good-ref
```

This extra validation can detect control/experiment environment asymmetry, but
it adds another full compare run and is not required for the normal fixed-control
workflow.

The command cannot infer which experiment commit produced a saved
`compare-results/` tree. When reusing results, pass the matching `bad-ref`
explicitly if it differs from the configured experiment checkout's current
`HEAD`. The default refs are resolved from the control and experiment Git
checkouts, not from stale container contents or saved artifacts.

To preview discovery and the next action without starting the search, add
`--dry-run`:

```bash
yarn shaka-perf compare bisect <good-ref> <bad-ref> \
  --categories accessibility \
  --reuse-current-results \
  --dry-run
```

A dry run stops immediately after bad-ref target discovery. It prints every
discovered category, test, viewport, and metric/rule/selector, then shows the
first midpoint that a normal run would measure next, including its narrowed
categories and exact AB tests, identified by test file plus test name. When
`--validate-good-ref` is also passed, the preview shows that validation as the
next action instead. `summary.json` and
`session.json` record `dryRun: true`, `validateGoodRef`, and the structured
`nextAction`.

`--dry-run` does not measure the good ref or any midpoint commit. Without
`--reuse-current-results`, it still checks out, rebuilds, and compares the bad
ref so it can discover targets, then restores the original experiment checkout.
Combining both flags is the fast artifact-preview path: it loads the selected
outcomes from `compare-results/` and performs no candidate checkout, rebuild, or
compare run.

Results are written under `compare-bisect-results/`:

- `session.json` is diagnostic state recording the range, targets, observations,
  candidate runs, and infrastructure errors. V0 cannot resume a run from it.
- `summary.json` records the final user-facing answer grouped by target status.
- `decision-log.md` is the human-readable trail of the route taken: range setup,
  target discovery, midpoint choices, interval movements, fallback decisions,
  and final first-bad conclusions.
- `decision-log.jsonl` contains the same decision trail as structured JSON
  events for tooling or later report rendering.
- `commits/<sha>/` contains the normal compare artifacts for each measured
  candidate commit.

The terminal also prints a compact summary with the status, summary path, target
counts, decision-log path, and first-bad SHA for each found target. During the
run it prints progress messages before checkout, volume sync, server refresh,
compare execution, candidate selection, and interval updates so long-running
perf measurements do not look idle.

## Configuration

The command reads the same `abtests.config.ts` used by `compare`. It also accepts
an optional top-level `bisect` section:

```ts
export default defineConfig({
  // ...
  bisect: {
    rebuildCommands: [
      {
        description: 'Rebuild app assets',
        command: 'yarn build',
      },
    ],
    rebuildContainer: false,
  },
});
```

- `rebuildCommands` are run inside the experiment container after each
  candidate checkout. This is the fast path for apps where an in-place rebuild
  plus server restart is enough.
- `rebuildContainer: true` rebuilds the experiment image for each candidate.
  The current twin-server lifecycle recreates the running pair after that image
  build, so this is slower but safer when dependencies or generated assets may
  change across the range.
- If command refresh fails, V0 falls back to the container rebuild path for that
  candidate and records the fallback in `session.json`.

## Algorithm

Compare bisect treats the bad-ref comparison as a collection of independent
regression targets.

1. **Prepare the range.** The command validates clean control and experiment
   checkouts, resolves good and bad refs, and builds the ordered commit list from
   good to bad.
2. **Freeze tests and config.** Test definitions are loaded once from the
   invocation checkout. Candidate commits change the app code, not the test
   definitions. This keeps the search question stable.
3. **Measure or reuse the bad ref.** By default the bad ref is compared first.
   With `--reuse-current-results`, its selected category outcomes are loaded
   from `compare-results/` instead. Every failing visual, performance, or
   accessibility outcome becomes a target with a stable key: category, test
   file, test name, viewport, and subject.
4. **Stop when dry-running.** With `--dry-run`, persist and print the discovered
   targets plus the exact next action: the first midpoint by default, or good-ref
   validation when `--validate-good-ref` is enabled. No further measurement is
   performed.
5. **Optionally measure the good ref.** With `--validate-good-ref`, any target
   already present when the experiment also runs `good-ref` is marked `invalid`.
   By default this step is skipped because range setup already requires control
   to represent `good-ref`.
6. **Search active targets.** For each active target, the scheduler keeps a
   `[goodIndex, badIndex]` interval. A candidate in the middle of the interval
   is measured; if the target is present, the bad boundary moves down. If absent,
   the good boundary moves up.
7. **Share candidate work.** When one candidate SHA is useful for multiple
   targets, the command measures all relevant categories and individual AB tests
   in one compare run, then applies each target's observation independently.
   Exact `(test file, test name)` pairs are deduplicated, so different tests in
   one file remain independently selectable and equal names in different files
   remain distinct.
8. **Finish on adjacency.** When a target's good and bad boundaries are adjacent,
   the bad boundary commit is recorded as `firstBadSha`.

The scheduler is category-prioritized (`visreg`, `perf`, then `accessibility`)
and deterministic within each category. Cached observations are reapplied before
each scheduling decision, so repeated measurements of the same target/SHA are
avoided.

### Core Invariants

The implementation keeps a few invariants simple on purpose:

- **One fixed control.** Control represents the baseline behavior for the whole
  run. Only the experiment checkout moves.
- **One frozen test set.** The config and `.abtest.ts` definitions come from the
  invocation checkout and do not change as candidate commits are checked out.
- **One interval per target.** Every unresolved target owns a `goodIndex` and
  `badIndex`; the first-bad answer is valid only when those indexes become
  adjacent.
- **Evidence is explicit.** A candidate only changes an interval when the
  requested target is actually observed in that candidate's compare output.
- **Artifacts are durable.** Each measured SHA writes normal compare artifacts
  plus JSON session state so a failed run can be inspected after the fact.

These invariants make the result auditable: for any target in `summary.json`,
you can walk the observations in `session.json` and see why the interval moved.
For a narrative view, read `decision-log.md`; for exact event payloads, read
`decision-log.jsonl`.

### Scheduler Details

V0 uses binary search for each target, but it batches work across targets when
possible:

1. Reapply cached observations to every active target.
2. Pick the next unresolved target in deterministic category/test order.
3. Choose the midpoint of that target's current interval.
4. Find other active targets that can also use that same candidate SHA.
5. Run one narrowed compare for the union of those targets' categories and test
   files.
6. Apply the resulting observations back to each target independently.

This is a compromise between a pure per-target bisect, which would repeat a lot
of browser work, and a pure commit-level bisect, which cannot explain multiple
regressions introduced by different commits.

## Design Decisions

### Target-Level Bisect, Not Commit-Level Bisect

`git bisect run` asks one question: "is this commit good or bad?" Compare output
can contain several unrelated regressions introduced by different commits. V0
therefore tracks a separate interval per target and can return different
first-bad SHAs for visual, performance, and accessibility issues in one run.

### Fixed Control, Moving Experiment

The control side stays pinned to the known good behavior while only the
experiment side moves through candidate commits. This preserves the A/B compare
mental model and avoids turning the command into two independent historical
audits.

### Frozen Tests

Tests are loaded once from the invocation checkout. That means a candidate commit
cannot silently change the assertion definition, selector, viewport list, or
threshold being used to judge itself. If the tests need to change, run bisect
from a checkout with the desired test definitions.

### Fail Closed on Missing Evidence

Infrastructure errors, compare-stage failures, and missing target measurements
do not classify a candidate as good or bad. The session is marked `failed`, the
candidate run records the error, and the user can inspect the normal compare
artifacts. This avoids false first-bad answers from partial data.

This also means V0 does not infer that a target is absent just because a broader
compare run failed before producing that target's result. The absence must be
measured, not guessed.

### Explicit Experiment Materialization

The experiment checkout is moved to each candidate commit and the build-owned
files are synchronized into the experiment volume using the existing twin-server
build manifest. V0 prefers syncing only changed manifest-owned paths after the
first candidate, while guarding against paths and symlinks that could escape the
source or volume root.

The manifest boundary matters because the Docker volume contains generated
runtime state as well as app files. Bisect is allowed to replace files that the
image build declared as owned by the app checkout; it refuses unsafe replacements
such as deleting a non-empty generated directory that happens to sit at a former
manifest file path.

### Refresh Strategy

V0 uses the active `shaka-perf servers` menu as the process manager. For each
session, it acquires a compare-bisect lease from that menu. The lease pauses the
menu's experiment auto-sync and rejects unrelated menu lifecycle actions until
bisect cleanup releases it. For each candidate, the leased session either:

- Runs configured experiment-side rebuild commands and restarts the servers, or
- Rebuilds the experiment image when `rebuildContainer` is enabled or when
  command refresh fails, then recreates the running twin-server pair through the
  existing menu lifecycle.

This deliberately reuses the existing local server workflow instead of adding a
second process supervisor for bisect.

The lease includes the owning bisect process ID. If that process is interrupted,
the menu reaps the abandoned lease the next time a proxied action checks it, so
an aborted bisect does not permanently block normal server actions.

### Restoration

The command leaves control fixed and restores the experiment checkout to its
original branch or detached SHA after success, failure, or interruption. If a
different candidate was materialized into the experiment volume, V0 syncs the
original SHA back into the volume and refreshes the experiment side again.

Cleanup is best-effort but conservative: the primary bisect error is preserved,
and cleanup failures are reported separately so users can restore the checkout
or server state manually if needed.

## Limitations

- V0 assumes target behavior is monotonic across the selected range.
- V0 fails rather than implementing `git bisect skip` for flaky or unmeasurable
  commits.
- V0 depends on an active `shaka-perf servers` menu session for the bisect lease
  and refresh actions.
- V0's container fallback rebuilds the experiment image, but the existing
  twin-server menu recreates the running container pair as part of that
  lifecycle.
- V0 writes JSON and per-commit artifacts, but does not yet render a dedicated
  HTML bisect dashboard.

## Output Interpretation

Target statuses:

- `found`: The target was absent at the good boundary, present at the bad
  boundary, and the adjacent bad commit is the first bad SHA.
- `invalid`: The target was already present at the good ref, so the range does
  not bracket it.
- `active`: The target was still unresolved when the session failed.

Candidate run fields:

- `requestedCategories` and `requestedTests` describe the narrowed compare work
  for that SHA, including the exact test file and test name for every selected
  AB test.
- `refreshMode` and `usedFallback` describe how the experiment side was rebuilt
  or restarted.
- `infrastructureError` means the candidate was not used as evidence.
