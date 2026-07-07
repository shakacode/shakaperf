Review git diffs in `integration-tests/` to catch meaningful changes hidden among expected run-to-run variance.

Snapshots contain ONLY the normalized `baseline-*.log` per suite and the STABLE-NAMED deep-click report screenshots directly under each `<suite>-results/` dir (the overview shot is the full-page render of each report; dialog shots cover the artifacts). Screenshot DIFFS are generated at review time by `compare-screenshots.mjs`. Nothing else is ever copied into snapshots: the specs drive each report in place inside the working results dir, so the transient run output — report JSON/HTML, measurement dumps, raw control/experiment/failed_diff captures with per-run ids in their filenames — never appears here (it stays in the temp clone's results dirs until the next run).

Regressions between experiment and control are EXPECTED (experiment has lazy-loading disabled). Only flag changes between the PREVIOUS and CURRENT test run (i.e. git diffs). Whatever you do PLEASE DO NOT MENTION THAT THERE IS A DIFFERENCE OF EXPERIMENT VS CONTROL :pray:

## Steps

1. Launch one Agent subagent per section below, all in a single message so they run in parallel. Each agent should run ONLY the exact command(s) listed in its section and analyze the output against the rules. Do NOT run any other commands — no ls, no cat, no extra git commands. Pass the relevant rules to each agent. The one exception is the **Screenshot inventory + diff** section: its agent additionally opens (via the Read tool) the composite PNGs the second command writes — that visual pass over the actual pixels is the whole point of that section.

2. Collect results from all agents and compile into the output format at the bottom.

   The two timing-verdict agents (sections **Timing verdict · analyst A** and
   **· analyst B**) are an intentional duplicate: both do the same analysis
   independently as a cross-check. Compare their two verdicts. If they agree,
   report that single verdict. If they disagree, re-read the numbers yourself
   (load the baseline logs via Read) and break the tie; flag the
   disagreement in the output so the reader knows the signal was ambiguous.

3. After printing the summary, use AskUserQuestion to ask whether the user wants to open the screenshot diff report in the browser. If they agree, open `integration-tests/snapshots/screenshot-diff-report.html` via Bash (`xdg-open <path>` on Linux, `open <path>` on macOS). If they decline, just print the path.

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

## What the screenshots must contain

### Screenshot inventory + diff

```bash
yarn node integration-tests/compare-screenshots.mjs && yarn node integration-tests/compose-diff-triptychs.mjs && ls integration-tests/snapshots/bench-results integration-tests/snapshots/visreg-results integration-tests/snapshots/audit-results
```

Both scripts walk EVERY snapshot PNG (the deep-click report screenshots — stable-named, so paths diff meaningfully) and compare HEAD against the working tree. `compare-screenshots.mjs` emits the human HTML report at `integration-tests/snapshots/screenshot-diff-report.html`; `compose-diff-triptychs.mjs` bakes the same comparison into flat, AI-readable `[ PREVIOUS | DIFF | CURRENT ]` triptych PNGs (blue / red / green header bands; red = changed pixels) under `integration-tests/snapshots/.screenshot-diff/triptychs/`, printing one line per file — `[deterministic]` or `[artifact-dialog]`, plus its change %.

**You MUST open every triptych the second command lists with the Read tool and judge the actual pixels — the summary counts alone do not tell you whether a render broke.** For each shot, look at the three panels: PREVIOUS and CURRENT must each be a fully-rendered page (no blank/black panel, no empty card grid, no missing tiles/tabs/scores, no unstyled fallback text); the DIFF panel shows WHERE they differ. Apply the two bars below to decide whether a difference is signal.

**The image-reading agent is the ONLY one that sees these pixels — the orchestrator never does. So its job is to TRANSLATE what it sees into words, not just emit a verdict.** For every triptych that is not a pure reflow/no-op, write one line naming the shot and DESCRIBING IN PLAIN TEXT what actually differs between PREVIOUS and CURRENT — e.g. "client__01-overview: current is missing the AI-visibility status tile that previous shows" or "perf__05-artifact-03: current lighthouse iframe is blank where previous rendered the score gauges" or "visreg__01-overview: identical except everything below the hero shifted down ~30px (reflow)". Ground each description in the two named panels ("previous shows X, current shows Y"); the red DIFF panel only tells you WHERE to look, so never report a change you cannot actually see in the CURRENT vs PREVIOUS panels themselves. The orchestrator reconstructs the whole picture solely from these sentences, so a bare "OK"/"changed" with no description is a failure of the section. Call out explicitly any triptych whose CURRENT panel violates the content bar, and any `deterministic` shot with a visible non-reflow change. Then parse the per-suite summary lines (`<suite>: <total> total — <changed> changed, <identical> identical, <new> new, <deleted> deleted`, printed identically by both scripts) and apply two bars:

- Overview / tab / lightbox shots are near-deterministic (the report shells render fixed data): any visible change is worth inspecting.
- Artifact-dialog shots hosting iframes (lighthouse, timeline, diff pages) drift slightly between runs (iframe/lazy-image timing, sub-pixel anti-aliasing): only gross breakage matters — a blank iframe, an empty grid, a dimension collapse.
- Any `new`/`deleted` count is signal: names are fully stable (artifact-dialog shots are deduped to one per kind — `05-artifact-lighthouse`, `05-artifact-timeline` — with the dialog's own title identifying the artifact inside the image), so an appearing/disappearing PNG means a screenshot target appeared or stopped rendering.

Then verify the inventory from the `ls` output. Expected minimum per suite (missing = an interactive state stopped rendering; extra shots are fine):

- `bench-results/`: `perf__01-overview` (regressed HomePage card with vitals/diagnostics tables visible), `perf__04-sources-expanded`, artifact-dialog shots `perf__05-artifact-lighthouse` + `perf__05-artifact-timeline` (iframes non-blank), `perf__08-logs`.
- `visreg-results/`: `visreg__01-overview` (diff cards AND one errored card from the broken selector), `visreg__04-sources-expanded`, `visreg__06-visreg-diff` + `visreg__06-visreg-diff-scrubbed` (divider moved off 50/50) + `visreg__06-visreg-nodiff`, `visreg__08-logs`.
- `audit-results/`: `audit__01-overview` (technical report cards with metric chips), `audit__05-artifact-lighthouse` + `audit__05-artifact-timeline` (lighthouse dialog + annotated-timeline filmstrip dialog), `audit__07-a11y-dialog`, `audit__08-logs`; `client__01-overview` — the v2 client report bottom line, THREE status tiles (Mobile speed / Accessibility / AI visibility), the tab bar with a score on every tab header, and the active Performance panel (page cards with verdict copy, filmstrip strips, a load video poster, and the products page rendered as "couldn't measure" — the initially-active tab is NOT re-shot as a separate 02 file, the overview covers it); `client__02-tab-a11y` (severity chips + cropped problem frames), `client__02-tab-agent` (AI-visibility category breakdown); `client__04-lightbox` + `client__05-lightbox-next` (an enlarged, non-blank frame).

The filters (chip focus, stage-sections, text search, the client a11y severity chips) and the client status-tile jump are no longer screenshotted — they're verified by in-test DOM assertions in `report-capture.ts` (the interaction took effect and, for filters, reverted), so the `02-chip-filter`, `03-stage-filter-menu`, `09-search-home`, `client__06-sev-chip-toggled`, and `client__03-tile-jump` PNGs are intentionally gone. Their absence is expected, not a regression. (The tile-jump shot was in any case pixel-identical to `client__01-overview` — the first tile targets the default Performance panel.)

In every shot the content bar is the same: no blank/black frames where a page render is expected, no empty card grids, no missing tiles/tabs/scores, no unstyled fallback text. AI-written copy is disabled in these runs — the visible copy is the deterministic fallback, so wording churn between runs is signal, not noise.

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
[One sentence: "All changes are expected variance" or "Found N potential issues"]

### Timing Comparison

[If "no baseline", say so and skip the table. Otherwise render one table per
baseline log (twin-servers, visreg, perf, audit) with columns Stage | OLD | NEW | Δ | Δ%.]

**Verdict:** no regression | regressed — [worst 3 offenders if regressed]

### Log Analysis

#### [baseline log]
Status: OK | ISSUES FOUND
[Brief details if issues found]

### Screenshot Analysis
Status: OK | ISSUES FOUND
[Per-suite change counts + inventory check result. Then relay the image
agent's plain-text per-shot descriptions of what differs between previous and
current — verbatim, one line per non-trivial triptych — since you (the
orchestrator) never saw the pixels. Call out any missing expected shot or
content-bar violation.]

### Potential Issues (if any)
1. [file: what changed and why it matters]
```
