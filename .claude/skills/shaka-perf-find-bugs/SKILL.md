---
name: shaka-perf-find-bugs
description: "Use twin servers to search for bugs introduced in this PR or branch. Use this skill when asked to check if PR introduces bugs, or to smoke test a PR."
argument-hint: "[pr-number|branch|commit] [qa-instructions.md]"
allowed-tools: Bash Read Grep Glob Edit Write Agent
---

# QA with local twin servers

`allowed-tools` lists Claude tool names; other hosts follow their own permissions.

Two checkouts side by side: the configured `twinServers.controlDir` (the base) and `twinServers.experimentDir` (the change under test). Same seed data, two servers. Your job is to find something that misbehaves on experiment and works on control.

Ports and hosts come from the configured application's `abtests.config.ts` (`shared.controlURL`, `shared.experimentURL`, and `twinServers.ports`).

## Arguments

All are optional, in any order:

1. What to test: a PR number or URL, a branch name, or a commit SHA. Default: the PR of the current branch.
2. A markdown file with manual QA instructions, usually Gherkin (`Given/When/Then`) scenarios copied from the ticket. When given, every scenario is a mandatory test case: run each one on both servers in step 4 even if the diff gives no reason to expect a problem there. Your ultimate goal is to find a bug, not just follow the instructions.

## QA folder

Keep resulting reports outside the repo:

```bash
QA_DIR="/tmp/shaka-perf-qa-reports/<slug>"
mkdir -p "$QA_DIR" && echo "$QA_DIR"
```

Run this once and use the printed absolute path everywhere `$QA_DIR` appears below.

`<slug>` is the branch under test with `/` replaced by `-` (the short SHA when testing a commit).

## 0. Understand when you need to use a browser or console.
For things like dev utils and migrations it doesn't make sense to make browser screenshots. Capture the console output on both sides instead and turn it into a screenshot (see "Console reproductions" in step 4). Use your discression when deciding what type of reproduction each potential issue needs. The main thing is to find all the critical bugs without a false positives, so be careful to not make a synthetic cases like "if someday FE sets this flag, there will be a crash, check out this console output (FE doesn't set this flag now, so I know I will waste your time, but take a look anyway)".

## 1. Sanity-check twin-servers commits

