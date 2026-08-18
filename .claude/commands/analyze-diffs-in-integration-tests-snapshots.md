Review git diffs in `integration-tests/` to catch meaningful changes hidden among expected run-to-run variance.

Snapshots contain ONLY the normalized `baseline-*.log` per suite and the stable-named report screenshots under each `<suite>-results/` dir. The integration-tests run also emits a `screenshot-diff-report.html` under `integration-tests/snapshots/` for visual review (step 4).

This check reports **WHAT changed between the previous and current test run**
(the git diff). NAME every meaningful change; deciding whether it's expected or
a bug is the user's call, so never drop a change because it "looks expected."
Trap that has caused misses: the perf suite regresses on purpose, so treating
its regressions as always-expected once hid a real diff — a changed SET of
regressed metrics, `! ALERT` banner count, or flagged pages is a change and
must be reported like any other.

Two phrasing constraints (they change wording, never what you report): describe
changes relative to the PREVIOUS run, not a fixed script; and PLEASE phrase a
finding as "this run differs from the previous run," not "experiment differs
from control" :pray:

## Steps

1. List the baseline logs in `integration-tests/snapshots/` (they match `baseline-*.log`), then launch one Agent subagent per log, all in a single message so they run in parallel. Give each agent ONLY its own `git diff -- integration-tests/snapshots/<log>` command plus the rules below, and have it analyze that diff. Agents run no other commands — no ls, no cat, no extra git commands.

   This check is **logs-only**: the agents judge the normalized transcripts, and the verdict is drawn from the logs alone. Screenshot diffs are NOT analyzed here — they are for the user to review by eye (see step 4).

2. Collect results from all agents and compile into the output format at the bottom, preserving every change they named. Before writing the **Changes** section, resolve each agent's quoted anchor text to a real `path:line` with `grep -n '<anchor text>' integration-tests/snapshots/<log>` — never a `git diff` hunk offset.

3. Regenerate the audit suite's screenshot-coverage baseline with the `shaka-perf-coverage` skill, run from the temp clone's demo dir so the skill's scripts resolve `audit-results/` and `app/javascript/` relative to it:

   ```bash
   cd /tmp/temp-shaka-perf-repos-for-tests/shaka-perf/demo-ecommerce
   ```

   Use this exact `relevant-sources` string every time — a changed source list makes the diff meaningless:

   ```text
   components/pages/HomePage\.tsx,components/pages/ProductListPage\.tsx,components/shared/ProductCard\.tsx
   ```

   Keep the list this small. Change it only when `integration-tests/client-report.spec.ts` changes which pages its filtered audit exercises — never because some other source happened to load.

   Follow the skill: `coverage-baseline.ts save "<relevant-sources>"` for the code gutters, then the manual, subagent-assisted pass over each unit's `artifacts/visibility-map.txt` for the visibility column. The demo's client bundle is always istanbul-instrumented, so BOTH halves must be present. An errored `code_coverage` stage, or `never loaded` gutters, means the instrumentation regressed — report that as the finding and stop; do not hand back a coverage estimate built from visibility maps alone.

   Write the result to the stable path `integration-tests/snapshots/audit-results/screenshot-coverage-baseline.txt` (beside the audit screenshots), then `git diff` it against the committed baseline and report the two halves SEPARATELY: changes to the code gutters, and changes to the visibility percentages/reasons (`not rendered`, `hidden by CSS`, `clipped by ancestor`, `outside capture`, `obscured`). A percentage that moved is a real change even when the gutters are identical.

   If `audit-results/` is absent because the audit suite was not run, say the baseline was not regenerated. Never reuse a stale artifact tree.

4. The verdict above is logs-only — it does NOT cover the visual changes. The integration-tests run already generated the screenshot diff report at `integration-tests/snapshots/screenshot-diff-report.html`. Use AskUserQuestion to ask whether the user wants to open it in the browser. If they agree, open that path via Bash (`xdg-open <path>` on Linux, `open <path>` on macOS). If they decline, just print the path. Either way, make clear the screenshot changes still need the user's own eyes — the skill does not judge them.

## Log diffs

Every baseline log is a normalized Playwright transcript: run-variable values (timestamps, most timings, home dirs, docker ages) are replaced with `<TIMING>`/`<TIMESTAMP>`-style stubs — the `⏱ <label>: <duration>s` stage markers deliberately survive so the timing analyst below can compare them. Report every meaningful change; leave out only pure run-variable churn (differing stubbed values, reordered concurrent-worker lines, changed hashes/pids/byte counts). Always reported: `>>>` step banners appearing/disappearing, new `Error:`/`FAIL`/`Traceback` lines, a changed Playwright pass count, a suite ending differently, and — in the perf log — a changed regression block (the count of `! ALERT … regression threshold` banners, the SET of `… estimated regression` metric lines, or the `FAILED: N perf regressions` count); state exactly which metrics/alerts/pages entered or left.

