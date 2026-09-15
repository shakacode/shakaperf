---
name: shaka-perf-find-bugs
description: "Use twin servers to search for bugs introduced in this PR or branch. Use this skill when asked to check if PR introduces bugs."
allowed-tools: Bash Read Grep Glob Edit Write Agent
---

# QA with local twin servers

Two checkouts side by side: the configured `twinServers.controlDir` (the base) and `twinServers.experimentDir` (the change under test). Same seed data, two servers. Your job is to find something that misbehaves on experiment and works on control.

Ports and hosts come from the configured application's `abtests.config.ts` (`shared.controlURL`, `shared.experimentURL`, and `twinServers.ports`).

## 0. Understand when using this skill is an overkill.

Some obvious crashes or typos in known API calls don't need to have a reproduction. If you found something super obvious, skip the reproduction steps.

## 1. Sanity-check twin-servers commits

What commits are checked out in `twinServers.experimentDir`/`twinServers.controlDir`? Usually control should contain the merge-base with the main branch. Or it can be the previous PR in `gh stack` (given it's installed). If the control branch looks off, use prompt tool asking what branch to use as control, and then run the corresponding `shaka-perf servers checkout` command.


## 2. Read the diff first

`git diff <control-sha>` from the experiment checkout. Before touching a browser, write down three to five concrete guesses of what could break and the page or action that would show it. Memoization, cached selectors, and context changes tend to break on the second interaction, not the first: add an item, then change it, then remove it.

## 3. Boot the servers

See `packages/shaka-perf/README-twin-servers.md` and `.claude/skills/ab-servers/SKILL.md` to understand the desired experiment/control layout and server lifecycle. Use the configured application's `abtests.config.ts` for databases, seed setup, and build commands. Run the following from that application's directory (`demo-ecommerce` for this repository's demo):

```bash
yarn shaka-perf servers build
yarn shaka-perf servers start-containers
yarn shaka-perf servers start-servers   # run in a persistent background session
```

The start-servers command runs Overmind and blocks until stopped. Use the documented subcommands to rebuild or restart; no stdin keepalive pipe is needed. Wait until both configured application URLs are ready.

## 4. Reproduce

Follow the project's browser interaction instructions: drive the browser through MCP, never through curl or the Task tool. Do every step on both servers in the same order and take a screenshot at each step where you expect a difference. Save screenshots under `tmp/twin-qa/`.

Run headless browser.

Seeds not enough? Edit the application's seed data or fixtures, then apply the same data to both sides using the project's seed commands (see `twinServers.setupCommands` in the application's `abtests.config.ts`).

The main thing is whenever you change something you must update both sides' databases (control and experiment), and reset caches in both.

Then kill and relaunch servers. 

If you can't confirm the regression, return to step 2 and try a different hypothesis or reproduction approach, up to three additional attempts. If it remains unconfirmed, discard it from the bug findings. If no regressions are confirmed, report "No confirmed regressions found" and briefly summarize what was tested and any testing blockers.

## 5. Report confirmed bugs

Write `/tmp/shaka-perf/reproduction-steps-<short-bug-description>.html` with: the two SHAs, numbered steps, expected vs actual, and the paired screenshots inline (control left, experiment right). One bug per file.

Screenshots should be
1. Paired (no use in showing experiment without showing control)
2. Titled with branch names used in control and experiment (just branch name, nothing else).
3. Annotations should be in the center, with arrows pointing at good elements in control and bad elements in experiment.
4. Mobile if possible. They occupy less screen space. Desktop-only bugs can have full-desktop screenshots. If the component you want to capture is below the viewport increase viewport height instead of scrolling.

All text segments should have copy button, for easy communication in PRs. For example, it should be possible to copy reproduction steps with step numbers intact. It should also be appropriately styled: the copy button should be labeling a box wrapping the copied text. Except for screenshot section, they are not copiable to markdown, so they should copy the image itself to the clipboard with all the text built into the one image. SVG on the other hand are supported well, so they should be built in.

After you proved the bug exists, you need to explain it. Spawn a subagent with "Draw an insightful SVG explaining <bug description>. Use playwright-mcp to polish it. Don't stop iterating until it is clean and insigthful. You are expected to run at least 5 iterations. The SVG can contain 30 words top. Before you start drawing plan what you will show to the user, don't expect them to be familiar with implementation details. Get creative."

Attach the SVG to the report, and list relevant sources.
The SVG should be inlined in the report. Screenshot PNGs should be inlined as base64.
