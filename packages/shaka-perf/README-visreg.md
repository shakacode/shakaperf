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
  - [Scenario Properties](#scenario-properties)
  - [Changing Screenshot Filename Formats](#changing-screenshot-filename-formats)
- [Advanced Scenarios](#advanced-scenarios)
  - [Click and Hover Interactions](#click-and-hover-interactions)
  - [Key Press Interactions](#key-press-interactions)
  - [Setting Cookies](#setting-cookies)
  - [Targeting Elements](#targeting-elements)
  - [Testing SPAs and Ajax Content](#testing-spas-and-ajax-content)
  - [Dealing with Dynamic Content](#dealing-with-dynamic-content)
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
  visreg: {
    viewports: ['desktop', 'tablet', 'phone'],
    engineOptions: {
      browser: 'chromium',
      args: ['--no-sandbox'],
    },
    asyncCaptureLimit: 5,
    compareRetries: 2,
    compareRetryDelay: 500,
    maxNumDiffPixels: 50,
    defaultMisMatchThreshold: 0.1,
  },
});
```

Run `shaka-perf init` to scaffold a fully-commented `abtests.config.ts` with every default listed.

Scenarios are defined as standalone `*.abtest.ts` files in an `ab-tests/` directory — this lets you co-locate test definitions with the features they cover. See the [shaka-shared `abTest()` registry](../shaka-shared/) for how to author them.

### Scenario Properties

Per-test visreg options go under `options.visreg` on each `abTest(...)` call. The full set — processed sequentially in the order listed:

| Property                | Description                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onBefore`              | Lifecycle hook — runs before page navigation. Use to set up cookies, auth state, etc.                                                               |
| `cookiePath`            | Import cookies in JSON format (see [Setting Cookies](#setting-cookies))                                                                             |
| `readyEvent`            | Wait until this string has been logged to the console                                                                                               |
| `readySelector`         | Wait until this selector exists before continuing                                                                                                   |
| `readyTimeout`          | Timeout for readyEvent and readySelector (default: 30000ms)                                                                                         |
| `delay`                 | Wait for x milliseconds                                                                                                                             |
| `hideSelectors`         | Array of selectors set to `visibility: hidden`                                                                                                      |
| `removeSelectors`       | Array of selectors set to `display: none`                                                                                                           |
| `hoverSelector`         | Move the pointer over the specified DOM element prior to the screenshot                                                                             |
| `hoverSelectors`        | Array of selectors — simulates multiple sequential hover interactions                                                                               |
| `clickSelector`         | Click the specified DOM element prior to the screenshot                                                                                             |
| `clickSelectors`        | Array of selectors — simulates multiple sequential click interactions                                                                               |
| `postInteractionWait`   | Wait for a selector after interacting with hoverSelector or clickSelector (optionally accepts wait time in ms). Ideal for click/hover transitions   |
| `scrollToSelector`      | Scrolls the specified DOM element into view prior to the screenshot                                                                                 |
| `selectors`             | Array of selectors to capture. Defaults to `document` if omitted. Use `"viewport"` for viewport size. See [Targeting Elements](#targeting-elements) |
| `selectorExpansion`     | See [Targeting Elements](#targeting-elements) below                                                                                                 |
| `misMatchThreshold`     | Percentage of different pixels allowed to pass (default: 0.1)                                                                                       |
| `requireSameDimensions` | If true, any change in selector size triggers a test failure (default: true)                                                                        |

Narrow which viewports a single test runs at via `options.viewports` (sibling of `options.visreg`) — it's shared with perf and intersects with `visreg.viewports` in `abtests.config.ts`.

### Changing Screenshot Filename Formats

`shaka-perf visreg` uses a specific file-naming scheme to manage screenshot files. Changing this is NOT RECOMMENDED, but if you have an overwhelming need, you can modify it using the `fileNameTemplate` property:

```ts
fileNameTemplate: '{scenarioIndex}_{scenarioLabel}_{selectorIndex}_{selectorLabel}_{viewportIndex}_{viewportLabel}'
```

## Advanced Scenarios

### Click and Hover Interactions

`shaka-perf visreg` supports interaction selectors directly on the scenario:

```ts
clickSelector: '.my-hamburger-menu',
hoverSelector: '.my-hamburger-menu .some-menu-item',
```

The above would wait for your app to generate an element with a `.my-hamburger-menu` class, then click that selector. Then wait again for a `.my-hamburger-menu .some-menu-item` class, then move the cursor over that element (causing a hover state). Then take a screenshot.

You can use these properties independent of each other to test various click and/or hover states.

> [!NOTE]
> You can also use `clickSelectors` & `hoverSelectors` as arrays of selectors:

```ts
clickSelectors: ['.my-hamburger-menu', '.my-hamburger-item'],
hoverSelectors: ['.my-nav-menu-item', '.my-nav-menu-dropdown-item'],
```

### Key Press Interactions

Sequences of key presses can be defined per scenario:

```ts
keyPressSelectors: [
  { selector: '#email', keyPress: 'user@example.com' },
  { selector: '#password', keyPress: '1234' },
],
```

### Setting Cookies

Use `cookiePath` to import a JSON cookie file before the page loads:

```ts
cookiePath: 'visreg_data/cookies/cookies.json'
```

> [!NOTE]
> Path is relative to your current working directory.

### Targeting Elements

Screenshots can capture your entire layout or just parts of it, defined in the `scenario.selectors` array. Elements use standard CSS notation. By default, `shaka-perf visreg` takes a screenshot of the first occurrence of any selector found in your DOM.

#### `selectorExpansion`

To capture _all_ matching selector instances, set `selectorExpansion` to `true`:

```ts
selectors: ['.aListOfStuff li'],
selectorExpansion: true,
```

With `selectorExpansion` set to `false` (the default), only the first matching element is captured.

### Testing SPAs and Ajax Content

Client-side web apps often progressively load content. The challenge is knowing _when_ to take the screenshot. `shaka-perf visreg` solves this with `readySelector`, `readyEvent`, and `delay`.

#### Trigger Capture Via Selector

The `readySelector` property waits until a selector exists before taking a screenshot:

```ts
readySelector: '#catOfTheDayResult'
```

#### Trigger Capture Via `console.log()`

The `readyEvent` property triggers capture when a predefined string is logged to the console:

```ts
readyEvent: 'app_ready'
```

It's up to you to log this string in your app after all dependencies have loaded.

#### Delay Capture

The `delay` property pauses capture for a specified duration (in ms). This delay is applied _after_ `readyEvent` (if also set):

```ts
readyEvent: 'app_ready',
delay: 1000,
```

### Dealing with Dynamic Content

For testing a DOM with dynamic content (e.g. ad banners), you have two options:

- **`hideSelectors`** — Sets the element to `visibility: hidden`, hiding it from analysis but retaining the original layout flow:

  ```ts
  hideSelectors: ['#someFixedSizeDomSelector']
  ```

- **`removeSelectors`** — Removes elements from the DOM entirely before screenshots:

  ```ts
  removeSelectors: ['#someUnpredictableSizedDomSelector']
  ```

### Comparing Different Endpoints

Comparing different endpoints (e.g. staging vs production) is easy with `referenceUrl`. For `compare`, set `referenceUrl` to your baseline and `url` to what you're testing:

```ts
{
  label: 'cat meme feed sanity check',
  url: 'http://staging.moreCatMemes.com',
  referenceUrl: 'http://www.moreCatMemes.com',
}
```

### Capturing the Document, Viewport, or Specific Elements

`shaka-perf visreg` recognizes two magic selectors: `document` and `viewport` — these capture the entire document and just the current specified viewport respectively. You can mix them with CSS selectors:

```ts
selectors: ['document', 'viewport', '#myFeature']
```

### Changing Test Sensitivity

`misMatchThreshold` (percentage 0.00%-100.00%) controls how much difference `shaka-perf visreg` will tolerate before marking a test as failed. The default is `0.1` — adjust based on the kinds of testing you're doing.

`requireSameDimensions` (default: `true`) controls whether any change in dimensions causes a failure. Setting it to `false` allows dimension changes as long as pixel differences stay within `misMatchThreshold`.

These settings work in conjunction — e.g. with a non-zero `misMatchThreshold` and a mismatch that causes a dimension change, `requireSameDimensions: false` allows the test to still pass.

## Running Custom Scripts

Use the `onBefore` lifecycle hook on a scenario to run custom Playwright code (set up state, simulate user actions, etc.):

```ts
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled, loadCookies } from 'shaka-perf/visreg/helpers';

abTest('Authenticated dashboard', {
  startingPath: '/dashboard',
  options: {
    visreg: {
      onBefore: async ({ page }) => {
        await loadCookies(page, { cookiePath: 'visreg_data/cookies/cookies.json' });
      },
    },
  },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
```

The `onBefore` hook receives a `TestFnContext` with `page`, `browserContext`, `isReference`, `scenario`, `viewport`, and `testType`.

The visreg helpers (`shaka-perf/visreg/helpers`) include:

- `waitUntilPageSettled` — Wait for the page to fully render before screenshotting
- `clickAndHoverHelper` — Apply click/hover selectors from the scenario
- `loadCookies` — Load cookies from a JSON file into the browser context
- `interceptImages` — Stub out image requests for deterministic captures
- `overrideCSS` — Inject CSS into the page

## Playwright Engine Configuration

`shaka-perf visreg` uses Playwright as its rendering engine. It supports `chromium`, `firefox`, and `webkit` browsers via `engineOptions.browser`.

The [storageState](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state) config property is supported via `engineOptions`. This sets cookies _and_ localStorage variables before tests are run — very useful for pages that require authentication.

```ts
engineOptions: {
  browser: 'chromium',
  storageState: '/path/to/cookies-and-local-storage-file.json',
}
```

### Playwright Option Flags

`shaka-perf visreg` sets two defaults for Playwright:

```
ignoreHTTPSErrors: true
headless: !config.debugWindow
```

You can add more settings (or override the defaults) with `engineOptions`:

```ts
engineOptions: {
  ignoreHTTPSErrors: false,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  gotoParameters: { waitUntil: 'networkidle0' },
}
```

## Reporting

Use the `report` property to enable report types:

```ts
report: ['browser', 'CI']
```

Available report types:

- `"browser"` — Interactive HTML report with visual diff UI, scrubber, and scenario filtering
- `"CI"` — JUnit XML report for CI integration (Jenkins, GitLab CI, etc.)
- `"json"` — Machine-readable JSON report

After a compare run, the full path to the HTML report is printed to the terminal — copy-paste it into your browser to view.

### CI Report Configuration

Customize the JUnit report with:

```ts
paths: {
  ciReport: 'visreg_data/ci_report',
},
ci: {
  format: 'junit',
  testReportFileName: 'myproject-xunit',
  testSuiteName: 'shaka-perf-visreg',
}
```

### Capturing Console Logs in Reports

Set `scenarioLogsInReports: true` at the config root to include browser console output in HTML reports.

> [!NOTE]
> To view the logs, you will need to serve the reports from an HTTP server.

## Performance Tuning

`shaka-perf visreg` processes image capture and image comparisons in parallel. You can adjust concurrency to balance speed vs. RAM usage.

### Capturing Screens in Parallel

Default: 2 concurrent captures. Adjust with:

```ts
asyncCaptureLimit: 5
```

### Comparing Screens in Parallel

Default: 4 concurrent comparisons. As a rough rule of thumb, `shaka-perf visreg` will use ~100MB RAM plus ~5MB for each concurrent image comparison.

```ts
asyncCompareLimit: 16
```

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

If you need a `misMatchThreshold` below `0.01` (e.g. for large screenshots or very small changes), set `usePreciseMatching` in `resembleOutputOptions`.

## Debugging

Display the browser window as tests run to visually see your app state at the time of the test:

```ts
debugWindow: true
```

Enable verbose console output with:

```ts
debug: true
```

This will also output your source payload to the terminal so you can verify the server is sending what you expect.

## Git Integration

For most projects, keeping reference files in source control is useful, but saving test screenshots is overkill. Add this to your `.gitignore`:

```
visreg_data/html_report/
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
