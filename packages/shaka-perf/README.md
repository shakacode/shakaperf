# shaka-perf

[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue.svg)](./LICENSE)

Frontend performance testing toolkit for web applications. A single CLI and a single project-level config (`abtests.config.ts`) that drives:

| Domain    | What it does                                                                           | Docs                                                                                                           |
| --------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `compare` | Lighthouse-based perf benchmarking + visual-regression capture, one self-contained HTML report | [README-visreg.md](./README-visreg.md)                                                                         |
| `servers` | Docker A/B infrastructure that runs control and experiment servers side-by-side        | [README-twin-servers.md](./README-twin-servers.md) — see also [SETUP-twin-servers.md](./SETUP-twin-servers.md) |

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

# Twin Docker servers (A/B infrastructure) — one command does it all:
# detects changes, rebuilds if needed, starts containers, starts servers.
yarn shaka-perf servers

# …or run the individual steps:
yarn shaka-perf servers build
yarn shaka-perf servers start-containers
yarn shaka-perf servers start-servers
```

## License

ShakaPerf is source-available under the Business Source License 1.1. You can
read, modify, self-host, and use it in production, with two exceptions: you may
not offer it to third parties as a competing hosted performance service, and
you may not provide hosted or managed runners/executors for running ShakaPerf
as a service, including CI cost-reduction services. Each version converts to
the Apache License 2.0 three years after its release. See [LICENSE](./LICENSE)
for the full terms. The `shaka-shared` package remains MIT-licensed.

For commercial licensing or use beyond the Additional Use Grant, contact
ShakaCode LLC at [contact@shakacode.com](mailto:contact@shakacode.com).
