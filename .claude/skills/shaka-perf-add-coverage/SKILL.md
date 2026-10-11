---
name: shaka-perf-add-coverage
description: Use when source code is available and the user asks to add ShakaPerf A/B tests or improve A/B tests coverage for specified UI components or rendered states. Also use when asked to deduplicate A/B tests. Also use when asked to measure FE performance.
argument-hint: what elements to cover. Might be path or textual description of a component or a set of components.
---

# shaka-perf-add-coverage

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

Your goal is to add tests without unnecessarily bloating the test suite. The endgoal is all the interested components should be screenshoted without duplication (happy paths only).

## Inputs and tools

The input is a path or description of the components or rendered states to cover.
Use file, search, edit, and shell tools: Claude `Read` / `Grep` / `Glob` / `Edit` / `Bash`, Codex `exec_command` / `apply_patch`, or equivalents.
Inspect screenshots with Claude `Read`, Codex `view_image`, or an equivalent image viewer.

**REQUIRED SUB-SKILL:** Load [shaka-perf-coverage](../shaka-perf-coverage/SKILL.md) to estimate coverage, save the pre-edit baseline, read snapshots, and compare the final coverage.
Invoke it as Claude `/shaka-perf-coverage`, Codex `$shaka-perf-coverage`, or read its sibling file directly.
If missing, ask the user to install it with `npx skills add shakacode/shakaperf --skill shaka-perf-coverage --agent <agent>` before estimating coverage.

## The loop
0. Run `shaka-perf audit --help`, `shaka-perf compare --help`, and `shaka-perf troubleshoot --help`
1. IMPORTANT find other ab tests that cover this element already. Produce a comma-separated tests filter (referenced as `relevant-tests`).
1.a Produce `relevant-sources` for the components under test (defined in `shaka-perf-coverage`). Keep it narrow and identical across baseline comparisons. A source missing from it is a hole you will never see.
2. Use the `shaka-perf-coverage` skill to audit `relevant-tests` and save the BEFORE baseline for `relevant-sources`, before editing tests.
3. If the element is fully covered by estimated coverage, check it is actually visible on screenshots: 
    - 3.a. Find the element's line in the snapshot and read its screenshot cell and reason (table in `shaka-perf-coverage`).
    - 3.b. Use `shaka-perf troubleshoot` when the snapshot is ambiguous or you need to see the live page — occlusion is a sampled estimate, measured only inside the current viewport. Wait for the `Test completed` log entry before inspecting.
    - 3.c. Generate screenshots with `shaka-perf compare --categories=visreg --filter=<relevant-tests> --controlURL=<experiment-url>` and review the screenshots visually.
4. If the screenshot cell is below 100%, fix it per the reason table. If the element is dead code, DO NOT EDIT PROD FILES TO MAKE IT RENDERED.
5. If these fixes are not enough for the coverage and you genuinely need to add more tests, write them and add them to `relevant-tests`.
6. If `relevant-tests` violate any rules in https://github.com/shakacode/shakaperf/blob/main/writing-good-ab-tests.md, fix them
7. Run `shaka-perf compare --categories=visreg --filter=<relevant-tests> --controlURL=<experiment-url> --burn 3` and fix all the flakiness coming from tests themselves. Do not fix flaky errors on the page or in the server, instead let the user know there is a bug and give them reproduction cmd (the failing --burn command you were running). Tell them that the problem is in the App, not in the tests.
8. Adversarially review steps 3-6 for missed coverage. Use Claude `Agent`, Codex delegation tools such as `spawn_agent`, or equivalents only when available and authorized by the session. Otherwise do a separate self-review pass.
9. Re-audit, save the AFTER baseline, and `diff` it against the BEFORE (per `shaka-perf-coverage`). Restart from 3 with the AFTER as the new BEFORE.

Stop the loop when all the components are fully covered by hi-quality tests that don't flake.

Caveat: `audit-results/` and `compare-results/` keep unit dirs from earlier filtered runs and their names are not chronological; read only the ids listed in each run's `report.json`.
