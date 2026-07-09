Review git diffs in `integration-tests/` to catch meaningful changes hidden among expected run-to-run variance.

Snapshots contain ONLY the normalized `baseline-*.log` per suite and the stable-named report screenshots under each `<suite>-results/` dir. The integration-tests run also emits a `screenshot-diff-report.html` under `integration-tests/snapshots/` for visual review (step 3).

Regressions between experiment and control are EXPECTED (experiment has lazy-loading disabled). Only flag changes between the PREVIOUS and CURRENT test run (i.e. git diffs). Whatever you do PLEASE DO NOT MENTION THAT THERE IS A DIFFERENCE OF EXPERIMENT VS CONTROL :pray:

## Steps

1. List the baseline logs in `integration-tests/snapshots/` (they match `baseline-*.log`), then launch one Agent subagent per log, all in a single message so they run in parallel. Give each agent ONLY its own `git diff -- integration-tests/snapshots/<log>` command plus the rules below, and have it analyze that diff. Agents run no other commands — no ls, no cat, no extra git commands.

   This check is **logs-only**: the agents judge the normalized transcripts, and the verdict is drawn from the logs alone. Screenshot diffs are NOT analyzed here — they are for the user to review by eye (see step 3).

2. Collect results from all agents and compile into the output format at the bottom.

3. The verdict above is logs-only — it does NOT cover the visual changes. The integration-tests run already generated the screenshot diff report at `integration-tests/snapshots/screenshot-diff-report.html`. Use AskUserQuestion to ask whether the user wants to open it in the browser. If they agree, open that path via Bash (`xdg-open <path>` on Linux, `open <path>` on macOS). If they decline, just print the path. Either way, make clear the screenshot changes still need the user's own eyes — the skill does not judge them.

## Log diffs

Every baseline log is a normalized Playwright transcript: run-variable values (timestamps, most timings, home dirs, docker ages) are replaced with `<TIMING>`/`<TIMESTAMP>`-style stubs — the `⏱ <label>: <duration>s` stage markers deliberately survive so the timing analyst below can compare them. Any remaining diff is either noise or real signal. In ALL logs, these are always signal: `>>>` step banners appearing/disappearing, new `Error:`/`FAIL`/`Traceback` lines, a changed Playwright pass count, or a suite that no longer ends the way it did last run.

The snapshot IS the expectation: judge each diff against the previous run, not against any fixed script of what the log "should" say. Your goal is to find the meaningful differences hidden in the noise.

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
[One sentence, logs-only: "No issues found according to logs — however you must review the visual changes yourself" or "Found N potential issues in the logs (you must still review the visual changes yourself)".]

### Timing Comparison

[If "no baseline", say so and skip the table. Otherwise render one table per
baseline log with columns Stage | OLD | NEW | Δ | Δ%.]

**Verdict:** no regression | regressed — [worst 3 offenders if regressed]

### Log Analysis

#### [baseline log]
[State what actually changed in this diff — the meaningful added/removed lines,
or "only run-variable noise (timings, hashes, ordering)" if every hunk was
noise. Do not write "OK": name the changes, then say whether any look like real
signal.]

### Visual Review Required
This skill does NOT judge the screenshot diffs. Review them yourself in the
report at `integration-tests/snapshots/screenshot-diff-report.html` (see
step 3). The logs verdict above says nothing about whether a render broke.

### Changes
[Summarize every meaningful change, one bullet each, as a clickable
`path:line` link to the exact changed location — e.g.
`integration-tests/snapshots/baseline-visreg.log:142` — followed by a short
note on what changed and whether it is signal or noise. For binary screenshots
(no line numbers) link the file path alone. If nothing meaningful changed, say
so.]
```
