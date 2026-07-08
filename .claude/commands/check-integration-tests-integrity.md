Review git diffs in `integration-tests/` to catch meaningful changes hidden among expected run-to-run variance.

Snapshots contain ONLY the normalized `baseline-*.log` per suite and the STABLE-NAMED deep-click report screenshots directly under each `<suite>-results/` dir (the overview shot is the full-page render of each report; dialog shots cover the artifacts). Screenshot DIFFS are generated at review time by `compare-screenshots.mjs`. Nothing else is ever copied into snapshots: the specs drive each report in place inside the working results dir, so the transient run output — report JSON/HTML, measurement dumps, raw control/experiment/failed_diff captures with per-run ids in their filenames — never appears here (it stays in the temp clone's results dirs until the next run).

Regressions between experiment and control are EXPECTED (experiment has lazy-loading disabled). Only flag changes between the PREVIOUS and CURRENT test run (i.e. git diffs). Whatever you do PLEASE DO NOT MENTION THAT THERE IS A DIFFERENCE OF EXPERIMENT VS CONTROL :pray:

## Steps

1. Launch one Agent subagent per section below, all in a single message so they run in parallel. Each agent should run ONLY the exact command(s) listed in its section and analyze the output against the rules. Do NOT run any other commands — no ls, no cat, no extra git commands. Pass the relevant rules to each agent.

   This check is **logs-only**: the agents judge the normalized transcripts, and the verdict is drawn from the logs alone. Screenshot diffs are NOT analyzed here — they are for the user to review by eye (see step 3).

2. Collect results from all agents and compile into the output format at the bottom.

   The two timing-verdict agents (sections **Timing verdict · analyst A** and
   **· analyst B**) are an intentional duplicate: both do the same analysis
   independently as a cross-check. Compare their two verdicts. If they agree,
   report that single verdict. If they disagree, re-read the numbers yourself
   (load the baseline logs via Read) and break the tie; flag the
   disagreement in the output so the reader knows the signal was ambiguous.

3. The verdict above is logs-only — it does NOT cover the visual changes. Generate the human screenshot diff report by running `yarn node integration-tests/compare-screenshots.mjs` (emits `integration-tests/snapshots/screenshot-diff-report.html`), then use AskUserQuestion to ask whether the user wants to open it in the browser. If they agree, open that path via Bash (`xdg-open <path>` on Linux, `open <path>` on macOS). If they decline, just print the path. Either way, make clear the screenshot changes still need the user's own eyes — the skill does not judge them.

## What the logs must contain

Every baseline log is a normalized Playwright transcript: run-variable values (timestamps, most timings, home dirs, docker ages) are replaced with `<TIMING>`/`<TIMESTAMP>`-style stubs — the `⏱ <label>: <duration>s` stage markers deliberately survive so the timing analysts below can compare them. Any remaining diff is either noise listed under its section below or real signal. In ALL logs, these are always signal: `>>>` step banners appearing/disappearing, new `Error:`/`FAIL`/`Traceback` lines, a changed Playwright pass count, or a suite that no longer ends with its expected final banner.

### baseline-twin-servers.log

```bash
git diff -- integration-tests/snapshots/baseline-twin-servers.log
```

All timing values, hashes, sizes, and line ordering between `[CONTROL]`/`[EXPERIMENT]` are noise. The log must show, in order: both servers verified serving "Discover Your Style", the HomePage modification, `sync-changes`, `assets:precompile`, restart, control still on the old copy while experiment shows "Discover Your New Self"; then the quote-preservation test replacing text via `run-cmd` + sed and verifying `It's a "quoted" world`. Ends with `2 passed`. Flag: `>>>` steps added/removed, new `Error:`/`FAIL` messages, test count changes, or missing SUCCESS/docker steps.

### baseline-visreg.log

```bash
git diff -- integration-tests/snapshots/baseline-visreg.log
```

Same noise rules. The compare CLI MUST exit non-zero here — the hero-padding change and the injected broken products selector guarantee visual mismatches plus one engine error — so a `FAILED:` summary naming visreg mismatches and the banner `Visreg compare exited non-zero as expected (mismatches detected)` are both EXPECTED; their absence is the bug. Ends with `1 passed`. Flag: mismatch/error counts changing, `>>>` steps added/removed, new error kinds.

### baseline-perf.log

```bash
git diff -- integration-tests/snapshots/baseline-perf.log
```

Same noise rules, plus sparklines and p-values are noise. The compare CLI MUST exit non-zero (the LazySection→div swap regresses HomePage) — expect a `FAILED:` perf-regression summary and the banner `Perf compare exited non-zero as expected (regression detected)`. Ends with `1 passed`. Flag: `Is Significant` flipping for a phase, regression count changing, `>>>` steps added/removed, new error kinds.

### baseline-audit.log

```bash
git diff -- integration-tests/snapshots/baseline-audit.log
```

Same noise rules. Two tests. The click-coincidence test must show: the `Restored working products.abtest.ts selector` banner, an audit run over the two filtered click-flow tests (Products Electronics + Form Login) with `ai_summary` skipped, `timeline_frames.json` metadata + frame images verified for every per-test dir, and the validator (metadata click chips vs OCR'd red in-page Click overlays) printing a `validated N test(s) with click chips` line (N ≥ 1) and ending in `PASS`. The client-report test must show: an all-pages audit that exits NON-zero (banner `Audit exited non-zero as expected (sabotaged products test errored)` — the spec itself asserts the engine errors all belong to the sabotaged products test), the `Rendering v2 client report (all AI passes disabled)` banner, and the two capture banners (`Capturing audit report: overview`, `Capturing client client report: overview` — the per-state shots do not log individually; the spec asserts their manifest instead). Ends with `2 passed`. Flag: validator verdict not PASS or `validated 0`, engine errors on any test other than the sabotaged products one, missing banners, test count changes.

## Timing comparison

### Timing verdict · analyst A

```bash
for s in twin-servers visreg perf audit; do \
  git show HEAD:integration-tests/snapshots/baseline-$s.log > /tmp/ic-old-$s.log 2>/dev/null; \
  echo "=== OLD $s ==="; grep -E '⏱|passed' /tmp/ic-old-$s.log 2>/dev/null; \
  echo "=== NEW $s ==="; grep -E '⏱|passed' integration-tests/snapshots/baseline-$s.log 2>/dev/null; \
done
```

Build a before/after timing comparison table from the command output above:

- Rows: every stage/step that has a `⏱ <label>: <duration>s` marker, plus each
  `run: yarn shaka-perf …` block's trailing `⏱ <duration>s`. (Playwright's
  per-test `(<duration>s)` summaries are normalized to `(<TIMING>s)` stubs, so
  ⏱ markers are the only durations that survive in the logs — the `passed`
  lines are grepped for test-count context only.)
- Columns: stage · OLD · NEW · Δ · Δ%.
- Skip lines matching any of: `servers build`, `docker build`, `Building both Docker images`, `Building both Docker containers`, `servers start-containers` — docker layers use unpredictable caches, so their times don't reflect the code under test.

Return a one-line verdict:

- **"no regression"** — every remaining stage's Δ% is within ±25%.
- **"regressed"** — otherwise. Name the worst 3 offenders with their OLD vs NEW numbers and Δ%.

If an OLD log is missing (first run on this branch), report **"no baseline"** for that suite and do not build its table.

### Timing verdict · analyst B

```bash
for s in twin-servers visreg perf audit; do \
  git show HEAD:integration-tests/snapshots/baseline-$s.log > /tmp/ic-old-$s.log 2>/dev/null; \
  echo "=== OLD $s ==="; grep -E '⏱|passed' /tmp/ic-old-$s.log 2>/dev/null; \
  echo "=== NEW $s ==="; grep -E '⏱|passed' integration-tests/snapshots/baseline-$s.log 2>/dev/null; \
done
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
[One sentence, logs-only: "No issues found according to logs — however you must review the visual changes yourself" or "Found N potential issues in the logs (you must still review the visual changes yourself)".]

### Timing Comparison

[If "no baseline", say so and skip the table. Otherwise render one table per
baseline log (twin-servers, visreg, perf, audit) with columns Stage | OLD | NEW | Δ | Δ%.]

**Verdict:** no regression | regressed — [worst 3 offenders if regressed]

### Log Analysis

#### [baseline log]
Status: OK | ISSUES FOUND
[Brief details if issues found]

### Visual Review Required
This skill does NOT judge the screenshot diffs. Review them yourself in the
report at `integration-tests/snapshots/screenshot-diff-report.html` (generated
in step 3). The logs verdict above says nothing about whether a render broke.

### Potential Issues (if any)
1. [file: what changed and why it matters]
```
