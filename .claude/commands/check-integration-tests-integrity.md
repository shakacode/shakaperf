Review git diffs in `integration-tests/` to catch meaningful changes hidden among expected run-to-run variance.

Regressions between experiment and control are EXPECTED (experiment has lazy-loading disabled). Only flag changes between the PREVIOUS and CURRENT test run (i.e. git diffs). Whatever you do PLEASE DO NOT MENTION THAT THERE IS A DIFFERENCE OF EXPERIMENT VS CONTROL :pray:

## Steps

1. Launch one Agent subagent per file section below, all in a single message so they run in parallel. Each agent should run ONLY the exact command listed in its section and analyze the output against the rules. Do NOT run any other commands — no ls, no cat, no extra git commands. Pass the relevant rules to each agent.

2. Collect results from all agents and compile into the output format at the bottom.

   The two timing-verdict agents (sections **Timing verdict · analyst A** and
   **· analyst B**) are an intentional duplicate: both do the same analysis
   independently as a cross-check. Compare their two verdicts. If they agree,
   report that single verdict. If they disagree, re-read the numbers yourself
   (load the two baseline logs via Read) and break the tie; flag the
   disagreement in the output so the reader knows the signal was ambiguous.

3. After printing the summary, use AskUserQuestion to ask whether the user wants to open the screenshot diff report in the browser. If they agree, open `integration-tests/snapshots/screenshot-diff-report.html` with `open <path>` via Bash. If they decline, just print the path.

## Files

### ab-measurements.json

```bash
git diff -- integration-tests/snapshots/bench-results/ab-measurements.json 'integration-tests/snapshots/bench-results/*/ab-measurements.json'
```

All numeric timing values are random noise. Only flag: missing/added phases or groups, changed sample count (expect 6), order-of-magnitude jumps in values, or structural JSON changes.

### report.json

```bash
git diff -- integration-tests/snapshots/bench-results/report.json 'integration-tests/snapshots/bench-results/*/report.json'
```

Numeric values (p-values, deltas, CIs, percentiles, sparklines) are noise. Only flag: `isSignificant` flipping for any phase, `areResultsSignificant` or `isBelowRegressionThreshold` changing, missing phases, sample counts != 6.

### report.txt

```bash
git diff -- integration-tests/snapshots/bench-results/report.txt 'integration-tests/snapshots/bench-results/*/report.txt'
```

Plain text summary. Numeric values are noise. Only flag: missing sections, structural changes, added/removed metric names.

### Report-drive-through screenshots

```bash
yarn node integration-tests/compare-screenshots.mjs
```

Single invocation, no args — the script walks only `<suite>/report-shots/*.png`
under both `bench-results/` and `visreg-results/` (the deep-click captures that
each spec's `captureReportScreenshots` pass takes while driving the unified
compare `report.html` through its interactive states) and emits one combined
report at `integration-tests/snapshots/screenshot-diff-report.html`. The
superficial per-artifact `*.screenshot.png` files (lighthouse, timeline,
diff HTMLs) are intentionally NOT diffed — their iframe-driven renders drift
between runs and aren't the signal we care about.

Parse the per-suite summary line the script prints (`<suite>: <total> total — <changed> changed, <identical> identical, <dim-shift> dim-shift, <new> new, <deleted> deleted`) and flag the `bench-results` and `visreg-results` counts separately. The report-shell is deterministic, so these shots should be nearly identical between runs; any non-trivial `changed` count is worth inspecting.

### Experiment server network_activity.txt

```bash
git diff -- 'integration-tests/snapshots/bench-results/*3030*_network_activity.txt' 'integration-tests/snapshots/bench-results/*/*3030*_network_activity.txt'
```

KB values, download counts, and asset hashes are noise. Only flag: resources appearing/disappearing, or 10x size changes.

### Control server network_activity.txt

```bash
git diff -- 'integration-tests/snapshots/bench-results/*3020*_network_activity.txt' 'integration-tests/snapshots/bench-results/*/*3020*_network_activity.txt'
```

KB values, download counts, and asset hashes are noise. Only flag: resources appearing/disappearing, or 10x size changes.

### Experiment server performance_profile.summary.txt

```bash
git diff -- 'integration-tests/snapshots/bench-results/*3030*_performance_profile.summary.txt' 'integration-tests/snapshots/bench-results/*/*3030*_performance_profile.summary.txt'
```

### Control server performance_profile.summary.txt

```bash
git diff -- 'integration-tests/snapshots/bench-results/*3020*_performance_profile.summary.txt' 'integration-tests/snapshots/bench-results/*/*3020*_performance_profile.summary.txt'
```

### visreg

```bash
git diff -- integration-tests/snapshots/visreg-results ':(exclude)*.png'
```

Unlike perf-tests, visreg results are way more deterministic.

### baseline-twin-servers.log

```bash
git diff -- integration-tests/snapshots/baseline-twin-servers.log
```

All timing values, hashes, sizes, and line ordering between `[CONTROL]`/`[EXPERIMENT]` are noise. Only flag: `>>>` steps added/removed, new `Error:`/`FAIL` messages, test count changes, or missing `SUCCESS`/docker steps.

