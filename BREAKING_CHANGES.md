# Breaking Changes

Every change that can break an existing consumer's `.abtest.ts` files or
`abtests.config.ts` is logged here, newest first. If you change the `abTest()`
per-test surface or the config schema in a way that makes a previously-valid
test or config stop working (a removed option, a renamed field, a moved
setting, a changed default), add an entry under **Unreleased** describing what
broke and exactly how to fix affected tests.

On publish, the `/deploy` skill renames the **Unreleased** section to the
version being released and updates the "Current version" line at the bottom.

---

## Unreleased

### AB-test options flattened; per-test overrides moved to `config`

The `abTest()` per-test surface changed. The old `options` object is gone:
test-identity and capture directives are now flat top-level fields, anything the
Playwright test body can already do is dropped (do it in the body), and every
remaining per-test override lives under a single `config` key that is a partial
of the same `abtests.config.ts` sections. `abtests.config.ts` itself is
unchanged (still `shared` / `visreg` / `perf` / `audit` / `accessibility` /
`twinServers` / `bisect`).

**Before → after:**

```ts
// BEFORE
abTest('Homepage', {
  startingPath: '/',
  options: {
    viewports: ['desktop'],
    visreg: {
      selectors: ['[data-cy="hero"]'],
      misMatchThreshold: 0.01,
      delay: 50,
      hideSelectors: ['.cookie-banner'],
    },
    accessibility: { disableRules: ['color-contrast'] },
  },
}, async ({ page }) => { /* ... */ });

// AFTER
abTest('Homepage', {
  startingPath: '/',
  visregSelectors: ['[data-cy="hero"]'],
  config: {
    visreg: { defaultMisMatchThreshold: 0.01, viewports: ['desktop'] },
    accessibility: { disableRules: ['color-contrast'] },
  },
}, async ({ page }) => {
  await page.locator('.cookie-banner')
    .evaluateAll((els) => els.forEach((el) => { el.style.visibility = 'hidden'; }));
  // `delay` is gone — wait for a real condition instead:
  await waitUntilPageSettled(page);
});
```

#### Removed — do it in the test body

These options duplicated things the Playwright `page` already does. They are
removed with no config equivalent; move the behaviour into the test body.

| Removed option | Fix in the test body |
|---|---|
| `hideSelectors` | `await page.locator(sel).evaluateAll((els) => els.forEach((el) => { el.style.visibility = 'hidden'; }))` |
| `removeSelectors` | `await page.locator(sel).evaluateAll((els) => els.forEach((el) => el.remove()))` |
| `hoverSelector` / `hoverSelectors` | `await page.hover(sel)` |
| `clickSelector` / `clickSelectors` | `await page.click(sel)` |
| `scrollToSelector` | `await page.locator(sel).scrollIntoViewIfNeeded()` |
| `postInteractionWait` | `await page.waitForTimeout(ms)` (number) or `await page.waitForSelector(sel)` (string) |
| `readyEvent` | `await page.waitForEvent('console', (m) => /event/.test(m.text()))` |
| `readySelector` | `await page.waitForSelector(sel)` |
| `readyTimeout` | pass the timeout to the body wait, e.g. `await page.waitForSelector(sel, { timeout })` |
| `delay` | `await page.waitForTimeout(ms)` — or better, `await waitUntilPageSettled(page)` |
| `accessibility.skip` | omit `'accessibility'` from `testTypes` |

#### Removed — no per-test override (set in the config file)

| Removed per-test option | Fix |
|---|---|
| `resultsFolder` | Removed entirely — the output dir is framework-derived. |
| `visreg.compareRetries` / `visreg.compareRetryDelay` | Set once in `abtests.config.ts` → `visreg.{compareRetries,compareRetryDelay}`. Best-of-N is a run-level loop; there is no per-test override. |

#### Renamed / relocated

Test-identity and capture fields move to the top level; every surviving
override moves under `config`, mirroring the `abtests.config.ts` section shape.

| Old (`options.…`) | New |
|---|---|
| `options.visreg.selectors` | top-level **`visregSelectors`** |
| `options.visreg.selectorExpansion` | top-level **`visregSelectorExpansion`** |
| `options.markers` | top-level **`markers`** |
| `options.beforeNavigate` | top-level **`beforeNavigate`** |
| `options.visreg.misMatchThreshold` | `config.visreg.defaultMisMatchThreshold` |
| `options.visreg.maxNumDiffPixels` | `config.visreg.maxNumDiffPixels` |
| `options.visreg.comparePixelmatchThreshold` | `config.visreg.comparePixelmatchThreshold` |
| `options.visreg.requireSameDimensions` | `config.visreg.requireSameDimensions` |
| `options.viewports` (one list, all categories) | per-category: `config.visreg.viewports`, `config.perf.viewports`, `config.audit.viewports`, `config.accessibility.viewports` |
| `options.accessibility.tags` | `config.accessibility.tags` |
| `options.accessibility.disableRules` | `config.accessibility.disableRules` |
| `options.accessibility.includeRules` | `config.accessibility.includeRules` |

The per-test `config` object exposes **only** the knobs the engines honour
per-test (the visreg comparison-tuning above, per-category `viewports`, and the
accessibility rule sets). Whole-suite settings — `shared`, browser
`engineOptions`, `resembleOutputOptions`, and perf/audit measurement tuning —
are not per-test; set them in `abtests.config.ts`.

#### Removed type exports

The types describing the old `options` object are gone from `shaka-shared` and
the `shaka-perf` barrels (root, `bench/core`, `bench/cli`):

| Removed type import | Fix |
|---|---|
| `AbTestOptions` | Use `AbTestConfig` (the flat `abTest()` config parameter). |
| `AbTestVisregConfig` | Per-test visreg tuning now lives on `PerTestConfig['visreg']`. |
| `AbTestAccessibilityConfig` | Per-test axe rule sets now live on `PerTestConfig['accessibility']`. |

`abTest()` also now **throws at load time** if its config still contains an
`options` key, so an un-migrated `.abtest.ts` fails loudly instead of silently
running with defaults.

#### Per-test `beforeNavigate` no longer receives the global to chain

A per-test `beforeNavigate` used to receive the global `shared.beforeNavigate`
as a **second argument** and decide whether to run it. That argument is gone: a
per-test hook now simply and fully **replaces** the global for that test. A hook
written as `async (ctx, runGlobal) => { await runGlobal(ctx); … }` breaks —
`runGlobal` is `undefined`.

Fix: if a test needs the global's setup too, extract it into a shared function
and call it yourself (DRY) — the framework no longer wires it in for you.

```ts
// shared.ts
export const blockRecaptcha = ({ context }) => installRequestBlocking(context, ['/recaptcha/']);

// abtests.config.ts
shared: { beforeNavigate: blockRecaptcha, /* … */ }

// a test that wants the global setup AND its own
abTest('Authed', {
  startingPath: '/dashboard',
  beforeNavigate: async (ctx) => {
    await blockRecaptcha(ctx);                 // was: await runGlobal(ctx)
    await ctx.context.addCookies([/* … */]);
  },
}, async ({ page }) => { /* … */ });
```

---

<!-- deploy: keep this line last; /deploy updates the version on publish -->
Current version: shaka-perf 0.1.6, shaka-shared 0.1.6 (breaking changes under
**Unreleased** ship in the next release).
