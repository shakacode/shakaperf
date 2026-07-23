# shaka-perf visreg

Visual regression testing for web applications — catch CSS changes by comparing screenshots across environments.

Built on Playwright. Uses pixel-level diffing to detect visual changes and generates interactive HTML reports.

## Contents

- [Commands](#commands)
  - [compare](#compare)
  - [CLI Options](#cli-options)
- [Getting Started](#getting-started)
  - [Initializing Your Project](#initializing-your-project)
- [Configuration](#configuration)
  - [Example Config](#example-config)
  - [Per-Test Configuration](#per-test-configuration)
  - [Changing Screenshot Filename Formats](#changing-screenshot-filename-formats)
- [Advanced Scenarios](#advanced-scenarios)
  - [Interactions and Waits: Do It in the Body](#interactions-and-waits-do-it-in-the-body)
  - [Setting Cookies](#setting-cookies)
  - [Targeting Elements](#targeting-elements)
  - [Comparing Different Endpoints](#comparing-different-endpoints)
  - [Capturing the Document, Viewport, or Specific Elements](#capturing-the-document-viewport-or-specific-elements)
  - [Changing Test Sensitivity](#changing-test-sensitivity)
- [Running Custom Scripts](#running-custom-scripts)
- [Playwright Engine Configuration](#playwright-engine-configuration)
- [Reporting](#reporting)
- [Performance Tuning](#performance-tuning)
- [Resemble.js Output Options](#resemblejs-output-options)
- [Debugging](#debugging)
- [Git Integration](#git-integration)
- [Programmatic Usage](#programmatic-usage)
- [Integration with twin-servers](#integration-with-twin-servers)

---

## Commands

```bash
# Scaffold abtests.config.ts (one config drives perf + visreg + twin-servers)
shaka-perf init

# Run the unified compare, narrowed to visreg only
shaka-perf compare --categories visreg
```

### compare

The main workflow. Captures screenshots from both control and experiment URLs for every registered `abTest` scenario at every viewport, compares them pixel-by-pixel, and folds the results into a single-file HTML report (`compare-results/report.html`) alongside the perf results. Supports retry logic for flaky comparisons.

Each scenario is an `abTest()` registered under `ab-tests/`. The unified `abtests.config.ts` provides `shared.controlURL` and `shared.experimentURL` (defaults: `:3020` / `:3030`), so individual tests don't need their own URLs.

Pass `--filter=<testNameRegex>` to run only tests matching your regex.

> [!TIP]
> The `--filter` argument is a useful shortcut for re-running a single test or just the failed tests.

<!-- -->

> [!WARNING]
> `compare` wipes `shared.resultsFolder` (default: `compare-results/`) at the start of every run, so the output always reflects only the current run. Tests that were renamed or removed since the previous run won't linger. Do not point it at a directory containing files you care about.

### CLI Options

```
-c, --config <path>    Path to abtests.config.ts (default: auto-discovered)
--categories <list>    Comma-separated subset: visreg,perf (default: both)
--filter <regex>       Filter tests by name
-h, --help             Display usage
```

## Getting Started

### Initializing Your Project

`shaka-perf init` scaffolds a fully-annotated `abtests.config.ts` in the current working directory. It will refuse to overwrite an existing config unless you pass `--force`.

```sh
shaka-perf init
```

## Configuration

`shaka-perf compare` reads `abtests.config.ts` from the current working directory (or the path passed to `--config`). Visual-regression settings live on the `visreg` slice; see `shaka-perf init` for a commented template with every default spelled out.

Every field on the `visreg` slice has a default, so a minimal config is just `defineConfig({})`. Scenarios come from `abTest(...)` calls discovered under `ab-tests/` — control and experiment URLs come from `shared.controlURL` / `shared.experimentURL`, not from individual scenarios.

Pass `--filter=<testNameRegex>` to run only tests whose name matches your regex.

### Example Config

Visreg has no standalone config file any more — visual-regression settings live in the `visreg` slice of `abtests.config.ts`:

```ts
import { defineConfig } from 'shaka-perf/compare';

export default defineConfig({
  shared: {
    // Browser-launch options every stage respects; `visreg.playwrightOptions`
    // and `perf.playwrightOptions` may override per-category (same type).
    playwrightOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
    },
  },
  visreg: {
    viewports: ['desktop', 'tablet', 'phone'],
    compareRetries: 2,
    compareRetryDelay: 500,
    maxNumDiffPixels: 50,
    mismatchThreshold: 0.1,
  },
});
```

Run `shaka-perf init` to scaffold a fully-commented `abtests.config.ts` with every default listed.

Scenarios are defined as standalone `*.abtest.ts` files in an `ab-tests/` directory — this lets you co-locate test definitions with the features they cover. See the [shaka-shared `abTest()` registry](../shaka-shared/) for how to author them.

### Per-Test Configuration

The `abTest()` config is flat — there is no nested `options` object (an
un-migrated `options:` key throws at load time; see
[BREAKING_CHANGES.md](../../BREAKING_CHANGES.md) for the per-option migration).
One flat field drives what visreg captures:

| Property                  | Description                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `visregSelectors`         | CSS selectors to capture. Defaults to the whole document. Also accepts the magic `document` / `viewport` selectors — see [Targeting Elements](#targeting-elements) |

```ts
abTest('Homepage hero', {
  startingPath: '/',
  visregSelectors: ['[data-cy="hero"]'],
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
```

Every remaining per-test override lives under `config` — a partial of the same
sections as `abtests.config.ts`, merged over the file config for this test
alone. The visreg knobs (`config.visreg`):

| Knob                         | Description                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `mismatchThreshold`   | Percentage of different pixels allowed to pass (default: 0.1)                            |
| `maxNumDiffPixels`           | Absolute cap on differing pixels before a comparison fails                               |
| `comparePixelmatchThreshold` | Per-pixel color-distance sensitivity for the pixelmatch comparison                       |
| `viewports`                  | Narrow which viewports this test's visreg runs at (names from `shared.viewports`)        |

```ts
abTest('Cart', {
  startingPath: '/cart',
  config: {
    visreg: { mismatchThreshold: 0.01, viewports: ['desktop'] },
  },
}, async ({ page }) => { /* ... */ });
```

Viewport narrowing is per-category: `config.visreg.viewports` narrows only
visreg — perf, audit, and accessibility each have their own
`config.<category>.viewports`, so a test can be desktop-only for visreg while
still benching on the phone.

Every defined per-test key REPLACES the file value wholesale — arrays included
(`config.visreg.viewports: ['phone']` is the effective list, not a union with
the file's). Keys you leave undefined fall through to the file value.

Interactions, ready-waits, and hide/remove options are gone from the config —
write them in the test body instead (see
[Interactions and Waits: Do It in the Body](#interactions-and-waits-do-it-in-the-body)).

### Screenshot Filenames

The screenshot naming scheme is fixed (scenario × selector × viewport) and not
configurable — stable names are what make crash-resume and the frame pools
work.

## Advanced Scenarios

### Interactions and Waits: Do It in the Body

The old interaction and wait options (`clickSelector`, `hoverSelector`,
`keyPressSelectors`, `readySelector`, `readyEvent`, `delay`, `hideSelectors`,
`removeSelectors`, `postInteractionWait`, ...) are gone — the test body is a
real Playwright function, so write the behaviour there. The screenshot is taken
after the body returns.

```ts
abTest('Open nav menu', { startingPath: '/' }, async ({ page }) => {
  // Click and hover before the screenshot (waits for the element implicitly)
  await page.click('.my-hamburger-menu');
  await page.hover('.my-hamburger-menu .some-menu-item');

  // Wait until the app is actually ready — a real condition beats a delay
  await page.waitForSelector('#catOfTheDayResult', { timeout: 30_000 });
  // ...or wait for the page to settle (network, images, fonts, mutations)
  await waitUntilPageSettled(page);

  // Hide dynamic content (e.g. ad banners) while keeping the layout flow...
  await page.locator('.ad-banner')
    .evaluateAll((els) => els.forEach((el) => { el.style.visibility = 'hidden'; }));
  // ...or remove it from the DOM entirely
  await page.locator('.popover').evaluateAll((els) => els.forEach((el) => el.remove()));
});
```

The complete removed-option → body-recipe table lives in
[BREAKING_CHANGES.md](../../BREAKING_CHANGES.md).

### Setting Cookies

Seed cookies (and localStorage/auth) before the page loads from a `beforeNavigate`
hook — `shared.beforeNavigate` in the config for every test, or override it for
one test via `config: { shared: { beforeNavigate } }` (which fully replaces the
global for that test — call a shared function if you want both). It runs on the
Playwright `BrowserContext` after the per-run state clear, so what you seed
survives into the navigation:

```ts
abTest('Authenticated page', {
  startingPath: '/dashboard',
  config: {
    shared: {
      beforeNavigate: async ({ context, url }) => {
        await context.addCookies([{ name: 'session', value: '…', url }]);
        // localStorage/auth too, via context.addInitScript(...)
      },
    },
  },
}, async ({ page }) => { /* ... */ });
```

### Targeting Elements

Screenshots can capture your entire layout or just parts of it, via the `visregSelectors` array on the `abTest()` config. Elements use standard CSS notation. `shaka-perf visreg` takes a screenshot of the first occurrence of each selector found in your DOM — to capture several instances, list each one explicitly (`'.list li:nth-child(1)'`, `'.list li:nth-child(2)'`, …).

### Comparing Different Endpoints

Control and experiment URLs come from `shared.controlURL` / `shared.experimentURL` in `abtests.config.ts`. When a route was renamed between the two sides, keep `startingPath` for control and point the experiment elsewhere with `experimentPathOverride`:

```ts
abTest('Cart page', {
  startingPath: '/cart',              // control side
  experimentPathOverride: '/basket',  // experiment side
}, async ({ page }) => { /* ... */ });
```

### Capturing the Document, Viewport, or Specific Elements

`shaka-perf visreg` recognizes two magic selectors: `document` and `viewport` — these capture the entire document and just the current specified viewport respectively. You can mix them with CSS selectors:

```ts
visregSelectors: ['document', 'viewport', '#myFeature']
```

### Changing Test Sensitivity

`mismatchThreshold` (percentage 0.00%-100.00%) controls how much difference `shaka-perf visreg` will tolerate before marking a test as failed. The default is `0.1` — set it once in the config's `visreg` slice, or for one test via `config.visreg.mismatchThreshold`.

A change in a capture's dimensions always fails the compare — a resize IS a visual difference; there is no "tolerate resizes" mode.

## Running Custom Scripts

There is no separate lifecycle hook for in-page scripting — the test body IS the custom script. It receives a `TestFnContext` with `page`, `browserContext`, `isControl`, `scenario`, `viewport`, `testType`, and `annotate`; anything you do there (log in, open a menu, dismiss a modal) happens before the screenshot. For setup that must run before the page exists — cookies, request blocking, init scripts — use `config.shared.beforeNavigate` (see [Setting Cookies](#setting-cookies)).

```ts
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Authenticated dashboard', {
  startingPath: '/dashboard',
  config: {
    shared: {
      beforeNavigate: async ({ context, url }) => {
        await context.addCookies([{ name: 'session', value: '…', url }]);
      },
    },
  },
}, async ({ page }) => {
  await page.click('[data-cy="open-usage-panel"]');
  await waitUntilPageSettled(page);
});
```

The visreg helpers (`shaka-perf/visreg/helpers`) include:

- `waitUntilPageSettled` — Wait for the page to fully render before screenshotting
- `interceptImages` — Stub out image requests for deterministic captures
- `overrideCSS` — Inject CSS into the page

## Playwright Engine Configuration

`shaka-perf visreg` uses Playwright as its rendering engine. It supports `chromium`, `firefox`, and `webkit` browsers via `shared.playwrightOptions.browser` (or the visreg-only `visreg.playwrightOptions.browser` override).

To seed cookies, localStorage, or a logged-in session before tests run, use a
`beforeNavigate` hook (see [Setting Cookies](#setting-cookies)) — the Playwright
`BrowserContext` it receives can `addCookies(...)`, `addInitScript(...)`, set
extra headers, and more.

### Playwright Option Flags

`shaka-perf visreg` sets two defaults for Playwright:

```
ignoreHTTPSErrors: true
headless: true
```

You can add more settings (or override the defaults) with
`shared.playwrightOptions` (all stages — required, with an explicit `browser`)
or `visreg.playwrightOptions` (visreg only — a partial, merged per-key over
shared):

```ts
shared: {
  playwrightOptions: {
    browser: 'chromium',
    ignoreHTTPSErrors: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    gotoParameters: { waitUntil: 'networkidle0' },
  },
}
```

## Reporting

Visreg has no report of its own. Each engine invocation measures one test at one
viewport and writes a `report.json` into that unit's artifacts directory, which
`shaka-perf compare` harvests into the single self-contained
`compare-results/report.html`. The path is printed to the terminal at the end of
a run — copy-paste it into your browser.

The compare runner pins where that `report.json` goes; the engine never chooses.

## Performance Tuning

Concurrency is owned by the compare runner: each engine invocation measures one
test at one viewport, and `shared.parallelism` in `abtests.config.ts` controls
how many such units run at once. The engine's internal capture/compare limits
are pinned per unit by the runner and are not user-configurable.

## Resemble.js Output Options

By specifying `resembleOutputOptions` in your config, you can modify the image-diff transparency, error color, etc.:

```ts
resembleOutputOptions: {
  errorColor: { red: 255, green: 0, blue: 255 },
  errorType: 'movement',
  transparency: 0.3,
  ignoreAntialiasing: true,
}
```

If you need a `mismatchThreshold` below `0.01` (e.g. for large screenshots or very small changes), set `usePreciseMatching` in `resembleOutputOptions`.

## Debugging

Display the browser window as tests run to visually see your app state at the time of the test:

```ts
visreg: {
  playwrightOptions: { headless: false },
}
```

## Git Integration

For most projects, keeping reference files in source control is useful, but saving test screenshots is overkill. Add this to your `.gitignore`:

```
compare-results/
```

## Programmatic Usage

```ts
import { runCompare } from 'shaka-perf/compare';

// Basic usage — reads abtests.config.ts from the current working directory
await runCompare({ categories: ['visreg'] });

// With filter
await runCompare({
  categories: ['visreg'],
  filter: 'Homepage',
});
```

`runCompare` returns `{ reportPath, hasFailures, failureSummary }`. When run via CLI, `shaka-perf compare` exits non-zero on regressions or engine errors so CI treats the run as a failed assertion.

## Integration with twin-servers

`shaka-perf visreg` pairs well with [shaka-perf twin-servers](./README-twin-servers.md) for A/B performance and visual testing. Twin-servers runs your app on two ports (control on 3020, experiment on 3030), and you point shaka-perf visreg's `referenceUrl` at one and `url` at the other.