### baseline-visreg.log

```bash
git diff -- integration-tests/snapshots/baseline-visreg.log
```

All timing values, hashes, sizes, and line ordering between `[CONTROL]`/`[EXPERIMENT]` are noise. Only flag: `>>>` steps added/removed, new `Error:`/`FAIL` messages, test count changes, or missing `SUCCESS`/docker steps.

### baseline-perf.log

```bash
git diff -- integration-tests/snapshots/baseline-perf.log
```

All timing values, hashes, sizes, sparklines, p-values, and line ordering between `[CONTROL]`/`[EXPERIMENT]` are noise. Only flag: `>>>` steps added/removed, new `Error:`/`FAIL` messages, test count changes, `Is Significant` flipping, or missing `SUCCESS`/docker steps.

### Timing verdict · analyst A

```bash
git show HEAD:integration-tests/snapshots/baseline-twin-servers.log > /tmp/ic-old-twin.log 2>/dev/null; \
git show HEAD:integration-tests/snapshots/baseline-visreg.log > /tmp/ic-old-visreg.log 2>/dev/null; \
git show HEAD:integration-tests/snapshots/baseline-perf.log > /tmp/ic-old-perf.log 2>/dev/null; \
echo '=== OLD twin ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' /tmp/ic-old-twin.log 2>/dev/null; \
echo '=== NEW twin ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' integration-tests/snapshots/baseline-twin-servers.log; \
echo '=== OLD visreg ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' /tmp/ic-old-visreg.log 2>/dev/null; \
echo '=== NEW visreg ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' integration-tests/snapshots/baseline-visreg.log; \
echo '=== OLD perf ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' /tmp/ic-old-perf.log 2>/dev/null; \
echo '=== NEW perf ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' integration-tests/snapshots/baseline-perf.log
```

Build a before/after timing comparison table from the command output above:

- Rows: every stage/step that has a `⏱ <label>: <duration>s` marker, plus each
  per-test `(<duration>s)` / `(<duration>m)` summary from Playwright, plus each
  `run: yarn shaka-perf …` block's trailing `⏱ <duration>s`.
- Columns: stage · OLD · NEW · Δ · Δ%.
- Skip lines matching any of: `twins-build`, `docker build`, `Building both Docker images`, `Building both Docker containers`, `twins-start-containers` — docker layers use unpredictable caches, so their times don't reflect the code under test.

Return a one-line verdict:

- **"no regression"** — every remaining stage's Δ% is within ±25%, and no single test's wall-clock time increased by more than 2×.
- **"regressed"** — otherwise. Name the worst 3 offenders with their OLD vs NEW numbers and Δ%.

If either OLD log is missing (first run on this branch), report **"no baseline"** and do not build a table.

### Timing verdict · analyst B

```bash
git show HEAD:integration-tests/snapshots/baseline-twin-servers.log > /tmp/ic-old-twin.log 2>/dev/null; \
git show HEAD:integration-tests/snapshots/baseline-visreg.log > /tmp/ic-old-visreg.log 2>/dev/null; \
git show HEAD:integration-tests/snapshots/baseline-perf.log > /tmp/ic-old-perf.log 2>/dev/null; \
echo '=== OLD twin ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' /tmp/ic-old-twin.log 2>/dev/null; \
echo '=== NEW twin ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' integration-tests/snapshots/baseline-twin-servers.log; \
echo '=== OLD visreg ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' /tmp/ic-old-visreg.log 2>/dev/null; \
echo '=== NEW visreg ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' integration-tests/snapshots/baseline-visreg.log; \
echo '=== OLD perf ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' /tmp/ic-old-perf.log 2>/dev/null; \
echo '=== NEW perf ==='; grep -E '⏱|passed|\([0-9.]+[sm]\)' integration-tests/snapshots/baseline-perf.log
```

Same rules as **analyst A** — intentionally run as a second independent agent so
the orchestrator can cross-check its verdict. Build the table, apply the same
docker-exclusion filter, and return the same one-line verdict (plus the three
worst offenders if regressed). Do NOT look at analyst A's output — form an
independent opinion.

## Output format

Always render the full timing comparison table (not just the verdict). Use the
table produced by analyst A and/or B verbatim — one row per stage, columns
`Stage | OLD | NEW | Δ | Δ%`. If analysts disagree on the verdict, note the
disagreement above the table.

```
## Integration Tests Integrity Check

### Summary
[One sentence: "All changes are expected variance" or "Found N potential issues"]

### Timing Comparison

[If "no baseline", say so and skip the table. Otherwise render one table per
baseline log (twin-servers, visreg, perf) with columns Stage | OLD | NEW | Δ | Δ%.]

**Verdict:** no regression | regressed — [worst 3 offenders if regressed]

### File-by-file Analysis

#### [filename]
Status: OK | ISSUES FOUND
[Brief details if issues found]

### Potential Issues (if any)
1. [file: what changed and why it matters]
```
