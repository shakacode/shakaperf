# shaka-perf

[![License: ShakaPerf License](https://img.shields.io/badge/license-ShakaPerf%20License-blue.svg)](../../LICENSE.md)

Frontend performance testing toolkit for web applications. A single CLI and a single project-level config (`abtests.config.ts`) that drives:

| Domain    | What it does                                                                           | Docs                                                                                                           |
| --------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `compare` | Lighthouse-based perf benchmarking + visual-regression capture, one self-contained HTML report | [README-visreg.md](./README-visreg.md)                                                                      |
| `audit` | Lighthouse, image-resolution, and accessibility checks on the current page | [Image resolution](#image-resolution) |
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

`shaka-perf audit` checks `<img>` elements whose boxes overlap the current
viewport after the test finishes, inside the existing Lighthouse run. It checks
the image the browser selected, its current size, `object-fit`, and the current
screen pixel density. It does not inspect
alternative `srcset`/`picture` sources or resize the page to try other conditions.
Each configured viewport is checked independently.

To exit with a failure when undersized images are found:

```bash
yarn shaka-perf audit --fail-on-undersized-images
```

Configure the check in `abtests.config.ts` (these are the defaults):

```ts
audit: {
  imageResolution: {
    enabled: true,
    minRatio: 0.9,
    maxRatio: 2,
    failOnUndersized: false,
  },
},
```

The ratio is **source pixels ÷ (painted CSS pixels × screen pixel density)**,
calculated separately for width and height. An image is undersized when either
ratio is below `minRatio`, and oversized when both ratios exceed `maxRatio`.
Values on either boundary pass, allowing a tiny tolerance for browser rounding.
`minRatio` must be greater than 0 and at most 1; `maxRatio` must be at least 1.
For example, a 300 × 300 CSS-pixel image at pixel density 2 needs 600 × 600 source
pixels. The default minimum accepts 540 × 540; set `minRatio: 1` to require the
full resolution. With `cover`, the check includes enlargement before cropping.
All five `object-fit` values are supported. If the image or a parent uses CSS
scaling, the audit uses the scale at the moment of the check. For example, a
300 × 300 image at `transform: scale(1.5)` needs 450 × 450 source pixels on a 1× screen.

Set `enabled: false` to skip image checking.
Set `failOnUndersized: true` to make failure the project default. Tests can
override these settings through `config.audit.imageResolution`. The command flag
enables checking for that run even if a test disables it. Oversized images and
individual images with unknown resolution are informational.
The flag requires the `audit` stage and also works with `--skip-report`.
With `--report-only`, it evaluates saved findings; older results without image
measurements require a fresh audit.

After Lighthouse stops recording speed, ShakaPerf selects the images once.
An image partly inside the viewport is checked at its full painted size. An
image covered by an overlay or clipped by a container can still be included.
ShakaPerf reads the bitmap dimensions and uses the recorded image types to
identify raster images. An image still downloading at the time of the check is
reported as unknown. If the whole image check fails, ShakaPerf keeps the speed
results and reports the error. With undersized-image failure enabled, that
error also fails the command.

The main report shows how many images were recorded for each viewport. Expand
**Passed images** to see which images met the thresholds and their source and
required dimensions. **Affected images** lists undersized, oversized, and unknown images.
Measurements are also available in the Lighthouse report and `report.json`.
The check detects insufficient pixel dimensions, not blur already present in
the source image. SVGs, unloaded images, unsupported CSS transforms or zoom, and
unavailable measurements are reported as unknown. CSS backgrounds, iframe
contents, and images outside the current viewport are not scanned.

## License

ShakaPerf is source-available under
[The ShakaPerf License](../../LICENSE.md) — free to read, study, and
evaluate for everyone; free in production (including CI and coding-agent
workflows) for organizations under 10 people, $1M revenue, and $1M raised;
paid subscription otherwise: https://shakaperf.com/pricing.

Questions or commercial licensing:
[contact@shakacode.com](mailto:contact@shakacode.com).
