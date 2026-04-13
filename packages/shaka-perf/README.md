# shaka-perf

Frontend performance testing toolkit for web applications. A single CLI with commands grouped by domain:

| Domain         | What it does                                                                           | Docs                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `perf-*`       | Lighthouse-based performance benchmarking with statistical analysis and HTML reports   | _(see CLI `--help`)_                                                                                           |
| `visreg-*`     | Visual regression testing — pixel-diff screenshots between control and experiment URLs | [README-visreg.md](./README-visreg.md)                                                                         |
| `twins-*`      | Docker A/B infrastructure that runs control and experiment servers side-by-side        | [README-twin-servers.md](./README-twin-servers.md) — see also [SETUP-twin-servers.md](./SETUP-twin-servers.md) |

The three domains share a single test definition format (`abTest()` from `shaka-shared`) so a Playwright test you write once can drive all three: a perf measurement, a visual regression check, and a twin-server setup.

## Install

```bash
yarn add shaka-perf
```

## Quick start

Each domain reads its own config file from your project root:

| Domain   | Config file              |
| -------- | ------------------------ |
| `perf`   | `bench.config.ts`        |
| `visreg` | `visreg.config.ts`       |
| `twins`  | `twin-servers.config.ts` |

Use `init` to scaffold one:

```bash
yarn shaka-perf perf-init
yarn shaka-perf visreg-init
```

```bash
# Performance benchmarking
yarn shaka-perf perf-compare --controlURL http://localhost:3020 --experimentURL http://localhost:3030

# Visual regression
yarn shaka-perf visreg-compare

# Twin Docker servers (A/B infrastructure)
yarn shaka-perf twins-build
yarn shaka-perf twins-start-containers
yarn shaka-perf twins-start-servers
```

## License

MIT