What commits are checked out in experiment and control? Run `git -C <dir> log -1 --oneline` and `git -C <dir> branch --show-current` for `twinServers.controlDir` and `twinServers.experimentDir`. Usually control should contain the merge-base with the main branch. Or it can be the previous PR in `gh stack` (given it's installed). If the control branch looks off, ask the user which branch to use as control. Wait for the answer, then run the corresponding `shaka-perf servers checkout` command:

- Whole stack under test: control is the merge-base with the default branch. That is the default, so `yarn shaka-perf servers checkout <top-branch>` is enough.
- One PR in the stack: control is the branch directly below it. Check out the branch, then move control alone: `yarn shaka-perf servers checkout <branch>` and `yarn shaka-perf servers checkout control <branch-below>`.

Not a stack? `yarn shaka-perf servers checkout <branch-name>` and move on.

When experiment is the checkout you were started in, don't switch its branch without asking the user. Move only control: `yarn shaka-perf servers checkout control <branch-below>`.

## 2. Read the diff first

`git diff <control-sha>` from the experiment checkout. Work in iterations. Each time, before touching a browser, write down three to five concrete guesses of what could break and the page or action that would show it (take into account your previous attempts). Memoization, cached selectors, and context changes tend to break on the second interaction, not the first: add an item, then change it, then remove it.

Iterate using scientific method: Think => guess issues => attempt reproduction => notice new information => think

Unless the user specified a time budget, guess how much QA time this PR needs, counted after the servers are built: up to 15 minutes for a small PR, 60 minutes for a larger one, and up to 3 hours of careful testing for a massive refactoring. Within that time, try to find as many different critical issues as you can.

## 3. Boot the servers

See [the twin-server lifecycle guide](https://github.com/shakacode/shakaperf/blob/main/packages/shaka-perf/README-twin-servers.md) to understand the desired experiment/control layout and server lifecycle. Use the configured application's `abtests.config.ts` for databases, seed setup, and build commands.

```bash
yarn shaka-perf servers build
yarn shaka-perf servers start-containers
yarn shaka-perf servers start-servers   # run in a persistent background session
```

The start-servers command runs Overmind and blocks until stopped. Use the documented subcommands to rebuild or restart; no stdin keepalive pipe is needed. Wait until both configured application URLs are ready.

## 4. Reproduce

For web pages, follow the project's browser interaction instructions: drive the browser through MCP, never through curl or the Task tool. Do every step on both servers in the same order and take a screenshot at each step where you expect a difference. Save screenshots in `$QA_DIR` (see QA folder above).

Run headless browser.

Console reproductions: run the same command on each side and save its output, e.g. `yarn shaka-perf servers run-cmd control '<command>' > "$QA_DIR/control.out" 2>&1`, then the same for `experiment`. `run-cmd` asks for a terminal; if it fails with "not a TTY", wrap it in `script` (macOS: `script -q /dev/null <cmd>`, Linux: `script -qc "<cmd>" /dev/null`). Drop the lines `run-cmd` prints about itself. For each side, copy `assets/console-screenshot.html` into `$QA_DIR`, fill it in as its comment says, open it in the browser at a 390x620 viewport, and take a full-page screenshot. Use these PNGs in the report exactly where browser screenshots would go.

If the diff adds, checks or removes a feature flag, turn it on before testing. Otherwise experiment runs the old code for a flag it checks, and control runs the old code for a flag the diff removes. Set it the same way on both sides: if each side keeps flags in its own database, change both. Before toggling, record the flag's current state, and ask the user first if it holds anything a plain on/off can't restore (targeted users, groups, percentages). After each toggle, clear both caches and relaunch the servers as described below; toggling doesn't invalidate cached pages. Tell the user which flags you toggled.

If and only if your bug is happening in a new component that is not present in control and you can't compare it to anything, edit the control checkout (`twinServers.controlDir`) replicating the new feature but with the bug fixed, so you have something to show as expected screenshot. It is important to restore the control checkout to the old state when you are done. Also, do not forget to adjust the report's metadata accordingly.

Seeds not enough? Edit the application's seed data or fixtures, then apply the same data to both sides using the project's seed commands (see `twinServers.setupCommands` in the application's `abtests.config.ts`). `yarn shaka-perf servers run-cmd-parallel <cmd...>` runs a command in both containers.

The main thing is whenever you change something you must update both sides' databases (control and experiment), and reset caches in both.

Then kill and relaunch servers.

If you can't confirm a guess, try up to three different reproduction approaches for it. If it remains unconfirmed, discard it from the bug findings and go back to step 2 for the next iteration, until the time budget runs out. If no regressions are confirmed by then, report "No confirmed regressions found" and briefly summarize what was tested and any testing blockers.

## 5. Report confirmed bugs

Write `$QA_DIR/reproduction-steps-<short-bug-description>.html`, one bug per file, by copying `assets/report-template.html` (next to this SKILL.md) and filling in every `{{PLACEHOLDER}}`. Keep the template's markup, styles, and script; do not restyle or restructure it (except for adding items to lists).

The report always opens with the templated section, and nothing goes above it:

1. `Discovered Bug: <one-line headline>` - the user-visible symptom, not the cause.
2. Reproduction steps panel - numbered steps, then `Expected (control): ...` and `Actual (experiment): ...`.
3. Paired screenshots stage - control left, experiment right, titled with the branch names only (the experiment title may link the PR); annotations in the center gap; one verdict line under each side.

Everything else follows below it, in the template's order: the two SHAs, the explanation SVG, relevant sources.

Reproduction steps rules:
1. A step is a short sentence. No "and", "after that", etc. Split the long instructions into multiple steps.
2. No expectations of familiarity with the context. For example, never say "Open the menu page", instead "Open <URL>".
3. Keep in mind that the skill is likely to run on one machine, and the bug reproduced on another one by another dev.
4. The steps should be doable without thinking. E.g. `Open the cart` => `Click the Cart icon in the nav bar`.
5. All URLs should be clickable links.
6. Always pair the URLs of control and experiment (unless some side has an individual step). Respect rule 7.
7. Do not mention experiment/control; use the formatted branch names instead. Always write the full branch name; never shorten it.
8. When control is the merge-base with the default branch, its branch name is the default branch (`main` or `master`). Then delete the template's `servers checkout control` setup line: `servers checkout <experiment branch>` already puts control on the merge-base, while `checkout control main` would take the tip of `main`.

Screenshot rules:
1. Always paired - an experiment shot without its control shot proves nothing.
2. Same step, same viewport, same scroll position on both sides.
3. Mobile viewport when the bug shows there; it takes less space. Desktop-only bugs may use full-desktop shots. If the element is below the fold, capture with a taller viewport instead of scrolling.
4. Inline as base64 PNG; crop with the template's img height/margin, not by editing the PNG.
5. The same rules hold for console screenshots: same command, same inputs, on both sides.

Annotation rules:
1. Use the `annotations` JSON list to create annotations. Escape `"` as `\"` and `\` as `\\` inside its strings.
2. Add one entry per difference the screenshots show, as many differences as there are, and delete the sample entries you don't use.
3. Each entry draws an arrow from the center to `left` and `right` `x`,`y`: `"ok": true` draws it green, `false` red.
4. A difference is green on control and red on experiment for bug reproductions, or the other way around when the user asked to demonstrate a bug fix. Something correct on both sides is green on both, with one entry-level `note` and no `left.note`/`right.note`.
5. Put `x`,`y` on the element's edge that faces the center: its right edge in `left` (control) and its left edge in `right` (experiment), so the arrow doesn't cross the element.
6. Add a ring (`"ring"`, its radius in pixels) only for a large element, such as a block, a popup or a whole section, where an arrow tip alone doesn't show the extent. Make each ring enclose its element. Leave it out for words, icons, buttons and spots where something is missing.
7. `label` explains the difference in a few words, such as "Focus jumps to top", not just the element's name.
8. `left.note` and `right.note` are one or two clarifying words each, such as "stays" or "jumps up".

The template's two copy buttons are what make the report pasteable into a PR. "Copy markdown" copies the headline, the numbered steps, expected/actual, and every section below the screenshots as one markdown block with a slot for the image. "Copy image" copies the screenshot stage as one PNG with the titles, annotations, and verdicts baked in (an SVG overlay does not survive a paste, a flattened image does); it is pasted separately. Keep all text in those sections and all screenshot content inside the stage.

After you proved the bug exists, you need to explain it. Spawn a subagent with "Draw an insightful SVG explaining <bug description>. Use playwright-mcp to polish it. Don't stop iterating until it is clean and insightful. You are expected to run at least 2 iterations. The SVG can contain 30 words tops. Before you start drawing you have to plan what you will show to the user, don't expect them to be familiar with implementation details. Get creative."

In the "Why it happens" section, write the explanation in plain language, 70 words max, then inline that SVG under it, and list the relevant sources in the section below. Screenshot PNGs should be inlined as base64.

The resulting report should have no {{placeholders}} from the original template.

## 6. Clean up

Set any feature flag you toggled back to the state you recorded before toggling it. Leave the twin servers running.

The resulting HTML reports should be self-contained: clean up the mess, there should be no other files besides the reports in `$QA_DIR`. If some artifact is essential for reproduction, inline it in the HTML report.
Leave only the `reproduction-steps-*.html` reports in `$QA_DIR`.

## 7. Output

Create a table with following columns:

Short description, severity, full path to report
