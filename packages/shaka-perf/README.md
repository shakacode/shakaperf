# shaka-perf

[![License: ShakaStack License](https://img.shields.io/badge/license-ShakaStack%20License-blue.svg)](../../LICENSE.md)

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

## Free & Pro

The approved [ShakaStack License for ShakaPerf](../../LICENSE.md) starts with release 0.8.0. Reading, studying, and a 45 day evaluation are free. Ongoing use on private code, including CI, PR checks, coding agent workflows, and manual runs, needs ShakaStack Pro after evaluation in any environment unless a Free Use applies.

Free Use includes organizations that answer yes to all three questions across their affiliates: fewer than 10 people, under US $1M revenue in the last twelve months, and under US $1M raised ever. Charities, educational institutions, hospitals, and qualifying public open source work also have free permissions under the license.

[ShakaStack Pro](https://pro.reactonrails.com/#shakastack-pro) covers ShakaPerf, React on Rails Pro, and Inertia Rails SSR Cache for the whole organization, with no headcount or revenue limit. Each release keeps the license terms it shipped with. [Older license texts](https://github.com/shakacode/commercial-licensing/tree/main/license/archive) are archived.

Questions: [contact@shakacode.com](mailto:contact@shakacode.com).
