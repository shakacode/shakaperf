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

`abTest()`'s `options` object is gone. Test-identity and capture directives are
now flat top-level fields; anything the Playwright test body can already do is
dropped (do it in the body); every remaining per-test override lives under a
single `config` key — a partial of the same `abtests.config.ts` sections. The
config file keeps its sections; its one field change is the
`visreg.defaultMisMatchThreshold` rename (below). `abTest()` **throws at load
time** if a config still contains `options`, so an un-migrated `.abtest.ts`
fails loudly instead of silently running with defaults.

```ts
// BEFORE
abTest('Homepage', {
  startingPath: '/',
  options: {
    viewports: ['desktop'],
    visreg: { selectors: ['[data-cy="hero"]'], misMatchThreshold: 0.01, delay: 50, hideSelectors: ['.cookie-banner'] },
    accessibility: { disableRules: ['color-contrast'] },
  },
}, async ({ page }) => { /* ... */ });

// AFTER
abTest('Homepage', {
  startingPath: '/',
  visregSelectors: ['[data-cy="hero"]'],
  config: {
    visreg: { mismatchThreshold: 0.01, viewports: ['desktop'] },
    accessibility: { disableRules: ['color-contrast'] },
  },
}, async ({ page }) => {
  await page.locator('.cookie-banner').evaluateAll((els) => els.forEach((el) => { el.style.visibility = 'hidden'; }));
  await waitUntilPageSettled(page); // `delay` is gone — wait for a real condition
});
```

#### Removed — do it in the test body

These duplicated things the Playwright `page` already does. Removed with no
config equivalent; move the behaviour into the test body.

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

The `clickAndHoverHelper` export of `shaka-perf/visreg/helpers` is removed with
these fields — it is generally unrelated to shakaperf. Use the `page.*` calls above in the body
instead.

#### Removed — no per-test override (set in the config file)

| Removed per-test option | Fix |
|---|---|
| `resultsFolder` | Removed entirely — the output dir is framework-derived. |
| `visreg.compareRetries` / `visreg.compareRetryDelay` | Set once in `abtests.config.ts` → `visreg.{compareRetries,compareRetryDelay}`. Best-of-N is a run-level loop; no per-test override. |

#### Renamed / relocated

Test-identity and capture fields move to the top level; every surviving override
moves under `config`, mirroring the `abtests.config.ts` section shape.

| Old (`options.…`) | New |
|---|---|
| `options.visreg.selectors` | top-level **`visregSelectors`** |
| `options.visreg.selectorExpansion` | top-level **`visregSelectorExpansion`** — now strictly `boolean`; the legacy string form (`'true'`) is no longer accepted |
| `options.markers` | top-level **`markers`** |
| `options.beforeNavigate` | `config.shared.beforeNavigate` (see below) |
| `options.visreg.misMatchThreshold` | `config.visreg.mismatchThreshold` |
| `visreg.defaultMisMatchThreshold` (in `abtests.config.ts`) | `visreg.mismatchThreshold` — old key fails config parsing loudly |
| `options.visreg.maxNumDiffPixels` | `config.visreg.maxNumDiffPixels` |
| `options.visreg.comparePixelmatchThreshold` | `config.visreg.comparePixelmatchThreshold` |
| `options.visreg.requireSameDimensions` | `config.visreg.requireSameDimensions` |
| `options.viewports` (one list, all categories) | per-category: `config.visreg.viewports`, `config.perf.viewports`, `config.audit.viewports`, `config.accessibility.viewports` |
| `options.accessibility.tags` | `config.accessibility.tags` |
| `options.accessibility.disableRules` | `config.accessibility.disableRules` (see merge change below) |
| `options.accessibility.includeRules` | `config.accessibility.includeRules` |

`config` exposes **only** per-test-honoured knobs (visreg comparison tuning,
per-category `viewports`, accessibility rule sets). Whole-suite settings —
`shared`, browser `engineOptions`, `resembleOutputOptions`, perf/audit
measurement tuning — are not per-test; set them in `abtests.config.ts`.

#### Removed type exports

Gone from `shaka-shared` and the `shaka-perf` barrels (root, `bench/core`,
`bench/cli`):

| Removed type | Fix |
|---|---|
| `AbTestOptions` | Use `AbTestConfig` (the flat `abTest()` config parameter). |
| `AbTestVisregConfig` | Per-test visreg tuning now lives on `PerTestConfig['visreg']`. |
| `AbTestAccessibilityConfig` | Per-test axe rule sets now live on `PerTestConfig['accessibility']`. |

#### `beforeNavigate` moved to `config.shared.beforeNavigate`

`beforeNavigate` is no longer a special per-test field — it's just the
`shared.beforeNavigate` setting, overridden per-test through the same `config`
merge as everything else. Two changes: it moves from the top level onto
`config.shared.beforeNavigate`, and **it no longer chains**. It used to receive
the global hook as a second argument to optionally run; that argument is gone, so
a per-test hook now fully **replaces** the global. A hook written as
`async (ctx, runGlobal) => { await runGlobal(ctx); … }` breaks (`runGlobal` is
`undefined`) — if you need the global's setup, extract it into a shared function
and call it yourself.

```ts
// BEFORE
beforeNavigate: async (ctx, runGlobal) => { await runGlobal(ctx); await ctx.context.addCookies([/* … */]); },

// AFTER
import { blockRecaptcha } from './shared'; // the same fn used as shared.beforeNavigate
config: { shared: { beforeNavigate: async (ctx) => {
  await blockRecaptcha(ctx);               // DRY: call the shared setup yourself
  await ctx.context.addCookies([/* … */]);
} } },
```

#### Per-test `config` arrays now replace, not merge

Every per-test `config` override deep-merges over the file config, but a defined
**array replaces the file's wholesale** (no index- or set-merge). Two surfaces
change behaviour:

**Accessibility rule sets.** `config.accessibility.disableRules` used to be
**unioned** with the global list (global ∪ per-test); it now **replaces** it. A
test that set `disableRules: ['x']` to add one rule now disables *only* `x` and
re-enables everything the global disabled — repeat the global entries if you
still want them. (`tags` / `includeRules` already replaced; unchanged.)

**Per-test `viewports`** used to be an allow-list *intersected* with the
category's file list; it now replaces it, resolving labels against
`shared.viewports`:

- **Labels outside the file list now run.** With `visreg.viewports: ['desktop','phone']`
  in the file, a test's `config.visreg.viewports: ['tablet']` used to run at
  **zero** viewports (silently dropped — a bug); it now runs at tablet. Audit
  per-test lists you left in place because they did nothing will start taking effect.
- **`viewports: []` now means none, not all.** An explicit empty list replaces
  the file list with nothing (test skipped for that category, visible "viewport
  filter excluded all" outcome). For "all viewports", delete the key.
- **An unknown label now throws** instead of being silently dropped:
  `Unknown viewport label 'phome' — defined in shared.viewports: …`. Fix the
  label or add it to `shared.viewports`.

---

<!-- deploy: keep this line last; /deploy updates the version on publish -->
Current version: shaka-perf 0.1.6, shaka-shared 0.1.6 (breaking changes under
**Unreleased** ship in the next release).
