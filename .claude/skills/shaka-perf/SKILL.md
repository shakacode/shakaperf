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
| `shaka-perf init` | Drops `abtests.config.ts` and these skills into the project. |
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

Setup from scratch is the `/shaka-perf-dockerize` skill; writing tests is
`/shaka-perf-add-coverage`; checking what is covered is `/shaka-perf-coverage`;
hunting regressions on a branch is `/shaka-perf-find-bugs`.

Read this guide before writing or editing a test.
https://github.com/shakacode/shakaperf/blob/main/writing-good-ab-tests.md.


Whenever you are talking about results of your findings with users, give them full path to the generated report.
If you are running multiple tests, save self-contained-report.html to a temporary file, so you can show it later.
Showing actual reports is way more important than your conclusions, so attach it to the footer of your responses.
