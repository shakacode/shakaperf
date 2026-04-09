# shaka-perf

Frontend performance testing toolkit for web applications. A single CLI grouped into three subcommands:

| Subcommand                | What it does                                                                           | Docs                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `shaka-perf bench`        | Lighthouse-based performance benchmarking with statistical analysis and HTML reports   | _(see CLI `--help`)_                                                                                           |
| `shaka-perf visreg`       | Visual regression testing — pixel-diff screenshots between control and experiment URLs | [README-visreg.md](./README-visreg.md)                                                                         |
| `shaka-perf twin-servers` | Docker A/B infrastructure that runs control and experiment servers side-by-side        | [README-twin-servers.md](./README-twin-servers.md) — see also [SETUP-twin-servers.md](./SETUP-twin-servers.md) |

The three subcommands share a single test definition format (`abTest()` from `shaka-shared`) so a Playwright test you write once can drive all three: a perf measurement, a visual regression check, and a twin-server setup.

## Install

```bash
yarn add shaka-perf
```

## Quick start

Each subcommand reads its own config file from your project root:

| Subcommand     | Config file              |
| -------------- | ------------------------ |
| `bench`        | `bench.config.ts`        |
| `visreg`       | `visreg.config.ts`       |
| `twin-servers` | `twin-servers.config.ts` |

Use `init` to scaffold one:

```bash
yarn shaka-perf bench init
yarn shaka-perf visreg init
```

```bash
# Performance benchmarking
yarn shaka-perf bench compare --controlURL http://localhost:3020 --experimentURL http://localhost:3030

# Visual regression
yarn shaka-perf visreg compare

# Twin Docker servers (A/B infrastructure)
yarn shaka-perf twin-servers build
yarn shaka-perf twin-servers start-containers
yarn shaka-perf twin-servers start-servers
```

## License

MIT
