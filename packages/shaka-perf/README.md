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

## Image resolution

Every Lighthouse sample of `compare` and `audit` also checks the `<img>`
elements visible in the viewport when the test body ends. It compares the
pixels of the image file with the pixels the screen needs:

```
ratio = file pixels ÷ (painted CSS pixels × device pixel ratio)
```

The painted size follows `object-fit`. The file size is that of the `srcset`
candidate the browser chose. Three counts are reported as metrics, beside the
other diagnostics:

- `undersized-images`: the ratio is below `minRatio` (default 0.9).
- `oversized-images`: the ratio is above `maxRatio` (default 2).
- `scaled-small-images`: the image is painted within 64 × 64 CSS pixels and its
  file is not a whole multiple of its on-screen pixels. A 32-pixel icon drawn
  into 31 pixels blurs far more than a 320-pixel photo drawn into 310.

`compare` treats the counts like any other metric and adds an "image resolution
diff" of the two sides. `audit` links the per-image list as "image resolution"
and writes every metric to `report.json` under `summary.metrics`, for scripts
that want to fail a build. SVG images, CSS backgrounds, images outside the
viewport, and images inside shadow DOM or iframes are not checked.

Change the limits in `abtests.config.ts`, or for one test through its `config`:

```ts
shared: {
  imageResolution: { minRatio: 0.9, maxRatio: 2 },
},
```

## License

ShakaPerf is source-available under
[The ShakaPerf License](../../LICENSE.md) — free to read, study, and
evaluate for everyone; free in production (including CI and coding-agent
workflows) for organizations under 10 people, $1M revenue, and $1M raised;
paid subscription otherwise: https://shakaperf.com/pricing.

Questions or commercial licensing:
[contact@shakacode.com](mailto:contact@shakacode.com).
