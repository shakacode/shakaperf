# abTest API Reference

## `abTest(name, config, testFn)`

The config is **flat** — there is no `options` key (`abTest()` throws at load
time if it sees one). Interactions, ready-waits, and hide/remove logic live in
the Playwright test body. Tunables (thresholds, viewports, axe rules) live in
`abtests.config.ts`, overridable per test through `config`.

```typescript
import { abTest } from 'shaka-shared';

abTest(name: string, {
  startingPath: string,              // Path both sides navigate to. Test names must not contain commas.
  experimentPathOverride?: string,   // Experiment side navigates here instead (renamed routes);
                                     // control always uses startingPath
  testTypes?: ('visreg' | 'perf' | 'accessibility' | 'audit')[],
                                     // Omitted = every category. 'audit' is always
                                     // auto-added to explicit lists.

  // What visreg captures
  visregSelectors?: string[],        // CSS selectors to screenshot. Default: ['document']
                                     // Special values: 'document' (full page), 'viewport', 'body'
                                     // A CSS selector is clipped to its box within the current
                                     // viewport (the page is NOT resized to fit it) — if the element
                                     // is taller than the viewport, run at a tall viewport
                                     // (PHONE_TALL/TABLET_TALL/DESKTOP_TALL).
  markers?: { start?: string, end: string, label: string }[],
                                     // Per-test perf phase definitions

  beforeNavigate?: (ctx) => Promise<void>,  // Pre-navigation hook — see below

  // Per-test override of abtests.config.ts, merged over the file config for
  // this test alone. Same section shape; only the knobs the engines honour
  // per-test exist here:
  config?: {
    visreg?: {
      mismatchThreshold?: number,  // 0.0–1.0. Default 0.1. Use 0.01 for static pages
      maxNumDiffPixels?: number,          // Max differing pixels allowed
      comparePixelmatchThreshold?: number,
      requireSameDimensions?: boolean,
      viewports?: string[],               // Labels from shared.viewports, e.g. ['desktop']
    },
    perf?: { viewports?: string[] },
    audit?: { viewports?: string[] },
    accessibility?: {
      tags?: string[],
      disableRules?: string[],
      includeRules?: string[],
      viewports?: string[],
    },
  },
}, async ({ page, browserContext, isControl, scenario, viewport, testType, annotate }) => {
  // page: Playwright Page — all interactions and waits go here
  // isControl: true on the control server, false on experiment
  // viewport: { label, width, height, formFactor, deviceScaleFactor }
  // testType: 'visreg' | 'perf' | 'accessibility' | 'audit'
  // annotate: label the next step — failures report "Failed while <label>"
})
```

**Per-test `config` merge rule:** every defined per-test key REPLACES the file
value wholesale — arrays included. A per-test
`accessibility: { disableRules: ['color-contrast'] }` does NOT union with the
file's `disableRules`; re-list everything the test needs. Whole-suite settings
(`shared`, browser `engineOptions`, `resembleOutputOptions`,
`compareRetries`/`compareRetryDelay`, perf/audit measurement tuning) have no
per-test override — set them once in `abtests.config.ts`.

## Removed capture-time options — write the test body instead

The old `options.visreg` interaction/readiness knobs are gone. Playwright
equivalents:

| Old option | Test body equivalent |
|---|---|
| `hideSelectors` | `await page.locator(sel).evaluateAll((els) => els.forEach((el) => { el.style.visibility = 'hidden'; }))` |
| `removeSelectors` | `await page.locator(sel).evaluateAll((els) => els.forEach((el) => el.remove()))` |
| `clickSelector(s)` / `hoverSelector(s)` | `await page.click(sel)` / `await page.hover(sel)` |
| `scrollToSelector` | `await page.locator(sel).scrollIntoViewIfNeeded()` |
| `readySelector` / `readyTimeout` | `await page.waitForSelector(sel, { timeout })` |
| `delay` / `postInteractionWait` | `await waitUntilPageSettled(page)` (preferred) or `await page.waitForTimeout(ms)` |

## Helpers (`shaka-perf/visreg/helpers`)

| Helper | What it does |
|--------|-------------|
| `waitUntilPageSettled(page)` | Waits for DOM mutations, network idle, fonts, images, and spinners to settle (30s timeout). Use instead of arbitrary delays. |
| `overrideCSS(page)` | Injects CSS to strip background images and freeze animations — reduces noise in visual diffs. |
| `interceptImages(page)` | Replaces all image requests with a stub — call before navigation for fully deterministic renders. |

`installRequestBlocking(context, patterns)` (import from `shaka-shared`) aborts
matching third-party requests — use it inside `beforeNavigate` for resources
that never resolve locally (analytics, reCAPTCHA) and would hang `networkidle`.

## `beforeNavigate` pattern

Runs before the page is created, on every engine — the place for setup that
must precede the first navigation: cookies, init scripts, request blocking.
It receives `{ context, url, viewport, isControl, testType }` (`context` is the
Playwright `BrowserContext`; there is no `page` yet). A per-test hook fully
REPLACES the global `shared.beforeNavigate` for that test — if you want both,
extract a shared function and call it from each.

```typescript
abTest('Feature flag test', {
  startingPath: '/checkout',
  beforeNavigate: async ({ context }) => {
    await context.addCookies([{ name: 'flag_new_checkout', value: '1', domain: 'localhost', path: '/' }]);
  },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
```
