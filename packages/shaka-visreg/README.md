# shaka-visreg

Visual regression testing for web applications — catch CSS curveballs by comparing screenshots across environments.

Built on Playwright. Uses pixel-level diffing to detect visual changes and generates interactive HTML reports.

## Commands

```bash
# Initialize a new project with boilerplate config
shaka-visreg init

# Compare screenshots between a reference URL and test URL side-by-side
shaka-visreg liveCompare --config backstop.json

# Open the most recent test report in your browser
shaka-visreg openReport
```

### liveCompare

The main workflow. Captures screenshots from both a reference URL and test URL for each scenario, compares them pixel-by-pixel, and generates a report showing any visual differences. Supports retry logic for flaky comparisons.

Each scenario requires a `referenceUrl` (your baseline, e.g. production) and a `url` (what you're testing, e.g. staging).

## Configuration

By default, shaka-visreg looks for `backstop.json` in your current working directory. Use `--config=<path>` to specify a different config file.

### Required Properties

- **`id`** — Used for screenshot naming.
- **`viewports`** — Screen sizes to test against.
- **`scenarios`** — Your test cases. Each needs at minimum:
  - **`label`** — Name for the scenario (also used in screenshot filenames).
  - **`url`** — The URL to test.

### Example Config

```json
{
  "id": "my_app",
  "viewports": [
    { "label": "phone", "width": 320, "height": 480 },
    { "label": "desktop", "width": 1280, "height": 1024 }
  ],
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
    "bitmaps_reference": "backstop_data/bitmaps_reference",
    "bitmaps_test": "backstop_data/bitmaps_test",
    "engine_scripts": "backstop_data/engine_scripts",
    "html_report": "backstop_data/html_report",
    "ci_report": "backstop_data/ci_report"
  },
  "engine": "playwright",
  "report": ["browser"]
}
```

### Scenario Properties

| Property                | Description                                                                 |
|-------------------------|-----------------------------------------------------------------------------|
| `label`                 | [required] Tag saved with your reference images                             |
| `url`                   | [required] The URL to test                                                  |
| `referenceUrl`          | URL for reference screenshots (required for liveCompare)                    |
| `readyEvent`            | Wait until this string has been logged to the console                       |
| `readySelector`         | Wait until this selector exists before capturing                            |
| `readyTimeout`          | Timeout for readyEvent and readySelector (default: 30000ms)                 |
| `delay`                 | Wait for x milliseconds before capture                                      |
| `hideSelectors`         | Array of selectors set to `visibility: hidden`                              |
| `removeSelectors`       | Array of selectors set to `display: none`                                   |
| `onBeforeScript`        | Script to set up browser state (e.g. cookies)                               |
| `onReadyScript`         | Script to modify UI state before screenshot (e.g. hovers, clicks)           |
| `clickSelector`         | Click this DOM element before the screenshot                                |
| `clickSelectors`        | Array of selectors — simulates sequential clicks                            |
| `hoverSelector`         | Hover over this DOM element before the screenshot                           |
| `hoverSelectors`        | Array of selectors — simulates sequential hovers                            |
| `keyPressSelectors`     | Array of `{selector, keyPress}` objects for typing into inputs              |
| `scrollToSelector`      | Scroll this element into view before the screenshot                         |
| `selectors`             | Array of CSS selectors to capture. Defaults to `document`. Use `"viewport"` for viewport size |
| `selectorExpansion`     | Capture all matching instances of each selector (default: false)            |
| `expect`                | Expected number of selector matches (with selectorExpansion)                |
| `misMatchThreshold`     | Percentage of different pixels allowed (default: 0.1)                       |
| `requireSameDimensions` | Fail if screenshot dimensions change (default: true)                        |
| `viewports`             | Override root-level viewports for this scenario                             |
| `cookiePath`            | Path to JSON cookie file                                                    |
| `gotoParameters`        | Settings passed to Playwright's `page.goto()`                               |

### Global Scenario Defaults

Use `scenarioDefaults` at the config root to set default values for all scenarios. Scenario-level properties override these defaults.

```json
{
  "scenarioDefaults": {
    "readySelector": ".app-loaded",
    "misMatchThreshold": 0.1,
    "requireSameDimensions": true
  },
  "scenarios": [...]
}
```

### Dealing with Dynamic Content

- **`hideSelectors`** — Hides elements (e.g. ad banners) via `visibility: hidden`, preserving layout flow.
- **`removeSelectors`** — Removes elements via `display: none`.
- **`readySelector` / `readyEvent`** — Wait for async content to load before capturing.
- **`delay`** — Add a fixed wait after ready conditions are met.

### Capturing Console Logs

Set `"scenarioLogsInReports": true` at the config root to include browser console output in HTML reports.

## CLI Options

```
--config <path>     Config file path (default: backstop.json)
--filter <regex>    Filter scenarios by label
-h, --help          Display usage
-v, --version       Display version
```

## Programmatic Usage

```js
import runner from 'shaka-visreg';

await runner('liveCompare', { config: 'backstop.json' });
```

## Integration with shaka-twin-servers

shaka-visreg pairs well with [shaka-twin-servers](../shaka-twin-servers/README.md) for A/B performance and visual testing. Twin-servers runs your app on two ports (control on 3020, experiment on 3030), and you point shaka-visreg's `referenceUrl` at one and `url` at the other.
