# Accessibility tests for demo-ecommerce

Pure Playwright + [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright) exploration suite. Seven test files, each demonstrating a different slice of the library.

Not a CI gate — the tests use `expect.soft` so a run always completes and you can read everything axe found. Flip `expect.soft` → `expect` when you want them to block a merge.

---

## Prerequisites

- demo-ecommerce server running at `http://localhost:3030` (you start it yourself; the tests don't boot a server).
- Node / Yarn already set up per the repo root `README.md`.

Verify the server is reachable:

```bash
curl -sI http://localhost:3030/ | head -1   # expect: HTTP/1.1 200 OK
```

## First-time setup

From the repo root:

```bash
yarn install
yarn workspace demo-ecommerce playwright install chromium
```

The second command downloads the Chromium binary Playwright drives. Only needed once per machine (or after a major Playwright version bump).

## Running the tests

All commands run from the repo root.

```bash
# Run every a11y test file
yarn workspace demo-ecommerce test:a11y

# Run one file
yarn workspace demo-ecommerce test:a11y 02-wcag-tags.spec.ts

# Run one named test inside a file (regex match on the title)
yarn workspace demo-ecommerce test:a11y -g "best-practice"

# Interactive UI mode — great for iterating on a single test
yarn workspace demo-ecommerce test:a11y:ui

# Open the HTML report from the last run
yarn workspace demo-ecommerce test:a11y:report
```

You can also `cd demo-ecommerce && yarn test:a11y`.

## What each file teaches

| File | Feature | AxeBuilder methods |
| --- | --- | --- |
| `01-basic-scan.spec.ts` | Anatomy of a scan result — what's in `violations`, `passes`, `incomplete`, `inapplicable`, plus scan metadata. | `analyze()` |
| `02-wcag-tags.spec.ts` | Filtering by WCAG level (2.0 A/AA, 2.1 AA, 2.2 AA, best-practice, combined). | `.withTags()` |
| `03-include-exclude.spec.ts` | Scoping scans to specific regions, or excluding noisy ones. | `.include()`, `.exclude()` |
| `04-rule-filtering.spec.ts` | Running only specific rules, or everything except specific rules. | `.withRules()`, `.disableRules()` |
| `05-axe-options.spec.ts` | Raw axe options — `resultTypes`, `runOnly`, `rules` map, `iframes`, `absolutePaths` — plus legacy iframe mode. | `.options()`, `.setLegacyMode()` |
| `06-configure.spec.ts` | Registering custom checks and rules, and overriding metadata on built-in rules. | `.configure()` |
| `07-multipage-and-report.spec.ts` | Parametrized scans across every route, with JSON + screenshot + summary attached to the Playwright HTML report. | `testInfo.attach()` |

## Reading the output

**Terminal (`list` reporter)** — each test logs a short summary via `console.log` inside the test body. Soft-assertion failures are shown at the end under "Failed soft assertions".

**HTML report (`yarn test:a11y:report`)** — one page per test, with:
- Trace of the Playwright run.
- `console.log` output captured.
- Attachments: file 01 attaches `axe-full-result.json`; file 07 attaches a JSON, screenshot, and text summary for every route.

### Violation field reference

Every entry in `results.violations` has:

| Field | What it is |
| --- | --- |
| `id` | Rule ID, e.g. `color-contrast`. Look up at <https://github.com/dequelabs/axe-core/blob/master/doc/rule-descriptions.md>. |
| `impact` | `minor` / `moderate` / `serious` / `critical`. Triage by this first. |
| `tags` | WCAG/section508/best-practice tags the rule carries. Used by `.withTags`. |
| `description` / `help` | One-liners for humans. |
| `helpUrl` | Deque docs page with remediation guidance and code examples. |
| `nodes[]` | The failing elements. Each has `target` (CSS selector array), `html` (outerHTML), `failureSummary` (human-readable reason), and check-level breakdowns (`any` / `all` / `none`). |

### Impact levels — how to triage

- **critical** — blocks assistive tech entirely (e.g. missing `alt` on content images).
- **serious** — substantial barrier for many users (e.g. color contrast below 3:1).
- **moderate** — partial barrier or inconvenience.
- **minor** — best-practice nit.

## Why soft assertions

The demo app has real accessibility issues. Running with hard assertions would halt each test at the first violation — you'd see one problem per test and miss the rest. With `expect.soft`, every test runs end-to-end and the terminal shows you the full picture across all seven files.

When you want to lock in a baseline (no new regressions), replace `expect.soft` with `expect` in the file(s) you care about, or switch the reporter to `['html', { open: 'never' }]` + a custom matcher. Nothing else about the setup needs to change.

## Troubleshooting

- **`connect ECONNREFUSED 127.0.0.1:3030`** — server isn't running. Start it before `yarn test:a11y`.
- **`Executable doesn't exist at .../chromium-XXXX`** — run `yarn workspace demo-ecommerce playwright install chromium` again; Playwright version was bumped.
- **Empty `violations` but lots of `incomplete`** — axe couldn't determine compliance automatically (common with color contrast over complex backgrounds). Open the JSON attachment and review manually.
- **Custom rule in file 06 never fires** — check that the `evaluate` function is a STRING, not a real function. It's serialised and re-parsed in the page context.

## Useful links

- axe-core rule catalog — <https://github.com/dequelabs/axe-core/blob/master/doc/rule-descriptions.md>
- axe-core API docs — <https://github.com/dequelabs/axe-core/blob/master/doc/API.md>
- `@axe-core/playwright` README — <https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright>
- Deque University (remediation guides linked from `helpUrl`) — <https://dequeuniversity.com/rules/axe/>
