---
name: shaka-perf
description: Map of the shaka-perf CLI. Load whenever a task mentions shaka-perf, twin servers, perf or visreg A/B tests, or asks what shaka-perf can do — then run the command's `--help` before using it.
---

# shaka-perf

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

`shaka-perf` is a frontend performance toolkit: it runs your app twice in Docker
(control = main, experiment = your branch) and diffs screenshots, Web Vitals,
Lighthouse, and accessibility between them. In a Yarn project call it as
`yarn shaka-perf`.

**The `--help` output is the documentation.** Before running any command, run
`shaka-perf <command> --help` and follow it. Do not guess flags from memory.

| Command | What it does |
| --- | --- |
| `shaka-perf init` | Creates `abtests.config.ts`. |
| `shaka-perf servers` | Builds and runs the control/experiment Docker pair. Bare `servers` is an interactive menu for humans; agents use its subcommands (`build`, `checkout`, `start-containers`, `start-servers`, `stop-containers`, `run-cmd`, `sync-changes`). |
| `shaka-perf compare` | Runs every `.abtest.ts` on both sides and writes the A/B report (visreg, perf, accessibility). |
| `shaka-perf troubleshoot` | Runs one test at one viewport and leaves the browsers open for inspection over CDP. Never finishes; not for measuring. |
| `shaka-perf bisect` | Finds the first commit behind each compare regression. |
| `shaka-perf audit` | Lighthouse + accessibility audit of a single URL, no twin servers needed. |
| `shaka-perf client-report` | Plain-language site-health report from a saved audit. |
| `shaka-perf processes` | Watches running shaka-perf processes. Useful to catch memory leaks |

Start here:

```bash
shaka-perf --help
shaka-perf servers --help
shaka-perf compare --help
```

Setup from scratch uses [shaka-perf-dockerize](../shaka-perf-dockerize/SKILL.md); writing tests uses
[shaka-perf-add-coverage](../shaka-perf-add-coverage/SKILL.md); checking coverage uses
[shaka-perf-coverage](../shaka-perf-coverage/SKILL.md); hunting regressions uses
[shaka-perf-find-bugs](../shaka-perf-find-bugs/SKILL.md). Load the named skill or read its sibling file.
If a required companion is missing, ask the user to install it with `npx skills add shakacode/shakaperf --skill <name> --agent <agent>`.

## Agent capabilities and invocation

Use Claude Code `/shaka-perf`, Codex `$shaka-perf`, or ask any compatible agent to use the skill by name.
Use available file and shell tools: Claude `Read`, `Grep`, `Glob`, and `Bash`; Codex `exec_command` with file/search commands; or equivalents.
View screenshots with Claude `Read`, Codex `view_image`, or an equivalent image viewer.
For questions, use Claude `AskUserQuestion`, Codex `request_user_input` / `request_user_input_async` when available, or ordinary conversation; wait when an answer is required.
Inspect available tool descriptions and follow their restrictions. Tool names and MCP prefixes vary by host; skill metadata does not grant permissions.

Read this guide before writing or editing a test.
https://github.com/shakacode/shakaperf/blob/main/writing-good-ab-tests.md.


Whenever you are talking about results of your findings with users, give them full path to the generated report.
If you are running multiple tests, save self-contained-report.html to a temporary file, so you can show it later.
Showing actual reports is way more important than your conclusions, so attach it to the footer of your responses.
