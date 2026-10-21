# shaka-perf

[![License: ShakaPerf License](https://img.shields.io/badge/license-ShakaPerf%20License-blue.svg)](../../LICENSE.md)

Frontend performance testing toolkit for web applications. A single CLI and a single project-level config (`abtests.config.ts`) that drives:

| Domain    | What it does                                                                           | Docs                                                                                                           |
| --------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `compare` | Lighthouse-based perf benchmarking + visual-regression capture, one self-contained HTML report | [README-visreg.md](./README-visreg.md)                                                                      |
| `bisect` | Find the first commit responsible for each regression reported by `compare`               | [README-compare-bisect.md](./README-compare-bisect.md)                                                       |
| `servers` | Docker A/B infrastructure that runs control and experiment servers side-by-side        | [README-twin-servers.md](./README-twin-servers.md) — see also [SETUP-twin-servers.md](./SETUP-twin-servers.md) |
| Agent guide | Agent setup, skills, execution loop, and machine-readable report contract                                  | [for-ai-agents.md](https://github.com/shakacode/shakaperf/blob/main/docs/for-ai-agents.md)                    |

A single test definition format (`abTest()` from `shaka-shared`) drives both categories: a Playwright test you write once becomes a perf measurement AND a visual-regression pair.

## Install

```bash
yarn add shaka-perf
```

## Quick start

Scaffold the unified config (every field set to its default, each annotated):

```bash
yarn shaka-perf init
```

Run the unified compare:

```bash
# Perf + visreg in one pass, single-file HTML report
yarn shaka-perf compare

# Narrow to one category
yarn shaka-perf compare --categories visreg
yarn shaka-perf compare --categories perf

# Locate the first commit that introduced compare regressions. With no refs,
# control HEAD is good and experiment HEAD is bad.
yarn shaka-perf bisect
yarn shaka-perf bisect <good-ref> <bad-ref> --categories visreg,perf

# Re-render the latest saved bisect report without running measurements
yarn shaka-perf bisect --report-only

# Twin Docker servers (A/B infrastructure) — one command does it all:
# detects changes, rebuilds if needed, starts containers, starts servers.
yarn shaka-perf servers

# …or run the individual steps:
yarn shaka-perf servers build
yarn shaka-perf servers start-containers
yarn shaka-perf servers start-servers
```

## Select a measurement viewport

`compare` and `audit` accept `--viewport <label>`. Use a label from
`shared.viewportDefinitions`, such as `desktop` or `phone`:

```bash
shaka-perf compare --viewport desktop
shaka-perf compare --filter '^Product Detail$' --viewport phone
shaka-perf audit --viewport desktop
shaka-perf audit --filter '^Product Detail$' --viewport phone
```

The selection intersects each test’s effective category viewports; it never adds
an undeclared viewport. Unknown labels fail with the valid labels. A selection
with no work fails before changing saved results. Without the option, the usual
viewport matrix runs.

A viewport rerun replaces the selected viewport’s results and preserves other
viewports’ outcomes and artifacts. One report card can therefore contain results
from multiple runs; preserved outcomes keep their original run identity.
`--keep-old-results` still controls whether artifacts at the selected viewport
are cleared before measurement. Viewport passes retain engine-error records from
other selections; rerunning the same selection replaces its error record. Audit
coverage also replaces the selected units’ aggregate inputs, preserving siblings.

`--report-only --viewport phone` validates the label but regenerates the complete
saved report, just like `--report-only`: it does not filter saved viewports,
remeasure tests, or change their freshness or run identities. Use `--report-only`
after filtered measurement runs to assemble the full suite’s saved results.

## License

ShakaPerf is source-available under
[The ShakaPerf License](../../LICENSE.md) — free to read, study, and
evaluate for everyone; free in production (including CI and coding-agent
workflows) for organizations under 10 people, $1M revenue, and $1M raised;
paid subscription otherwise: https://shakaperf.com/pricing.

Questions or commercial licensing:
[contact@shakacode.com](mailto:contact@shakacode.com).
