---
name: shaka-perf-find-bugs
description: "Use twin servers to search for bugs introduced in this PR or branch. Use this skill when asked to check if PR introduces bugs."
allowed-tools: Bash Read Grep Glob Edit Write Agent
---

# QA with local twin servers

## Browser selection and setup

Before live browser work, use Claude Chrome tools when available in Claude Code;
otherwise use `agent-browser` (including non-Claude agents). Read the exposed tool
descriptions and `agent-browser --help` plus relevant command help. Follow the
session's permissions and browser restrictions; report a blocker if this route
is prohibited or lacks an essential capability. HTTP responses do not verify UI.

Check `command -v agent-browser` before using the CLI. If missing, provide
`npm install -g agent-browser` or, on macOS, `brew install agent-browser`. Install
it when the session authorizes package installation. `npx skills` installs
instructions, not this executable or a browser.
ShakaPerf's global installation does not guarantee a downloaded browser either.

For standalone inspection, choose a unique `AB_SESSION` per worker and open the
requested `URL` with `agent-browser --session "$AB_SESSION" open "$URL"`.
Allow automatic detection of existing Chrome/Chromium. If detection fails, inspect
the effective ShakaPerf browser options for `executablePath` or `channel`. Resolve
its active package from the CLI symlink or development wrapper, then load that
package's `playwright` with Node `createRequire` rooted there (and its Yarn PnP
runtime for a source install); inspect `chromium.executablePath()` and check that
the file exists. Do not resolve the target project's unrelated Playwright or
hard-code a machine path. Retry with
`agent-browser --session "$AB_SESSION" --executable-path "$BROWSER_EXECUTABLE" open "$URL"`.
This reuses the binary but launches a new process; it does not attach to ShakaPerf.
If no compatible browser exists, stop and provide the platform's
[Chrome installer](https://www.google.com/chrome/) or Chromium package instructions.
For a missing ShakaPerf Playwright build, use the exact bundled Playwright
installation command printed by ShakaPerf's error.

For troubleshooting, wait until the relevant side is parked: visreg logs
`Test completed`; perf labels its page `[PERF]` after its test function settles.
A session manifest alone does not establish readiness. Run
`shaka-perf troubleshoot session` in the application's directory and use
the endpoint printed for the desired side:
`agent-browser --session "$AB_SESSION" connect "$CDP_ENDPOINT"`.
List tabs with `agent-browser --session "$AB_SESSION" tab`, match the full
control/experiment URL, then select its returned tab ID with `tab "$TAB_ID"`.
The reported URLs are starting targets. If the test navigated, use its known
navigation and the side's origin to identify the parked tab. If identity remains
ambiguous, resolve it before interacting; do not guess.
Visreg's endpoint contains both sides; perf endpoints are per side. Confirm
`get url` before interacting. Never assume port 9222, auto-attach to another
browser, or manipulate browsers during active measurements.

Keep the selected session and tab for subsequent commands. Use separate sessions
and tabs for parallel workers; an agent-browser session has one active tab.
Finish with `agent-browser --session "$AB_SESSION" close`: it closes browsers
launched by that session and only disconnects from external CDP browsers.
Do not run `tab close` on ShakaPerf-owned tabs. With Claude Chrome, retain the tab
ID, follow the tool's lifecycle rules, and close only tabs created by this skill.

Use Claude `mcp__claude-in-chrome__tabs_context_mcp` / `tabs_create_mcp` to obtain
a tab and `navigate` to open the URL; retain that ID. For inspection and actions,
use Chrome `read_page` / `find` / `computer` / `form_input`, or agent-browser
`snapshot -i` followed by `click`, `fill`, `check`, and `select`. Run page probes
with Chrome `javascript_tool` or agent-browser `eval --stdin`. Capture with
Chrome `computer` with its screenshot action or agent-browser
`screenshot "$SCREENSHOT"`, then inspect the image with Claude `Read`, Codex
`view_image`, or another image viewer.
Resize with Chrome `resize_window` or agent-browser `set viewport <width> <height>`,
and verify `window.innerWidth` / `window.innerHeight` through page JavaScript.
Use Chrome `computer` with its scroll action or agent-browser
`mouse wheel <delta>` for incremental scrolling; agent-browser `scroll` uses
JavaScript. Pass the chosen
`--session "$AB_SESSION"` on every agent-browser browser command.

Use file/search, editing, and shell tools: Claude `Read` / `Grep` / `Glob` / `Edit` / `Write` / `Bash`, Codex `exec_command` / `apply_patch`, or equivalents. The `allowed-tools` field retains Claude tool names; it is not a Codex permission grant. Use the browser setup above for live verification.

Two checkouts side by side: the configured `twinServers.controlDir` (the base) and `twinServers.experimentDir` (the change under test). Same seed data, two servers. Your job is to find something that misbehaves on experiment and works on control.

Ports and hosts come from the configured application's `abtests.config.ts` (`shared.controlURL`, `shared.experimentURL`, and `twinServers.ports`).

## 0. Understand when using this skill is an overkill.

Some obvious crashes or typos in known API calls don't need to have a reproduction. If you found something super obvious, skip the reproduction steps.

## 1. Sanity-check twin-servers commits

What commits are checked out in `twinServers.experimentDir`/`twinServers.controlDir`? Usually control should contain the merge-base with the main branch. Or it can be the previous PR in `gh stack` (given it's installed). If the control branch looks off, ask which branch to use as control with Claude `AskUserQuestion`, available Codex question tools, or ordinary conversation. Wait for the answer, then run the corresponding `shaka-perf servers checkout` command.

## 2. Read the diff first

`git diff <control-sha>` from the experiment checkout. Before touching a browser, write down three to five concrete guesses of what could break and the page or action that would show it. Memoization, cached selectors, and context changes tend to break on the second interaction, not the first: add an item, then change it, then remove it.

## 3. Boot the servers

See [the twin-server lifecycle guide](https://github.com/shakacode/shakaperf/blob/main/packages/shaka-perf/README-twin-servers.md) to understand the desired experiment/control layout and server lifecycle. Use the configured application's `abtests.config.ts` for databases, seed setup, and build commands. Run the following from that application's directory (`demo-ecommerce` for this repository's demo):

```bash
yarn shaka-perf servers build
yarn shaka-perf servers start-containers
yarn shaka-perf servers start-servers   # run in a persistent background session
```

The start-servers command runs Overmind and blocks until stopped. Use the documented subcommands to rebuild or restart; no stdin keepalive pipe is needed. Wait until both configured application URLs are ready.

## 4. Reproduce

Follow the project's browser interaction instructions and the selected browser setup above.

Drive a real browser; HTTP requests or a delegated report alone cannot verify a UI regression. If required browser capabilities are unavailable, report the blocker. Prefer headless mode when supported; attached browser integrations may run visibly.

Do every step on both servers in the same order and take a screenshot at each step where you expect a difference. Save screenshots under `tmp/twin-qa/`. View them with Claude `Read`, Codex `view_image`, or an equivalent image viewer.

Navigate each side with Claude Chrome `navigate` or agent-browser `open`, interact
with Chrome `computer` / `form_input` or agent-browser `click` / `fill`, then capture
using Chrome `computer` with its screenshot action or agent-browser `screenshot tmp/twin-qa/<side>.png`.
Use separate agent-browser session names per side and pass `--session` each time.
After Chrome `resize_window` or agent-browser `set viewport`, verify
`window.innerWidth` and `window.innerHeight` through `javascript_tool` or `eval`;
match those dimensions and scroll positions before capturing both sides.

Seeds not enough? Edit the application's seed data or fixtures, then apply the same data to both sides using the project's seed commands (see `twinServers.setupCommands` in the application's `abtests.config.ts`).

The main thing is whenever you change something you must update both sides' databases (control and experiment), and reset caches in both.

Then kill and relaunch servers. 

If you can't confirm the regression, return to step 2 and try a different hypothesis or reproduction approach, up to three additional attempts. If it remains unconfirmed, discard it from the bug findings. If no regressions are confirmed, report "No confirmed regressions found" and briefly summarize what was tested and any testing blockers.

## 5. Report confirmed bugs

Write `/tmp/shaka-perf/reproduction-steps-<short-bug-description>.html`, one bug per file, by copying `assets/report-template.html` (next to this SKILL.md) and filling in every `{{PLACEHOLDER}}`. Keep the template's markup, styles, and script; do not restyle or restructure it (except for adding items to lists).

The report always opens with the templated section, and nothing goes above it:

1. `Discovered Bug: <one-line headline>` - the user-visible symptom, not the cause.
2. Reproduction steps panel - numbered steps, then `Expected (control): ...` and `Actual (experiment): ...`.
3. Paired screenshots stage - control left, experiment right, titled with the branch names only (the experiment title may link the PR); annotations in the center gap with a green arrow to the correct element on control and a red arrow to the broken element on experiment; one verdict line under each side.

Everything else follows below it, in the template's order: the two SHAs, the explanation SVG, relevant sources.

Screenshot rules:
1. Always paired - an experiment shot without its control shot proves nothing.
2. Same step, same viewport, same scroll position on both sides.
3. Mobile viewport when the bug shows there; it takes less space. Desktop-only bugs may use full-desktop shots. If the element is below the fold, capture with a taller viewport instead of scrolling.
4. Inline as base64 PNG; crop with the template's img height/margin, not by editing the PNG.

The template's two copy buttons are what make the report pasteable into a PR. "Copy markdown" copies the headline, the numbered steps, expected/actual, and every section below the screenshots as one markdown block with a slot for the image. "Copy image" copies the screenshot stage as one PNG with the titles, annotations, and verdicts baked in (an SVG overlay does not survive a paste, a flattened image does); it is pasted separately. Keep all text in those sections and all screenshot content inside the stage.

After you proved the bug exists, you need to explain it. If delegation is available and authorized by the session, use Claude `Agent`, Codex `spawn_agent`, or an equivalent with "Draw an insightful SVG explaining <bug description>. Use available browser automation to polish it. Don't stop iterating until it is clean and insigthful. You are expected to run at least 2 iterations. The SVG can contain 30 words top. Before you start drawing you have to plan what you will show to the user, don't expect them to be familiar with implementation details. Get creative." If delegation is unavailable or unauthorized, create and review the SVG yourself using the same requirements.

In the "Why it happens" section, write the explanation in plain language, 70 words max, then inline that SVG under it, and list the relevant sources in the section below. Screenshot PNGs should be inlined as base64.
