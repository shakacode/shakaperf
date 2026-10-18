---
name: shaka-perf
description: Map of the shaka-perf CLI. Load whenever a task mentions shaka-perf, twin servers, perf or visreg A/B tests, or asks what shaka-perf can do — then run the command's `--help` before using it.
---

# shaka-perf

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

Read [Writing Good AB Tests](references/writing-good-ab-tests.md) before writing or editing a test.


Whenever you are talking about results of your findings with users, give them full path to the generated report.
If you are running multiple tests, save self-contained-report.html to a temporary file, so you can show it later.
Showing actual reports is way more important than your conclusions, so attach it to the footer of your responses.
