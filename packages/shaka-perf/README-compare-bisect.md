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

Start the twin-server menu first:

```bash
yarn shaka-perf servers
```

Then run bisect from the invocation checkout:

```bash
yarn shaka-perf compare bisect <good-ref> <bad-ref>
```

Optional category narrowing works the same way as `compare`:

```bash
yarn shaka-perf compare bisect <good-ref> <bad-ref> --categories visreg,perf
```

Results are written under `compare-bisect-results/`:

- `session.json` records the full resumable model: range, targets, observations,
  candidate runs, and infrastructure errors.
- `summary.json` records the final user-facing answer grouped by target status.
- `commits/<sha>/` contains the normal compare artifacts for each measured
  candidate commit.

The terminal also prints a compact summary with the status, summary path, target
counts, and first-bad SHA for each found target.

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
3. **Measure the bad ref.** The bad ref is compared first. Every failing visual,
   performance, or accessibility outcome becomes a target with a stable key:
   category, test file, test name, viewport, and subject.
4. **Measure the good ref.** Any target that is already present at the good ref
   is marked `invalid`, because the supplied good ref does not actually bracket
   that regression.
5. **Search active targets.** For each active target, the scheduler keeps a
   `[goodIndex, badIndex]` interval. A candidate in the middle of the interval
   is measured; if the target is present, the bad boundary moves down. If absent,
   the good boundary moves up.
6. **Share candidate work.** When one candidate SHA is useful for multiple
   targets, the command measures all relevant categories and test files in one
   compare run, then applies each target's observation independently.
7. **Finish on adjacency.** When a target's good and bad boundaries are adjacent,
   the bad boundary commit is recorded as `firstBadSha`.

The scheduler is category-prioritized (`visreg`, `perf`, then `accessibility`)
and deterministic within each category. Cached observations are reapplied before
each scheduling decision, so repeated measurements of the same target/SHA are
avoided.

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

### Explicit Experiment Materialization

The experiment checkout is moved to each candidate commit and the build-owned
files are synchronized into the experiment volume using the existing twin-server
build manifest. V0 prefers syncing only changed manifest-owned paths after the
first candidate, while guarding against paths and symlinks that could escape the
source or volume root.

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

### Restoration

The command restores the experiment checkout to its original branch or detached
SHA at the end of the run. If a different candidate was materialized into the
experiment volume, V0 syncs the original SHA back into the volume and refreshes
the experiment side again.

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

- `requestedCategories` and `requestedTestFiles` describe the narrowed compare
  work for that SHA.
- `refreshMode` and `usedFallback` describe how the experiment side was rebuilt
  or restarted.
- `infrastructureError` means the candidate was not used as evidence.
