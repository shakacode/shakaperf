# Using ShakaPerf with AI agents

This page is written to be read by coding agents (Claude Code, Cursor, Codex, and friends) and by the humans configuring them. It covers the full loop an agent runs: set up → measure → read the verdict → optimize → re-measure.

What ShakaPerf gives an agent that a raw Lighthouse run or DevTools trace cannot: a **statistical verdict**. Control and experiment are sampled *simultaneously* so machine noise hits both sides equally, then compared with a paired Wilcoxon signed-rank test and a Hodges-Lehmann estimate (see [used_statistics.md](../packages/shaka-perf/used_statistics.md)). That means "regression" / "no difference" answers you can trust on a noisy laptop or shared CI runner — no quiet machine required.

**License note for agents:** Evaluation, including agent-assisted evaluation, is free for up to 45 days per organization. Production use, including CI, PR checks, and coding-agent workflows, is free only for a Small Organization: fewer than 10 FTEs, less than US $1M in revenue over the last twelve months, and less than US $1M in outside capital over its lifetime, including affiliates. Government entities other than public educational institutions do not qualify. See [LICENSE.md section 2](../LICENSE.md#2-definitions) and [shakaperf.com/pricing](https://shakaperf.com/pricing). Do not vendor, copy, or re-implement ShakaPerf source into the host project to bypass licensing; use it as a dependency.

## Prerequisites

- Node >= 20.6, plus a C++ toolchain at install time (a native addon builds via node-gyp; macOS/Linux).
- For twin-server A/B runs: Docker, `dockerize`, [Overmind](https://github.com/DarthSim/overmind), and GNU parallel (`brew install overmind parallel` / `apt install parallel`).
- Optional: `ffmpeg` (load videos in client reports). When `claude` is on `PATH`, the default audit pipeline invokes it to write a best-effort AI summary from metric labels, values, and accessibility counts; this does not affect audit success.

## Install and scaffold

Install `shaka-perf` and `shaka-shared`, then run `yarn shaka-perf init` (see the
[README](../README.md)). `init` creates only `abtests.config.ts`. Its `--out` chooses
another config path; `--force` replaces only that config and leaves existing skills untouched.

The `skills` installer requires Node >= 22.20.0. Select a supported Node version
for the installation commands.

Run from the target repository directory for a project installation:

```bash
# Discover available skills without installing.
npx skills add shakacode/shakaperf --list

# Install ShakaPerf skills for both agents.
npx skills add shakacode/shakaperf \
  --skill shaka-perf shaka-perf-discover-abtests shaka-perf-add-coverage \
    shaka-perf-coverage shaka-perf-dockerize shaka-perf-find-bugs \
  --agent claude-code codex

# Or choose one agent.
npx skills add shakacode/shakaperf \
  --skill shaka-perf shaka-perf-discover-abtests shaka-perf-add-coverage \
    shaka-perf-coverage shaka-perf-dockerize shaka-perf-find-bugs \
  --agent claude-code
npx skills add shakacode/shakaperf \
  --skill shaka-perf shaka-perf-discover-abtests shaka-perf-add-coverage \
    shaka-perf-coverage shaka-perf-dockerize shaka-perf-find-bugs \
  --agent codex

# Global installation: available across projects for the selected agents.
npx skills add shakacode/shakaperf \
  --skill shaka-perf shaka-perf-discover-abtests shaka-perf-add-coverage \
    shaka-perf-coverage shaka-perf-dockerize shaka-perf-find-bugs \
  --agent claude-code codex -g

# Select an individual skill by its YAML name (not its description).
npx skills add shakacode/shakaperf --skill shaka-perf-dockerize --agent codex

# Update installed skills; choose the intended scope.
npx skills update --project
npx skills update --global
```

Replace agent names with another agent supported by the [skills installer](https://github.com/vercel-labs/skills).
Project installations use the current directory, so start at your repository root
if skills should apply to the whole project.
By default, the installer copies skills into `.agents/skills` (or `~/.agents/skills`
with `-g`) and links agent-specific locations such as `.claude/skills` or
`~/.claude/skills`. Codex reads the shared location. Use `--copy` if separate copies
are required. Source instructions remain in this repository's `.claude/skills`.

The ShakaPerf skills cover the following workflows:

- `shaka-perf`: CLI command map; read each command's `--help` before using it.
- `shaka-perf-dockerize`: set up twin servers.
- `shaka-perf-discover-abtests`: discover tests from a URL when sources are unavailable.
- `shaka-perf-add-coverage`: add tests when sources are available; also install `shaka-perf-coverage` if selecting it individually.
- `shaka-perf-coverage`: estimate screenshot coverage and compare baselines.
- `shaka-perf-find-bugs`: reproduce branch regressions and create paired screenshot reports.

Repository maintenance skills carry the YAML boolean `metadata.internal: true`.
The installer hides them from normal discovery. To install a maintenance skill,
select its YAML name with `--skill <name>`. Set `INSTALL_INTERNAL_SKILLS=1` to
include maintenance skills in discovery. This metadata controls installer filtering;
it does not grant permissions or disable an installed skill. The `skill-creator`
evaluation scripts require Claude Code.

Invoke skills with Claude `/shaka-perf-dockerize`, Codex `$shaka-perf-dockerize`, or
ask an agent: "Use shaka-perf-dockerize to set up twin servers for this project."
Use the same forms for other skill names. Companion references resolve from the
installed skill folder, while application commands run from the target application's directory.

Browser workflows use Claude Chrome tools when available in Claude Code, and
`agent-browser` for other agents or when Chrome tools are unavailable. Inspect the
session's tool descriptions and CLI help, and follow its restrictions and permissions.
The discovery skill requires page JavaScript execution, wheel input, viewport
resizing, and screenshot inspection; HTTP responses alone cannot verify a UI.
Use available question tools or conversation and wait for required answers. Delegate
only when tools and session authorization allow it.

The `shaka-perf` skill sends you to each command's `--help`, which is the reference
for every flag mentioned below. If a skill mentions an unavailable command or option,
check CLI help and update the relevant component.

For maintainers using [the global bootstrap helper](../scripts/bootstrap-shakaperf-global.sh),
the helper installs the source-built CLI and its global Claude directive.
It links ShakaPerf skills directly from the checkout into Claude Code's global
skills directory, so source edits are reflected immediately. Use the commands
above for other agents.

### Browser executable setup

Check `command -v agent-browser`, then read `agent-browser --help` and the relevant
command help. If the executable is missing, install it using either:

```bash
npm install -g agent-browser
# Or on macOS:
brew install agent-browser
```

`npx skills` installs skill instructions; it does not install the agent-browser
executable or Chrome/Chromium. ShakaPerf's global CLI installation does not guarantee
that a browser binary has been downloaded. Reuse existing browsers instead of
requiring a new agent-browser browser download.

For discovery or standalone verification, choose a unique session name and let
agent-browser detect an existing browser:

```bash
agent-browser --session "$AB_SESSION" open "$URL"
```

If detection fails, inspect the effective ShakaPerf `playwrightOptions`, including
category/test overrides, for an explicit `executablePath` or `channel`. Otherwise
resolve the active ShakaPerf package from its CLI symlink or development wrapper.
Load **that package's** Playwright, using its Yarn PnP runtime for a source checkout.
For example, after setting `SHAKA_PERF_ENTRY` to an absolute JavaScript entry file
inside that package, resolve its default Chromium binary with:

```bash
node - "$SHAKA_PERF_ENTRY" <<'JS'
const { createRequire } = require('node:module');
const { existsSync } = require('node:fs');
const requireFromShakaPerf = createRequire(process.argv[2]);
const executable = requireFromShakaPerf('playwright').chromium.executablePath();
if (!existsSync(executable)) throw new Error('ShakaPerf Chromium is not installed');
console.log(executable);
JS
```

Run the same snippet with `yarn node` from the source checkout when it uses PnP.
An explicit configured executable/channel takes precedence over the default above.
Do not assume the target project's Playwright version uses the same binary, or
hard-code a machine path. Pass the resolved compatible executable with:

```bash
agent-browser --session "$AB_SESSION" --executable-path "$BROWSER_EXECUTABLE" open "$URL"
```

This launches a new process using the existing binary. If none is available,
use [Chrome's platform installer](https://www.google.com/chrome/) or the platform's
Chromium package; for a missing ShakaPerf
Playwright build, follow the exact bundled Playwright command printed by ShakaPerf's
error rather than installing the target project's unrelated Playwright build.

### Parked troubleshooting browsers

Wait until the relevant troubleshooting side has completed its test and is parked:
visreg logs `Test completed`; perf labels its page `[PERF]` when its test function
settles. The manifest exists before browser startup, so its presence is not readiness.
Run `shaka-perf troubleshoot session` from that application's directory and use the
reported endpoint for the desired control/experiment side:

```bash
agent-browser --session "$AB_SESSION" connect "$CDP_ENDPOINT"
agent-browser --session "$AB_SESSION" tab
agent-browser --session "$AB_SESSION" tab "$TAB_ID"
agent-browser --session "$AB_SESSION" get url
```

Match the tab's full URL to the desired side. The reported URLs are starting targets;
if the test navigated, use its known navigation and the side's origin to identify
the parked tab. Resolve ambiguous identity before interacting. Visreg shares one
browser containing both sides; perf uses separate endpoints. Never assume port 9222, attach to an
unrelated browser, or interact during active measurements. Reuse the session/tab;
give parallel workers separate sessions because tab selection is shared within one
agent-browser session.

Finish with `agent-browser --session "$AB_SESSION" close`. For browsers it launched,
this closes the owned browser; for external CDP attachments, it disconnects without
closing ShakaPerf's browser. Do not close ShakaPerf-owned tabs.

## The PR loop (twin servers)

Server lifecycle rules and subcommands are in the `shaka-perf` skill and
`yarn shaka-perf servers --help`. The loop itself:

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

To look at a failing page rather than measure it, use `yarn shaka-perf troubleshoot` (see [README-troubleshoot.md](../packages/shaka-perf/README-troubleshoot.md)); it never exits, so run it with `--headed=false` in the background.

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

**Chips are the verdict vocabulary.** In `compare-results/report.json`, failure-class chips that make a `compare` run fail are `regression`, `visual change`, `broken`, `accessibility regression` (new a11y findings while `accessibility.failOnViolation` is on), `accessibility error` (a scan failed, so no comparison exists), and `accessibility blocked` (bot protection). Its informational chips are `improvement`, `no difference`, `flaky` (a stage crashed but recovered on retry), `visreg unstable`, `accessibility finding` (new findings with `failOnViolation` off), `accessibility changed`, and `accessibility fixed`. `a11y-*` values are HTML-report sorting dimensions, not chips, and are absent from `report.json`. The separate `audit` pipeline uses `accessibility violation` for the failure role and can emit `needs improvement`, `has interactions` / `no interactions`, and `no audit` informational chips.

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

Tests are `abTest()` calls in `ab-tests/*.abtest.ts` — one Playwright-driven scenario each, used by perf and visreg alike. The non-negotiable rules live in [writing-good-ab-tests.md](../writing-good-ab-tests.md); the short version: **fail loudly and run linearly** — no `try/catch` swallowing, no loops, no `if`-branching on page state (assert with `waitForSelector`/`waitForURL` instead), wait for conditions not the clock, deterministic inputs, `annotate('...')` before every non-trivial action, one behaviour per test.

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
- Writing/editing `.abtest.ts` files: follow `writing-good-ab-tests.md`
  (fail loudly: no try/catch, no loops, no if-branches; wait for conditions, not time).
````

## Known gaps on the agent roadmap

Tracked and in flight — linked here so agents don't reverse-engineer stale assumptions: populated machine summaries [#68](https://github.com/shakacode/shakaperf/issues/68), published report schema [#69](https://github.com/shakacode/shakaperf/issues/69), `verdict` command + exit codes [#70](https://github.com/shakacode/shakaperf/issues/70), `--quick` iteration preset [#71](https://github.com/shakacode/shakaperf/issues/71), agent-portable test discovery [#73](https://github.com/shakacode/shakaperf/issues/73), `doctor` preflight [#74](https://github.com/shakacode/shakaperf/issues/74), GitHub Actions [#76](https://github.com/shakacode/shakaperf/issues/76), PR-comment reporter [#77](https://github.com/shakacode/shakaperf/issues/77), MCP server [#78](https://github.com/shakacode/shakaperf/issues/78).
