# shaka-perf

Frontend performance testing toolkit for web applications. A single CLI that bundles three previously-separate packages into one binary, grouped by subcommand:

| Subcommand                       | What it does                                                                                | Docs                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `shaka-perf bench`               | Lighthouse-based performance benchmarking with statistical analysis and HTML reports        | _(see CLI `--help`)_                       |
| `shaka-perf visreg`              | Visual regression testing — pixel-diff screenshots between control and experiment URLs     | [README-visreg.md](./README-visreg.md)     |
| `shaka-perf twin-servers`        | Docker A/B infrastructure that runs control and experiment servers side-by-side            | [README-twin-servers.md](./README-twin-servers.md) — see also [SETUP-twin-servers.md](./SETUP-twin-servers.md) |

The three subcommands share a single test definition format (`abTest()` from `shaka-shared`) so a Playwright test you write once can drive all three: a perf measurement, a visual regression check, and a twin-server setup.

## Install

```bash
yarn add shaka-perf
```

## Quick start

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

## Programmatic API

The package exports per-domain subpaths so you can drive each domain from your own code:

```ts
// Visual regression
import runner, { defineVisregConfig } from 'shaka-perf/visreg';
import { waitUntilPageSettled, loadCookies } from 'shaka-perf/visreg/helpers';

// Bench
import { runCompare, defineConfig } from 'shaka-perf/bench';

// Twin-servers
import { defineConfig, build, startContainers } from 'shaka-perf/twin-servers';
```

## Node version

Requires Node 24+. The unified CLI loads `lighthouse` (ESM) via dynamic `require()`, which only works on Node 22+; the v8 cppgc concurrent marker also has bugs on older versions when bench/visreg native bindings are loaded together.

## License

MIT
