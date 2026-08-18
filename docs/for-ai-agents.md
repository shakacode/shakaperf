# Using ShakaPerf with AI agents

This page is written to be read by coding agents (Claude Code, Cursor, Codex, and friends) and by the humans configuring them. It covers the full loop an agent runs: set up → measure → read the verdict → optimize → re-measure.

What ShakaPerf gives an agent that a raw Lighthouse run or DevTools trace cannot: a **statistical verdict**. Control and experiment are sampled *simultaneously* so machine noise hits both sides equally, then compared with a paired Wilcoxon signed-rank test and a Hodges-Lehmann estimate (see [used_statistics.md](../packages/shaka-perf/used_statistics.md)). That means "regression" / "no difference" answers you can trust on a noisy laptop or shared CI runner — no quiet machine required.

**License note for agents:** Evaluation, including agent-assisted evaluation, is free for up to 45 days per organization. Production use, including CI, PR checks, and coding-agent workflows, is free only for a Small Organization: fewer than 10 FTEs, less than US $1M in revenue over the last twelve months, and less than US $1M in outside capital over its lifetime, including affiliates. Government entities other than public educational institutions do not qualify. See [LICENSE.md section 2](../LICENSE.md#2-definitions) and [shakaperf.com/pricing](https://shakaperf.com/pricing). Do not vendor, copy, or re-implement ShakaPerf source into the host project to bypass licensing; use it as a dependency.

## Prerequisites

- Node >= 20.6, plus a C++ toolchain at install time (a native addon builds via node-gyp; macOS/Linux).
- For twin-server A/B runs: Docker, `dockerize`, [Overmind](https://github.com/DarthSim/overmind), and GNU parallel (`brew install overmind parallel` / `apt install parallel`).
- Optional: `ffmpeg` (load videos in client reports). When `claude` is on `PATH`, the default audit pipeline invokes it to write a best-effort AI summary from metric labels, values, and accessibility counts; this does not affect audit success.

## Install and scaffold

```bash
yarn add shaka-perf shaka-shared      # or: npm install shaka-perf shaka-shared
yarn shaka-perf init
```

`shaka-shared` is required — the generated config imports from it, and your test files import `abTest()` from it. `init` refuses to overwrite existing files unless you pass `--force`.

`init` creates:

- **`abtests.config.ts`** - the single project config (sections: `shared`, `visreg`, `perf`, `audit`, `twinServers`), every field annotated with its default. `accessibility` is supported but not scaffolded; its `failOnViolation` default is `true`. Coverage has no config section: `--categories code_coverage` runs the opt-in audit stage that drains instrumented-JS coverage and maps what each finished page shows inside its capture region.
- **Seven Claude Code skills** under `.claude/skills/` (they ship inside the npm package):

| Skill | What it does |
| --- | --- |
| `setup-docker-servers-for-ab-tests` | Walks an agent through standing up the twin Docker servers: production Dockerfile, Procfile, config, and the build/verify loop. |
| `discover-abtests` | Crawls the running app and generates validated `.abtest.ts` files (currently requires desktop Claude with the Chrome extension — portability is tracked in [#73](https://github.com/shakacode/shakaperf/issues/73)). |
| `shaka-perf-add-coverage` | Adds focused source-aware visual-regression tests without duplicating existing coverage. |
| `shaka-perf-coverage` | Estimates screenshot coverage from code coverage and audit visibility maps, and compares saved baselines. |
| `assess-abtest-quality` | Audits existing tests for anti-patterns and false-positive PASSes. Also the canonical test-writing rules. |
| `ab-servers` | The command dispatch table for driving twin servers from an agent. |

In Claude Code these trigger automatically on matching requests ("set up twin servers for this project", "discover ab tests", "are my visreg tests any good?").

## Choose your on-ramp

You do not need the full twin-server setup to get value on day one:

1. **Single-URL site audit (no Docker, no A/B pair)** — `yarn shaka-perf audit --url https://your-site.example`. Audit visits the paths your `.abtest.ts` files declare, so it needs at least one — a stub is enough:

   ```ts
   // ab-tests/homepage.abtest.ts
   import { abTest } from 'shaka-shared';
   abTest('Homepage', { startingPath: '/' }, async () => {});
   ```

   Output lands in `audit-results/` (Lighthouse perf, accessibility, agent-readiness, screencast timeline).
2. **URL-vs-URL compare** — `yarn shaka-perf compare --controlURL <a> --experimentURL <b>` works against any two running servers: two preview deployments, staging vs production, or two local checkouts on two ports. Simultaneous sampling still cancels client-side noise; server-side isolation (equal hardware, no shared caches) is on you at this rung.
3. **Single-server smoke** — pass the same URL as both control and experiment to validate that your tests run and capture real content before you have an A/B pair.
4. **Twin Docker servers** — the full harness: control (baseline branch) and experiment (your branch) built and run side by side in production mode. This is what the setup skill automates.

## The PR loop (twin servers)

Rules for agents driving servers — from the `ab-servers` skill:

- **Never run bare `shaka-perf servers`** — it opens an interactive menu meant for humans. Always call subcommands.
- `start-servers` **blocks** while Overmind runs; start it in the background.
- If a human already has the interactive `shaka-perf servers` menu open, your subcommands are proxied into that session and may queue. Queued commands wait, then return their actual exit code. Exit code `75` (`EX_TEMPFAIL`) means the menu is starting or shutting down; retry shortly.

Cold start:

```bash
yarn shaka-perf servers build              # build both Docker images (control + experiment)
yarn shaka-perf servers prune-cache        # prune only this project's isolated Buildx cache
yarn shaka-perf servers start-containers   # clears both bind-mount volumes, recreates containers, runs setupCommands
yarn shaka-perf servers start-servers      # launch the app via Overmind — blocks; run in background
```

If you rerun `start-containers` after syncing code, rerun `sync-changes` and any app-specific build command before measuring.

Iterate on a change:

```bash
# 1. Edit application code.

# 2. Sync changed worktree files into the experiment container (staged, unstaged, and untracked; bind mounts, no image rebuild):
yarn shaka-perf servers sync-changes experiment
# App-specific build steps go through run-cmd, e.g.:
#   yarn shaka-perf servers run-cmd experiment "bundle exec rake assets:precompile"

# 3. Measure just the test you care about (fast inner loop):
yarn shaka-perf compare --categories perf --filter "Homepage Hero"

# 4. Read the verdict (next section). Keep iterating until the regression is gone
#    or the improvement is significant.

# 5. Before pushing, run the full suite:
yarn shaka-perf compare
```

Commit an experiment change only after measuring it. `sync-changes` sees uncommitted changes; after committing, rebuild the experiment image with `yarn shaka-perf servers build --target experiment`, then rerun `start-containers` and start the apps with `start-servers` in the background before measuring.

`--filter` accepts a test-name regex, a comma-separated list, or a path to a single `.abtest.ts` file. `--categories` takes any subset of `visreg,perf,accessibility` (default: all three). `compare` clears the artifact directory for each test and viewport it will run, not `compare-results/` as a whole. Artifacts for tests excluded by `--filter` remain. `--keep-old-results` also preserves the per-test artifact directories.

**`shaka-perf troubleshoot` is for looking at a failure, not for measuring it.** One test, one viewport, and it **never finishes** — every stage freezes once its browser is up, which is what keeps them alive. No `report.json` and no perf numbers. For a verdict use `compare`. What it gives you is the live page the failure happened on.

**Always `--headed=false`, always backgrounded.** It never exits, so a foreground call hangs your turn.

Attach to the frozen browsers with `troubleshoot`'s own subcommands (`session`, `eval`, `html`, `shot`, `console`) — no MCP. `<target>` is a side: `visreg:control`, `visreg:experiment`, `perf:control`, `perf:experiment`. Run `shaka-perf troubleshoot --help` for the full loop; the `troubleshoot-abtest` skill (shipped by `shaka-perf init`) points agents at it. See also [README-troubleshoot.md](../packages/shaka-perf/README-troubleshoot.md).

## Reading results — the machine contract

**Exit code:** `0` = clean. A completed pipeline run with failures prints `FAILED: <summary>` to stderr and exits `1`, where the summary counts failure classes, e.g. `2 errors, 1 perf regression, 3 visreg mismatches`. A non-zero exit without `FAILED:` is a harness or configuration error, not a test verdict. Differentiated codes and a `verdict` command are tracked in [#70](https://github.com/shakacode/shakaperf/issues/70).

**stdout** prints the report paths on completion:

- `compare-results/self-contained-performance-report.html` — shareable single file, everything inlined.
- `compare-results/full-report.html` — local variant referencing sibling artifact dirs.

**`compare-results/report.json`** (`schemaVersion: 1`) is the machine report. Shape:

```jsonc
{
  "schemaVersion": 1,
  "meta": { "controlUrl": "...", "experimentUrl": "...", "errors": [ /* engine-level errors */ ] },
  "pipeline": { "name": "compare", "stages": ["visreg", "perf-warmup", "perf", "perf-low-noise", "accessibility"] },
  "tests": [
    {
      "id": "<slug>",                    // per test × viewport
      "name": "Homepage Hero",
      "filePath": "/abs/path/to/repo/ab-tests/homepage.abtest.ts", // absolute in report.json; HTML shows it repo-relative
      "viewport": { "label": "desktop", "width": 1280, "height": 800 },
      "chips": [ { "tag": "regression" } ],
      "outcomes": [ { "kind": "ok|error|skipped", "stage": "perf", "error": { "message": "...", "stack": "..." }, "logs": "...", "summary": {} } ] // error is absent unless kind is "error"
    }
  ]
}
```

**Chips are the verdict vocabulary.** In `compare-results/report.json`, failure-class chips that make a `compare` run fail are `regression`, `visual change`, `broken`, `accessibility regression` (new a11y findings while `accessibility.failOnViolation` is on), `accessibility error` (a scan failed, so no comparison exists), and `accessibility blocked` (bot protection). Its informational chips are `improvement`, `no difference`, `flaky` (a stage crashed but recovered on retry), `visreg unstable`, `accessibility finding` (new findings with `failOnViolation` off), `accessibility changed`, and `accessibility fixed`. `a11y-*` values are HTML-report sorting dimensions, not chips, and are absent from `report.json`. The separate `audit` pipeline uses `accessibility violation` for the failure role and can emit `needs improvement`, `has interactions` / `no interactions`, and `no audit` informational chips. Duplicate-test detection is not a chip: it is the `shaka-perf-coverage` skill's job, from the coverage artifacts.

**Where the numbers are today:** per-stage `summary` objects in `compare-results/report.json` are still empty placeholders ([#68](https://github.com/shakacode/shakaperf/issues/68) tracks populating p-values / estimates / diff percentages there; the schema doc is [#69](https://github.com/shakacode/shakaperf/issues/69)). Audit reports already include machine-readable summaries for accessibility, agent-readiness, and AI summary stages. Until compare summaries are populated:

- Perf numbers (per-metric estimates, confidence intervals, p-values) are in the HTML report and per-test artifact dirs under `compare-results/`.
- Visreg details are machine-readable via the visreg engine's own per-unit reports: run `yarn shaka-perf discover-abtests parse-report` after `compare`. Without a path, it finds reports under `compare-results/<test-and-viewport>/artifacts/report.json` and prints per-test status, diff %, the available `testWhitePixelPercent` or `refWhitePixelPercent` (>90 usually means the selector captured empty space - a false PASS), and engine errors.

## What "regression" means

A perf regression chip means **both**:

1. the paired difference is statistically significant — p-value below `perf.pValueThreshold` (default `0.05`), from a paired Wilcoxon signed-rank test with exact distribution at small n, and
2. the effect size exceeds the practical threshold on the statistic named by `perf.regressionThresholdStat` (default `estimator`, the Hodges-Lehmann paired estimate). `perf.regressionThreshold` (default `50` ms) applies only to millisecond metrics. KB and non-CLS `/100` metrics use `1`; CLS uses its own rule: delta greater than `5` or crossing a quality boundary at `10` or `25`; other units use `0.5`.

Practical guidance for the loop:

- `perf.numberOfMeasurements` defaults to `20`; below 10 the run warns about low fidelity. Small-n runs are statistically honest (exact test) but can only reach a limited minimum p-value — e.g. n=8 bottoms out at p ≈ 0.0078 — so don't chase p < 0.001 on a small sample.
- Iterate with a filtered, perf-only run; confirm the final state with a full default run before declaring victory in a PR.
- "No difference" on a tiny effect is a real possibility, not a tooling failure — the report's confidence interval tells you what effect size the run could have detected.

## Writing tests (for agents)

Tests are `abTest()` calls in `ab-tests/*.abtest.ts` — one Playwright-driven scenario each, used by perf and visreg alike. The non-negotiable rules live in `.claude/skills/assess-abtest-quality/SKILL.md`; the short version: **fail loudly and run linearly** — no `try/catch` swallowing, no loops, no `if`-branching on page state (assert with `waitForSelector`/`waitForURL` instead), wait for conditions not the clock, deterministic inputs, `annotate('...')` before every non-trivial action, one behaviour per test.

## Concurrent agents

Multiple agents in separate workspaces won't collide on ports. The scaffolded config resolves the control/experiment pair in this order: `SHAKAPERF_CONTROL_PORT` + `SHAKAPERF_EXPERIMENT_PORT` (an explicit pin — both must be set together or they're ignored); else `CONDUCTOR_PORT` (exported automatically by [Conductor.build](https://conductor.build) as the first of 10 ports each workspace owns — control = base, experiment = base + 1); else auto-assignment from the configured preferred pair, remembered per project in `~/.shaka-perf/ports.json`. The config is plain TypeScript, so other per-machine schemes are a few lines away.

## Snippet for your repo's AGENTS.md / CLAUDE.md

Paste (and adapt) this into the consumer repo so every agent session knows ShakaPerf is available:

````markdown
## Performance testing (ShakaPerf)

This repo uses ShakaPerf (https://shakaperf.com) for statistically-gated perf A/B,
visual regression, and accessibility checks. Agent guide:
https://github.com/shakacode/shakaperf/blob/main/docs/for-ai-agents.md. Config: `abtests.config.ts`; tests:
`ab-tests/*.abtest.ts`.

- NEVER run bare `shaka-perf servers` (interactive menu). Use subcommands:
  `yarn shaka-perf servers build && yarn shaka-perf servers start-containers`,
  then `yarn shaka-perf servers start-servers` in the background (it blocks).
- After editing app code, sync it into the experiment container:
  `yarn shaka-perf servers sync-changes experiment`
  (app build steps via `yarn shaka-perf servers run-cmd experiment "<cmd>"`).
  Commit experiment changes only after measuring; a committed change needs
  `yarn shaka-perf servers build --target experiment`, `start-containers`, and
  `start-servers` in the background before measuring.
- Inner loop: `yarn shaka-perf compare --categories perf --filter "<test name>"`.
- Full check before pushing: `yarn shaka-perf compare`
  (exit 0 = clean; a completed failed run prints `FAILED: <summary>`; other
  non-zero exits are harness/configuration errors).
- Machine-readable results: `compare-results/report.json` — per-test `chips`
  (`regression`, `visual change`, `broken`, and the `accessibility regression` /
  `accessibility error` / `accessibility blocked` chips fail the run).
  Visreg detail: `yarn shaka-perf discover-abtests parse-report`.
- A perf `regression` = p < 0.05 AND the paired estimate exceeds the configured
  threshold — iterate on the code and re-run the filtered compare; confirm with a
  full run before pushing.
- Writing/editing `.abtest.ts` files: follow `.claude/skills/assess-abtest-quality/SKILL.md`
  (fail loudly: no try/catch, no loops, no if-branches; wait for conditions, not time).
````

## Known gaps on the agent roadmap

Tracked and in flight — linked here so agents don't reverse-engineer stale assumptions: populated machine summaries [#68](https://github.com/shakacode/shakaperf/issues/68), published report schema [#69](https://github.com/shakacode/shakaperf/issues/69), `verdict` command + exit codes [#70](https://github.com/shakacode/shakaperf/issues/70), `--quick` iteration preset [#71](https://github.com/shakacode/shakaperf/issues/71), agent-portable test discovery [#73](https://github.com/shakacode/shakaperf/issues/73), `doctor` preflight [#74](https://github.com/shakacode/shakaperf/issues/74), GitHub Actions [#76](https://github.com/shakacode/shakaperf/issues/76), PR-comment reporter [#77](https://github.com/shakacode/shakaperf/issues/77), MCP server [#78](https://github.com/shakacode/shakaperf/issues/78).
