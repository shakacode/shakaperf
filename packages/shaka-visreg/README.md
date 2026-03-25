# shaka-visreg

Visual regression testing for web applications — catch CSS changes by comparing screenshots across environments.

Built on Playwright. Uses pixel-level diffing to detect visual changes and generates interactive HTML reports.

## Contents

- [shaka-visreg](#shaka-visreg)
  - [Contents](#contents)
  - [Commands](#commands)
    - [liveCompare](#livecompare)
    - [CLI Options](#cli-options)
  - [Getting Started](#getting-started)
    - [Initializing Your Project](#initializing-your-project)
  - [Configuration](#configuration)
    - [Required Properties](#required-properties)
    - [Example Config](#example-config)
    - [JS Config Files](#js-config-files)
    - [Scenario Properties](#scenario-properties)
    - [Global Scenario Defaults](#global-scenario-defaults)
    - [Setting The Bitmap And Script Directory Paths](#setting-the-bitmap-and-script-directory-paths)
    - [Changing Screenshot Filename Formats](#changing-screenshot-filename-formats)
  - [Advanced Scenarios](#advanced-scenarios)
    - [Click and Hover Interactions](#click-and-hover-interactions)
    - [Key Press Interactions](#key-press-interactions)
    - [Setting Cookies](#setting-cookies)
    - [Targeting Elements](#targeting-elements)
      - [`selectorExpansion`](#selectorexpansion)
      - [`expect`](#expect)
    - [Testing SPAs and Ajax Content](#testing-spas-and-ajax-content)
      - [Trigger Capture Via Selector](#trigger-capture-via-selector)
      - [Trigger Capture Via `console.log()`](#trigger-capture-via-consolelog)
      - [Delay Capture](#delay-capture)
    - [Dealing with Dynamic Content](#dealing-with-dynamic-content)
    - [Comparing Different Endpoints](#comparing-different-endpoints)
    - [Capturing the Document, Viewport, or Specific Elements](#capturing-the-document-viewport-or-specific-elements)
    - [Changing Test Sensitivity](#changing-test-sensitivity)
  - [Running Custom Scripts](#running-custom-scripts)
    - [Script Variables](#script-variables)
    - [Setting the Base Path for Custom Scripts](#setting-the-base-path-for-custom-scripts)
  - [Playwright Engine Configuration](#playwright-engine-configuration)
    - [Playwright Option Flags](#playwright-option-flags)
  - [Reporting](#reporting)
    - [CI Report Configuration](#ci-report-configuration)
    - [Capturing Console Logs in Reports](#capturing-console-logs-in-reports)
  - [Performance Tuning](#performance-tuning)
    - [Capturing Screens in Parallel](#capturing-screens-in-parallel)
    - [Comparing Screens in Parallel](#comparing-screens-in-parallel)
  - [Resemble.js Output Options](#resemblejs-output-options)
  - [Debugging](#debugging)
  - [Git Integration](#git-integration)
  - [Programmatic Usage](#programmatic-usage)
  - [Integration with shaka-twin-servers](#integration-with-shaka-twin-servers)

---

## Commands

```bash
# Initialize a new project with boilerplate config
shaka-visreg init

# Compare screenshots between a reference URL and test URL side-by-side
shaka-visreg liveCompare --config visreg.json

# Open the most recent test report in your browser
shaka-visreg openReport
```

### liveCompare

The main workflow. Captures screenshots from both a reference URL and test URL for each scenario, compares them pixel-by-pixel, and generates a report showing any visual differences. Supports retry logic for flaky comparisons.

Each scenario requires a `referenceUrl` (your baseline, e.g. production) and a `url` (what you're testing, e.g. staging).

Pass `--filter=<scenarioLabelRegex>` to run only scenarios matching your regex.

> [!TIP]
> The `--filter` argument is a useful shortcut for re-running a single test or just the failed tests.

### CLI Options

```
--config <path>     Config file path (default: visreg.json)
--filter <regex>    Filter scenarios by label
-h, --help          Display usage
-v, --version       Display version
```

## Getting Started

### Initializing Your Project

shaka-visreg can create a default configuration file and project scaffolding in your current working directory. Please note: this will overwrite any existing files!

```sh
shaka-visreg init
```

## Configuration

By default, shaka-visreg looks for `visreg.json` in your current working directory. Use `--config=<path>` to specify a different config file.

### Required Properties

- **`id`** — Used for screenshot naming. Set this property when sharing reference files with teammates — otherwise omit and shaka-visreg will auto-generate one for you.
- **`viewports`** — An array of screen size objects your DOM will be tested against. Add as many as you like — but add at least one.
- **`scenarios`** — Your test cases. The important sub properties are:
  - **`scenarios[n].label`** — Required. Also used for screenshot naming.
  - **`scenarios[n].url`** — Required. The URL of your app state (what you're testing). Can be absolute or relative to your current working directory.
  - **`scenarios[n].referenceUrl`** — Required. The baseline URL to compare against (e.g. production or control server).

> [!TIP]
> No other scenario properties are required. Other properties can just be added as necessary.

Pass a `--filter=<scenarioLabelRegex>` argument to just run scenarios matching your scenario label.

> [!TIP]
> The `--filter` argument offers a useful shortcut for re-running a single test or failed tests.

### Example Config

```json
{
  "id": "my_app",
  "viewports": [
    { "label": "phone", "width": 320, "height": 480 },
    { "label": "tablet", "width": 1024, "height": 768 },
    { "label": "desktop", "width": 1280, "height": 1024 }
  ],
  "onBeforeScript": "playwright/onBefore.js",
  "onReadyScript": "playwright/onReady.js",
  "scenarios": [
    {
      "label": "Homepage",
      "url": "http://localhost:3030",
      "referenceUrl": "http://localhost:3020",
      "selectors": ["viewport"],
      "misMatchThreshold": 0.1
    }
  ],
  "paths": {
    "htmlReport": "visreg_data/html_report",
    "ciReport": "visreg_data/ci_report"
  },
  "engine": "playwright",
  "engineOptions": {
    "args": ["--no-sandbox"]
  },
  "asyncCaptureLimit": 5,
  "asyncCompareLimit": 50,
  "report": ["browser"],
  "debug": false,
  "debugWindow": false,
  "archiveReport": true,
  "scenarioLogsInReports": true
}
```

### JS Config Files

You may use a JavaScript config file to allow comments in your config. Be sure to export your config object as a node module.

```js
module.exports = {
  /* same object as visreg.json */
}
```

Then run: `shaka-visreg liveCompare --config="visreg.js"`

### Scenario Properties

Scenario properties, [which may be global](#global-scenario-defaults), are **processed sequentially in the following order:**

| Property                | Description                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`                 | [required] Tag saved with your reference images                                                                                                     |
| `onBeforeScript`        | Used to set up browser state e.g. cookies                                                                                                           |
| `cookiePath`            | Import cookies in JSON format (available with default onBeforeScript, see [Setting Cookies](#setting-cookies))                                      |
| `url`                   | [required] The URL of your app state                                                                                                                |
| `referenceUrl`          | Specify a different state or environment for reference (required for liveCompare)                                                                   |
| `readyEvent`            | Wait until this string has been logged to the console                                                                                               |
| `readySelector`         | Wait until this selector exists before continuing                                                                                                   |
| `readyTimeout`          | Timeout for readyEvent and readySelector (default: 30000ms)                                                                                         |
| `delay`                 | Wait for x milliseconds                                                                                                                             |
| `hideSelectors`         | Array of selectors set to `visibility: hidden`                                                                                                      |
| `removeSelectors`       | Array of selectors set to `display: none`                                                                                                           |
| `onReadyScript`         | After the above conditions are met — use this script to modify UI state prior to screenshots (e.g. hovers, clicks)                                  |
| `keyPressSelectors`     | Array of `{selector, keyPress}` objects — simulates multiple sequential keypress interactions                                                       |
| `hoverSelector`         | Move the pointer over the specified DOM element prior to the screenshot                                                                             |
| `hoverSelectors`        | Array of selectors — simulates multiple sequential hover interactions                                                                               |
| `clickSelector`         | Click the specified DOM element prior to the screenshot                                                                                             |
| `clickSelectors`        | Array of selectors — simulates multiple sequential click interactions                                                                               |
| `postInteractionWait`   | Wait for a selector after interacting with hoverSelector or clickSelector (optionally accepts wait time in ms). Ideal for click/hover transitions   |
| `scrollToSelector`      | Scrolls the specified DOM element into view prior to the screenshot                                                                                 |
| `selectors`             | Array of selectors to capture. Defaults to `document` if omitted. Use `"viewport"` for viewport size. See [Targeting Elements](#targeting-elements) |
| `selectorExpansion`     | See [Targeting Elements](#targeting-elements) below                                                                                                 |
| `expect`                | Expected number of selector matches (with selectorExpansion). Fails if count doesn't match                                                          |
| `misMatchThreshold`     | Percentage of different pixels allowed to pass (default: 0.1)                                                                                       |
| `requireSameDimensions` | If true, any change in selector size triggers a test failure (default: true)                                                                        |
| `viewports`             | Override root-level viewports for this scenario                                                                                                     |
| `gotoParameters`        | Settings passed to Playwright's `page.goto(url, parameters)`                                                                                        |

### Global Scenario Defaults

You can include any of the above properties at the "global" level in the `scenarioDefaults` configuration object.

```json
{
  "scenarioDefaults": {
    "cookiePath": "visreg_data/engine_scripts/cookies.json",
    "readySelector": "",
    "delay": 0,
    "misMatchThreshold": 0.1,
    "requireSameDimensions": true
  },
  "scenarios": [...]
}
```

> [!IMPORTANT]
> Global configuration is overridden at the scenario level. A scenario with `"selectors": []` set as an empty array will yield zero selectors — `scenarioDefaults.selectors` will NOT be used as a fallback. `scenario.selectors` takes precedence.

### Setting Directory Paths

By default, shaka-visreg saves generated resources into the `visreg_data` directory in parallel with your `visreg.json` config file. The location of the various resource types are configurable so they can easily be moved inside or outside your source control or file sharing environment.

Control and experiment screenshots are always stored inside the HTML report directory (`html_report/control_screenshot` and `html_report/experiment_screenshot`).

> [!TIP]
> These file paths are relative to your current working directory.

```json
"paths": {
  "htmlReport": "visreg_data/html_report",
  "jsonReport": "visreg_data/json_report",
  "ciReport": "visreg_data/ci_report"
}
```

### Changing Screenshot Filename Formats

shaka-visreg uses a specific file-naming scheme to manage screenshot files. Changing this is NOT RECOMMENDED, but if you have an overwhelming need, you can modify it using the `fileNameTemplate` property:

```json
{
  "fileNameTemplate": "{scenarioIndex}_{scenarioLabel}_{selectorIndex}_{selectorLabel}_{viewportIndex}_{viewportLabel}"
}
```

## Advanced Scenarios

### Click and Hover Interactions

shaka-visreg ships with an `onReady` script that enables interaction selectors:

```js
"clickSelector": ".my-hamburger-menu",
"hoverSelector": ".my-hamburger-menu .some-menu-item",
```

The above would wait for your app to generate an element with a `.my-hamburger-menu` class, then click that selector. Then wait again for a `.my-hamburger-menu .some-menu-item` class, then move the cursor over that element (causing a hover state). Then take a screenshot.

You can use these properties independent of each other to test various click and/or hover states. For more complex needs, create your own `onReady` scripts.

> [!NOTE]
> You can also use `clickSelectors` & `hoverSelectors` as arrays of selectors:

```js
"clickSelectors": [".my-hamburger-menu", ".my-hamburger-item"],
"hoverSelectors": [".my-nav-menu-item", ".my-nav-menu-dropdown-item"],
```

### Key Press Interactions

The built-in `onReady` script allows key press on selectors:

```json
{
  "keyPressSelectors": [
    {
      "selector": "#email",
      "keyPress": "user@example.com"
    },
    {
      "selector": "#password",
      "keyPress": "1234"
    }
  ]
}
```

### Setting Cookies

The built-in `onBefore` script makes it easy to import cookie files:

```json
"cookiePath": "visreg_data/engine_scripts/cookies.json"
```

> [!NOTE]
> Path is relative to your current working directory.

### Targeting Elements

Screenshots can capture your entire layout or just parts of it, defined in the `scenario.selectors` array. Elements use standard CSS notation. By default, shaka-visreg takes a screenshot of the first occurrence of any selector found in your DOM.

#### `selectorExpansion`

To capture _all_ matching selector instances, set `selectorExpansion` to `true`:

```json
{
  "selectors": [".aListOfStuff li"],
  "selectorExpansion": true
}
```

With `selectorExpansion` set to `false` (the default), only the first matching element is captured.

#### `expect`

When working with `selectorExpansion`, you can explicitly set the expected number of results. The test will fail if the actual count doesn't match:

```json
{
  "selectors": [".aListOfStuff li"],
  "selectorExpansion": true,
  "expect": 5
}
```

### Testing SPAs and Ajax Content

Client-side web apps often progressively load content. The challenge is knowing _when_ to take the screenshot. shaka-visreg solves this with `readySelector`, `readyEvent`, and `delay`.

#### Trigger Capture Via Selector

The `readySelector` property waits until a selector exists before taking a screenshot:

```json
"readySelector": "#catOfTheDayResult"
```

#### Trigger Capture Via `console.log()`

The `readyEvent` property triggers capture when a predefined string is logged to the console:

```json
"readyEvent": "app_ready"
```

It's up to you to log this string in your app after all dependencies have loaded.

#### Delay Capture

The `delay` property pauses capture for a specified duration (in ms). This delay is applied _after_ `readyEvent` (if also set):

```json
{
  "readyEvent": "app_ready",
  "delay": 1000
}
```

### Dealing with Dynamic Content

For testing a DOM with dynamic content (e.g. ad banners), you have two options:

- **`hideSelectors`** — Sets the element to `visibility: hidden`, hiding it from analysis but retaining the original layout flow:

  ```json
  "hideSelectors": ["#someFixedSizeDomSelector"]
  ```

- **`removeSelectors`** — Removes elements from the DOM entirely before screenshots:

  ```json
  "removeSelectors": ["#someUnpredictableSizedDomSelector"]
  ```

### Comparing Different Endpoints

Comparing different endpoints (e.g. staging vs production) is easy with `referenceUrl`. For `liveCompare`, set `referenceUrl` to your baseline and `url` to what you're testing:

```json
{
  "label": "cat meme feed sanity check",
  "url": "http://staging.moreCatMemes.com",
  "referenceUrl": "http://www.moreCatMemes.com"
}
```

### Capturing the Document, Viewport, or Specific Elements

shaka-visreg recognizes two magic selectors: `document` and `viewport` — these capture the entire document and just the current specified viewport respectively. You can mix them with CSS selectors:

```json
"selectors": [
  "document",
  "viewport",
  "#myFeature"
]
```

### Changing Test Sensitivity

`"misMatchThreshold"` (percentage 0.00%-100.00%) controls how much difference shaka-visreg will tolerate before marking a test as "failed". The default is `0.1` — adjust based on the kinds of testing you're doing.

`"requireSameDimensions"` (default: `true`) controls whether any change in dimensions causes a failure. Setting it to `false` allows dimension changes as long as pixel differences stay within `misMatchThreshold`.

These settings work in conjunction — e.g. with a non-zero `misMatchThreshold` and a mismatch that causes a dimension change, `requireSameDimensions: false` allows the test to still pass.

## Running Custom Scripts

Simulate user actions (click, scroll, hover, wait, etc.) or set up state (cookies) by running your own scripts. Place scripts in your engine scripts directory:

```
./visreg_data/engine_scripts
```

Reference them at the config root or per-scenario:

```json
{
"onReadyScript": "filename.js"   // Runs after onReady event on all scenarios -- use for simulating interactions (.js suffix is optional)
"onBeforeScript": "filename.js"  // Runs before each scenario -- use for setting cookies or other env state (.js suffix is optional)
"scenarios": [
  {
    "label": "cat meme feed sanity check",
    "onReadyScript": "filename.js",   //  If found will run instead of onReadyScript set at the root (.js suffix is optional)
    "onBeforeScript": "filename.js" // If found will run instead of onBeforeScript at the root (.js suffix is optional)
     // ...
  }
]
}
```

Per-scenario scripts override root-level scripts. The `.js` suffix is optional.

Inside your script file:

```js
// onBefore example (playwright engine)
module.exports = async (page, scenario, vp, isReference) => {
  await require('./loadCookies')(page, scenario)
  // Example: set user agent
  await page.setUserAgent('some user agent string here')
}

// onReady example (playwright engine)
module.exports = async (page, scenario, vp) => {
  console.log('SCENARIO > ' + scenario.label)
  await require('./clickAndHoverHelper')(page, scenario)

  // Example: changing behavior based on viewport
  if (vp.label === 'phone') {
    console.log('doing stuff for just phone viewport here')
  }
}
```

#### Script Variables

| Variable      | Description                                            |
| ------------- | ------------------------------------------------------ |
| `page`        | Playwright browser page object                         |
| `scenario`    | Currently running scenario config                      |
| `viewport`    | Viewport info                                          |
| `isReference` | Whether the scenario contains a reference URL property |
| `Engine`      | Static class reference (Playwright)                    |
| `config`      | The whole config object                                |

#### Setting the Base Path for Custom Scripts

By default, the base path is a folder called `engine_scripts` inside your installation directory. Override this with `paths.engine_scripts` in your config (recommended):

```json
"paths": {
  "engine_scripts": "visreg_data/engine_scripts"
}
```

## Playwright Engine Configuration

shaka-visreg uses Playwright as its rendering engine. It supports `chromium`, `firefox`, and `webkit` browsers via `engineOptions.browser`.

The [storageState](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state) config property is supported via `engineOptions`. This sets cookies _and_ localStorage variables before tests are run — very useful for pages that require authentication.

```json
{
  "engine": "playwright",
  "engineOptions": {
    "browser": "chromium",
    "storageState": "/path/to/cookies-and-local-storage-file.json"
  }
}
```

### Playwright Option Flags

shaka-visreg sets two defaults for Playwright:

```
ignoreHTTPSErrors: true
headless: !config.debugWindow
```

You can add more settings (or override the defaults) with `engineOptions` (properties are merged):

```json
"engineOptions": {
  "ignoreHTTPSErrors": false,
  "args": ["--no-sandbox", "--disable-setuid-sandbox"],
  "gotoParameters": { "waitUntil": "networkidle0" }
}
```

## Reporting

Use the `report` property to enable report types:

```json
"report": ["browser", "CI"]
```

Available report types:

- `"browser"` — Interactive HTML report with visual diff UI, scrubber, and scenario filtering
- `"CI"` — JUnit XML report for CI integration (Jenkins, GitLab CI, etc.)
- `"json"` — Machine-readable JSON report

You can always view the latest report with:

```sh
shaka-visreg openReport
```

### CI Report Configuration

Customize the JUnit report with:

```json
"paths": {
  "ciReport": "visreg_data/ci_report"
},
"ci": {
  "format": "junit",
  "testReportFileName": "myproject-xunit",
  "testSuiteName": "shaka-visreg"
}
```

### Capturing Console Logs in Reports

Set `"scenarioLogsInReports": true` at the config root to include browser console output in HTML reports.

> [!NOTE]
> To view the logs, you will need to serve the reports from an HTTP server.

## Performance Tuning

shaka-visreg processes image capture and image comparisons in parallel. You can adjust concurrency to balance speed vs. RAM usage.

### Capturing Screens in Parallel

Default: 10 concurrent captures. Adjust with:

```json
"asyncCaptureLimit": 5
```

### Comparing Screens in Parallel

Default: 50 concurrent comparisons. As a rough rule of thumb, shaka-visreg will use ~100MB RAM plus ~5MB for each concurrent image comparison.

```json
"asyncCompareLimit": 100
```

## Resemble.js Output Options

By specifying `resembleOutputOptions` in your config, you can modify the image-diff transparency, error color, etc.:

```json
"resembleOutputOptions": {
  "errorColor": {
    "red": 255,
    "green": 0,
    "blue": 255
  },
  "errorType": "movement",
  "transparency": 0.3,
  "ignoreAntialiasing": true
}
```

If you need a `misMatchThreshold` below `0.01` (e.g. for large screenshots or very small changes), set `usePreciseMatching` in `resembleOutputOptions`.

## Debugging

Display the browser window as tests run to visually see your app state at the time of the test:

```json
"debugWindow": true
```

Enable verbose console output with:

```json
"debug": true
```

This will also output your source payload to the terminal so you can verify the server is sending what you expect.

## Git Integration

For most projects, keeping reference files in source control is useful, but saving test screenshots is overkill. Add these to your `.gitignore`:

```
visreg_data/html_report/
```

## Programmatic Usage

```js
import runner from 'shaka-visreg'

// Basic usage
await runner('liveCompare', { config: 'visreg.json' })

// With filter
await runner('liveCompare', {
  filter: 'someScenarioLabelAsRegExString',
  config: 'visreg.json',
})

// With inline config object
await runner('liveCompare', {
  config: {
    id: 'foo',
    scenarios: [
      // scenarios here
    ],
  },
})
```

The runner returns a promise — resolves on success, rejects on failure. When run via CLI, shaka-visreg returns exit code 0 on success and 1 on failure, making it easy to integrate into build pipelines.

## Integration with shaka-twin-servers

shaka-visreg pairs well with [shaka-twin-servers](../shaka-twin-servers/README.md) for A/B performance and visual testing. Twin-servers runs your app on two ports (control on 3020, experiment on 3030), and you point shaka-visreg's `referenceUrl` at one and `url` at the other.