**Line-number discipline (agents):** a `git diff` hunk's `@@` header and the position inside a hunk are NOT file line numbers — counting within a hunk double-counts the removed+added pair (this produced a `:1182` anchor in an 803-line file). Don't emit diff line numbers; quote the exact text of each changed line as an anchor, and the coordinator resolves real `path:line` in step 2 by grepping it against the on-disk file.

Diff every `baseline-*.log` in `integration-tests/snapshots/` — the set of suites changes over time, so enumerate whatever logs are on disk rather than assuming a fixed list. Each subagent gets one log and one command:

```bash
git diff -- integration-tests/snapshots/<baseline log>
```

## Timing comparison

### Timing verdict

```bash
for f in integration-tests/snapshots/baseline-*.log; do \
  s=$(basename "$f" .log); \
  git show HEAD:"$f" > /tmp/ic-old-$s.log 2>/dev/null; \
  echo "=== OLD $s ==="; grep -E '⏱|passed' /tmp/ic-old-$s.log 2>/dev/null; \
  echo "=== NEW $s ==="; grep -E '⏱|passed' "$f" 2>/dev/null; \
done
```

Build a before/after timing comparison table from the command output above:

- Rows: every stage/step that has a `⏱ <label>: <duration>s` marker, plus each
  `run: yarn shaka-perf …` block's trailing `⏱ <duration>s`. (⏱ markers are the
  only durations that survive normalization; the `passed` lines give test-count
  context only.)
- Columns: stage · OLD · NEW · Δ · Δ%.
- Skip lines matching any of: `servers build`, `docker build`, `Building both Docker images`, `Building both Docker containers`, `servers start-containers` — docker layers use unpredictable caches, so their times don't reflect the code under test.

Return a one-line verdict:

- **"no regression"** — every remaining stage's Δ% is within ±25%.
- **"regressed"** — otherwise. Name the worst 3 offenders with their OLD vs NEW numbers and Δ%.

If an OLD log is missing (first run on this branch), report **"no baseline"** for that suite and do not build its table.

## Output format

Always render the full timing comparison table (not just the verdict), one row
per stage, columns `Stage | OLD | NEW | Δ | Δ%`.

```
## Integration Tests Integrity Check

### Summary
[One sentence, logs-only, counting/naming what changed: either "No changes
beyond run-variable noise in the logs — however you must review the visual
changes yourself" or "The logs show N meaningful change(s) — [categories, e.g.
new stage banners; perf regression set grew X → Y metrics] — you must still
review the visual changes yourself."]

### Timing Comparison

[If "no baseline", say so and skip the table. Otherwise render one table per
baseline log with columns Stage | OLD | NEW | Δ | Δ%.]

**Verdict:** no regression | regressed — [worst 3 offenders if regressed]

### Log Analysis

#### [baseline log]
[Name what changed in this diff — the meaningful added/removed lines, or "only
run-variable noise (timings, hashes, ordering)" if every hunk was noise. An
optional "(likely instrumentation)" / "(likely variance)" tag may follow a
change, but never replaces naming it.]

### Visual Review Required
This skill does NOT judge the screenshot diffs. Review them yourself in the
report at `integration-tests/snapshots/screenshot-diff-report.html` (see
step 4). The logs verdict above says nothing about whether a render broke.

### Screenshot Coverage
[Summarize the diff in `integration-tests/snapshots/audit-results/screenshot-coverage-baseline.txt`, code gutters first and visibility percentages/reasons second — they are separate signals. State the fixed `relevant-sources` string. If it was not regenerated, say why.]

### Changes
[One bullet per meaningful change, each a clickable `path:line` link to the
changed location (resolved with `grep -n` per step 2, never a diff-hunk offset)
— e.g. `integration-tests/snapshots/baseline-visreg.log:142` — plus a short
note on what changed. For a changed perf regression set, spell out which
metrics/alerts entered or left (e.g. "regressed metrics 7 → 15; added
FCP/TTFB/TBT/hydration; ALERT banners 2 → 3"). Link binary screenshots by path
alone. If nothing beyond run-variable noise changed, say so.]
```
