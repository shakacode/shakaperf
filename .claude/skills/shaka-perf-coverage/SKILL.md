---
name: shaka-perf-coverage
description: Use to check if there are A/B tests for some scenario. Load this skill when asked about performance and visual regression testing.
---

# shaka-perf-coverage

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

Use file/search and shell tools: Claude `Read` / `Grep` / `Glob` / `Bash`, Codex `exec_command`, or equivalents. Resolve `<skill-dir>` to this installed skill folder, independent of the application working directory. Inspect screenshots with Claude `Read`, Codex `view_image`, or an equivalent image viewer.

Estimate **screenshot coverage**: not "how many lines did the tests run", but "did the elements those lines render end up in a screenshot".

Shaka-perf is a performance framework, not a replacement for cypress/playwright. If you need 100% code coverage and want  to hunt edge cases, use some other tool. The reason is: shaka-perf is computationaly expensive. The cheapest run `shaka-perf compare --categories=visreg` runs the tests two times minumum. Also, it takes screenshots, so the slightest flakiness will cause retries. Shaka-perf is good for covering happy paths, and bad for covering every single use case.

Good A/B-test coverage is not `95% of lines covered`; it is `100% of the important elements are in a screenshot`. Code coverage is only one of the signals we use to get there.

# The most important thing

Depending on prompt, determine the full list of files with components you care about.
Again, shaka-perf is a screenshot tool, so ultimately the only thing we care are files with UI components.

Your one input is the **list of sources** to estimate. Everything else — which test executed which statement, what each screenshot showed of each element, and the join between the two — is read off the audit run by code.

## Getting the data

The `code_coverage` audit category writes, per test and viewport, `coverage.json` (which statements ran) and `visibility-map.txt` (how much of each rendered element falls inside the test's `visregSelectors`, and the app source line that rendered it) into `audit-results/<unit>/artifacts/`.

```bash
shaka-perf audit --categories code_coverage --url <dev build> --filter <relevant-tests>
```

Two things must hold, and both are the user's to fix, not yours to work around:

- **The bundle is instrumented.** The stage fails a unit whose page has no `window.__coverage__`. If it did, STOP and say so: the fix is `babel-plugin-istanbul`, `nyc instrument`, or `swc-plugin-coverage-instrument` (see the [demo instrumentation example](https://github.com/shakacode/shakaperf/blob/main/demo-ecommerce/config/rspack/clientWebpackConfig.js)). Never estimate around it — a visibility map alone says what is on screen, not which test's code put it there.
- **The build carries sources.** `audit.screenshotCoveragePlugin` is set in `abtests.config.ts`, and the audited URL serves a DEVELOPMENT React build — `'react18'` needs the JSX source transform (`@babel/preset-react` `development: true`), `'react19'` a fetchable source map. Point `--url` at twin servers running the opt-in instrumented development mode from [shaka-perf-dockerize](../shaka-perf-dockerize/SKILL.md#instrumentation), or at a dev server of the same code. Default production twin-server builds do not provide this source information.
  For other frameworks, introduce a custom screenshot coverage plugin; if the framework makes that impossible, manually tag the tested components and assess screenshot coverage by those unique identifiers.

If either fails (the stage reports no `window.__coverage__`, or `save` says `impossible to estimate`), HALT and ask using Claude `AskUserQuestion`, Codex `request_user_input` / `request_user_input_async` when available, or ordinary conversation. Offer the fixes: instrument the bundle (`babel-plugin-istanbul` / `nyc instrument` / `swc-plugin-coverage-instrument`); set `audit.screenshotCoveragePlugin` and audit a dev server; write a custom plugin; or manually tag the components. Wait for the answer.

## Saving and diffing baselines

```
node <skill-dir>/coverage-baseline.mts save "<relevant-sources>"
node <skill-dir>/coverage-baseline.mts list
node <skill-dir>/coverage-baseline.mts diff                          # the last two snapshots
node <skill-dir>/coverage-baseline.mts diff <older-dir> <newer-dir>
```

`<relevant-sources>` is a comma-separated list of regexes matched against paths under `app/javascript`: narrow enough to name the components in question, and **reused verbatim for every save** — changing it makes the diff meaningless.

`save` writes a timestamped directory under `audit-results/coverage-baselines/` — one file per source, mirroring its path, plus `legend.txt` mapping test letters to test names. It never overwrites.

To snapshot a run whose `audit-results/` has since been overwritten: `AUDIT_ROOT=<stashed-dir> node <skill-dir>/coverage-baseline.mts save "<relevant-sources>"`.

### Reading a snapshot

Each line is the source line, then its measurements as a trailing comment:

```text
<source line>  // <tests that executed it> | <what a screenshot showed>
```

```text
  return (                                          // A+B   |
    <nav className="site-nav" data-cy="main-nav">   //       | A=100%,B=0%
      <div className="slide">                       //       | A=33%:clipped-by-ancestor,B=0%
      <button onClick={openCart}>Cart</button>      // 0     |
```

- The coverage field sits on statement lines: `A+B` executed it, `0` no test reached it, blank means no statement starts there, `never loaded` means nothing fetched the chunk.
- The screenshot field sits on the ELEMENT's own line, one cell per test that executed the statement drawing it: the MAX share of the element any screenshot of that test showed, across its viewports. `0%` is a test that ran the code and showed none of the element. Below 100%, the dominant reason rides along:

| reason | what happened | what to do about it |
| --- | --- | --- |
| `not-rendered` | no box at all — `display:none`, never mounted, empty inline | the state the test leaves the page in never shows this element; drive the test to the state that does |
| `hidden-by-CSS` | `visibility:hidden`, `opacity:0`, or `content-visibility:hidden` | same — or it is a deliberate hide (a captcha, a transition end state) |
| `clipped-by-ancestor` | an ancestor's `overflow` crops it (carousel track, scroll box) | only the crop is coverage; scroll/advance the component in the test if the rest matters |
| `outside-capture` | it falls outside this test's `visregSelectors` region | widen `visregSelectors`, or use a taller viewport if it is below the fold |
| `obscured` | something is painted on top: modal, sticky bar, cookie banner (sampled, so approximate) | dismiss the overlay in the test body, or accept that this test cannot cover it |

- A source with high statement coverage and no element line above `0%` is the signature this skill exists to catch: the component runs and paints nothing. Chase the gate — a rollout flag, missing data, an early `return null` — before believing the coverage number.

### Reading a diff

`diff` writes `<newer>--vs--<older>.diff/`:

- **`summary.txt`** — per source, elements seen before → after → delta and at 0%, then statements covered. Read this first; it is usually the whole verdict.
- **one `.diff` per source, and ONLY for sources that changed.** The listing is the index: `ls` names the components that moved, `wc -l` ranks them.

**Lead every report with the screenshot numbers.** `seen → seen` answers the question this skill asks; `covered → covered` only says a test executed the code. When they disagree, the screenshot column is the truthful one.

- a percentage falling to `0%` while the coverage field never moved is a screenshot that stopped showing the element — usually a layout change pushing it out of the capture
- a line that gained a letter but stayed `0%` gained nothing a screenshot can show
- a letter leaving the legend means a test stopped touching these sources
- a MODULE-LEVEL statement gains letters when its chunk is fetched, not when the component renders — a `.diff` whose only changes sit outside function bodies moved no pixels
- two runs against DIFFERENT SERVERS can disagree on which line a statement starts; when whole files show as rewritten, compare per-file counts, not lines

