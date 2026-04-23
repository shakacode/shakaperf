import { defineConfig } from 'shaka-perf/compare';
import { DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT } from 'shaka-shared';

/**
 * `shaka-perf compare` reads this file. Every field below is set to its
 * built-in default — you can delete any you don't need to customize and
 * the defaults kick back in. See the README and SETUP-twin-servers.md for
 * the full surface; the defaults assume a local two-server setup with
 * control on :3020 and experiment on :3030.
 */
export default defineConfig({
  shared: {
    // Control (baseline) server URL.
    controlURL: 'http://localhost:3020',

    // Experiment (candidate) server URL.
    experimentURL: 'http://localhost:3030',

    // Where compare writes report.html, per-test subdirs, and visreg
    // screenshots. Wiped at the start of every run.
    resultsFolder: 'compare-results',

    // (optional) Glob restricting which *.abtest.ts files are discovered.
    // testPathPattern: 'ab-tests/**/*.abtest.ts',

    // (optional) Substring filter applied to test names after loading —
    // useful for iterating on one test without a CLI flag.
    // filter: 'Homepage',

    // Full viewport definitions — the single source of truth.
    // `visreg.viewports` and `perf.viewports` reference these by label;
    // per-test `options.viewports` narrows which labels run. `formFactor`
    // drives Lighthouse's `formFactor` + `screenEmulation.mobile`;
    // `deviceScaleFactor` drives its DPR. Add custom breakpoints by
    // defining your own Viewport objects here.
    viewports: [DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT],
  },

  visreg: {
    // Labels from `shared.viewports` that visreg captures at. Narrow here
    // to skip breakpoints globally; narrow per-test via `options.viewports`.
    viewports: ['desktop', 'tablet', 'phone'],

    // Per-pair acceptable mismatch (percent of pixels that may differ
    // before the pair is flagged). Overridable per test via
    // `options.visreg.misMatchThreshold`.
    defaultMisMatchThreshold: 0.1,

    // How many times to re-screenshot + re-compare a flaky pair before
    // accepting a difference. Useful when a page has subtle animations
    // that don't fully settle.
    compareRetries: 2,

    // Milliseconds to wait between retries.
    compareRetryDelay: 500,

    // Absolute diff-pixel budget below which a pair is treated as "no
    // difference" regardless of `defaultMisMatchThreshold`. Catches
    // small single-region regressions that slip under the percentage
    // threshold.
    maxNumDiffPixels: 50,

    // Pixelmatch color-distance sensitivity (0 = exact, 1 = very permissive).
    // 0.1 tolerates typical anti-aliasing noise.
    comparePixelmatchThreshold: 0.1,

    // How many pages to capture concurrently. Each consumes one browser
    // context — raise on fast machines, lower if you see OOMs.
    asyncCaptureLimit: 2,

    // How many image pairs to compare concurrently (CPU-bound step,
    // independent of the capture pool above).
    asyncCompareLimit: 4,

    // Playwright engine options. `--no-sandbox` is required in most
    // Docker containers; drop it if you run outside a container and
    // want the sandbox back.
    engineOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
      // headless: true,
      // waitTimeout: 30_000,
    },

    // (optional) Forwarded to resemble.js when computing image diffs.
    // resembleOutputOptions: {
    //   ignoreAntialiasing: true,
    //   usePreciseMatching: false,
    // },
  },

  perf: {
    // Samples per test per viewport. 20 is the statistical minimum for
    // stable p-values; drop to ~5 for local iteration, raise for flaky
    // measurements.
    numberOfMeasurements: 20,

    // Relative metric change (10%) below which a regression is ignored.
    // Overridable per test via `options.perf.regressionThreshold`.
    regressionThreshold: 0.1,

    // Mann-Whitney U p-value cutoff. A regression is only reported when
    // BOTH `regressionThreshold` and statistical significance pass.
    pValueThreshold: 0.05,

    // Which statistic to gate on. `estimator` = Hodges-Lehmann point
    // estimate; `ci-lower`/`ci-upper` = bootstrap CI bounds. Pick
    // `ci-lower` to demand the metric clearly regressed at the bound;
    // `ci-upper` is the optimistic view.
    regressionThresholdStat: 'estimator',

    // `simultaneous` interleaves control/experiment samples round-robin
    // so noise drift affects both sides equally. `sequential` finishes
    // all controls before experiments — faster but sensitive to clock
    // skew, background load, etc.
    samplingMode: 'simultaneous',

    // (optional) Lighthouse workers in parallel. Defaults to
    // max(1, floor(cpus/2)). Override when you want a fixed number.
    // parallelism: 4,

    // Per-sample timeout in ms. Lighthouse aborts a single
    // navigation + gather cycle that exceeds this.
    sampleTimeoutMs: 120_000,

    // Labels from `shared.viewports` that perf measures at. Default
    // covers desktop + phone so device-specific regressions aren't
    // missed; drop to ['desktop'] for faster CI.
    viewports: ['desktop', 'phone'],

    // (optional) Lighthouse runtime config. Do NOT set `formFactor` or
    // `screenEmulation` here — the viewport owns those and the runner
    // overwrites them via `lhConfigForViewport`.
    // lighthouseConfig: {
    //   throttling: {
    //     rttMs: 300,
    //     throughputKbps: 700,
    //     cpuSlowdownMultiplier: 20,
    //   },
    //   throttlingMethod: 'simulate',
    //   logLevel: 'error',
    //   onlyCategories: ['performance'],
    // },

    // (optional) Header shown above the perf plots in the HTML report.
    // plotTitle: 'My app · homepage perf',
  },
});
