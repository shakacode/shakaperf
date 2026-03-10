Review git diffs in `integration-tests/` to catch meaningful changes hidden among expected run-to-run variance.

Regressions between experiment and control are EXPECTED (experiment has lazy-loading disabled). Only flag changes between the PREVIOUS and CURRENT test run (i.e. git diffs). Whatever you do PLEASE DO NOT MENTION THAT THERE IS A DIFFERENCE OF EXPERIMENT VS CONTROL :pray:

## Steps

1. Launch one Agent subagent per file section below, all in a single message so they run in parallel. Each agent should run ONLY the exact command listed in its section and analyze the output against the rules. Do NOT run any other commands — no ls, no cat, no extra git commands. Pass the relevant rules to each agent.

2. Collect results from all agents and compile into the output format at the bottom.

3. After printing the summary, use AskUserQuestion to ask whether the user wants to open the screenshot diff report in the browser. If they agree, open it with `open <path>` via Bash. If they decline, just print the path to the HTML report.

## Files

### compare.json

```bash
git diff -- integration-tests/bench-results/compare.json
```

All numeric timing values are random noise. Only flag: missing/added phases or groups, changed sample count (expect 5), order-of-magnitude jumps in values, or structural JSON changes.

### report.json

```bash
git diff -- integration-tests/bench-results/report.json
```

Numeric values (p-values, deltas, CIs, percentiles, sparklines) are noise. Only flag: `isSignificant` flipping for any phase, `areResultsSignificant` or `isBelowRegressionThreshold` changing, missing phases, sample counts != 5.

### HTML screenshots

```bash
yarn node integration-tests/compare-screenshots.mjs
```

There will always be pixelmatch changes, that's OK. Ask devs to take a look at the report and make a decision.

### Experiment server network_activity.txt

```bash
git diff -- integration-tests/bench-results/localhost_3030____network_activity.txt
```

KB values, download counts, and asset hashes are noise. Only flag: resources appearing/disappearing, or 10x size changes.

### Control server network_activity.txt

```bash
git diff -- integration-tests/bench-results/localhost_3020____network_activity.txt
```

KB values, download counts, and asset hashes are noise. Only flag: resources appearing/disappearing, or 10x size changes.


### Experiment server performance_profile.summary.txt

```bash
git diff -- integration-tests/bench-results/localhost_3030____performance_profile.summary.txt
```

### Control server performance_profile.summary.txt

```bash
git diff -- integration-tests/bench-results/localhost_3020____performance_profile.summary.txt
```

### visreg

```bash
git diff -- integration-tests/visreg-results ':(exclude)*.png'
```

Unlike perf-tests, visreg results are way more deterministic.

### baseline-output.log

```bash
git diff -- integration-tests/baseline-output.log
```

All timing values, hashes, sizes, sparklines, p-values, and line ordering between `[CONTROL]`/`[EXPERIMENT]` are noise. Only flag: `>>>` steps added/removed, new `Error:`/`FAIL` messages, test count changes, `Is Significant` flipping, or missing `SUCCESS`/docker steps.

## Output format

```
## Integration Tests Integrity Check

### Summary
[One sentence: "All changes are expected variance" or "Found N potential issues"]

### File-by-file Analysis

#### [filename]
Status: OK | ISSUES FOUND
[Brief details if issues found]

### Potential Issues (if any)
1. [file: what changed and why it matters]
```
