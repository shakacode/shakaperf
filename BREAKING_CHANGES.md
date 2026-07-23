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
of the same `abtests.config.ts` sections. `abtests.config.ts` keeps its
sections (`shared` / `visreg` / `perf` / `audit` / `accessibility` /
`twinServers` / `bisect`); its one field change is the
`visreg.defaultMisMatchThreshold` rename in the table below.

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
    visreg: { mismatchThreshold: 0.01, viewports: ['desktop'] },
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

The `clickAndHoverHelper` export of `shaka-perf/visreg/helpers` is removed with
the options above — it only executed those deleted scenario fields. Use the
Playwright calls from the table (`page.click` / `page.hover` / …) in the test
body instead. The other helpers (`waitUntilPageSettled`, `interceptImages`,
`overrideCSS`, …) are unchanged.

#### Renamed / relocated

Test-identity and capture fields move to the top level; every surviving
override moves under `config`, mirroring the `abtests.config.ts` section shape.

| Old (`options.…`) | New |
|---|---|
| `options.visreg.selectors` | top-level **`visregSelectors`** |
| `options.visreg.selectorExpansion` | top-level **`visregSelectorExpansion`** |
| `options.markers` | top-level **`markers`** |
| `options.beforeNavigate` | `config.shared.beforeNavigate` (see below) |
| `options.visreg.misMatchThreshold` | `config.visreg.mismatchThreshold` |
| `visreg.defaultMisMatchThreshold` (in `abtests.config.ts`) | `visreg.mismatchThreshold` — old key fails config parsing loudly |
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

#### Per-test `beforeNavigate` moved to `config.shared.beforeNavigate`

`beforeNavigate` is no longer a special per-test field. It is just the
`shared.beforeNavigate` setting, overridden per-test through the same
`config` merge as every other setting. Two things changed:

1. **Location.** A test's own hook moves from the top level onto
   `config.shared.beforeNavigate`.
2. **No chaining.** It used to receive the global hook as a **second argument**
   to optionally run; that argument is gone. A per-test hook now fully
   **replaces** the global for that test (the same replace-merge every `config`
   override uses). A hook written as
   `async (ctx, runGlobal) => { await runGlobal(ctx); … }` breaks — `runGlobal`
   is `undefined`. If a test needs the global's setup too, extract it into a
   shared function and call it yourself (DRY).

```ts
// BEFORE
abTest('Authed', {
  startingPath: '/dashboard',
  beforeNavigate: async (ctx, runGlobal) => {
    await runGlobal(ctx);
    await ctx.context.addCookies([/* … */]);
  },
}, async ({ page }) => { /* … */ });

// AFTER
import { blockRecaptcha } from './shared';   // the same fn used as shared.beforeNavigate
abTest('Authed', {
  startingPath: '/dashboard',
  config: {
    shared: {
      beforeNavigate: async (ctx) => {
        await blockRecaptcha(ctx);            // DRY: call the shared setup yourself
        await ctx.context.addCookies([/* … */]);
      },
    },
  },
}, async ({ page }) => { /* … */ });
```

#### Per-test `viewports` now replaces instead of narrowing (bug fix)

A per-test `config.<category>.viewports` used to be an allow-list *intersected*
with the category's file list. It now goes through the same replace-merge as
every other `config` override: a defined list **replaces** the file list
wholesale, and its labels resolve against the `shared.viewports` definitions.
Two behaviours flip:

1. **Labels outside the category's file list now run.** Before, a per-test
   label the category config didn't include was silently dropped — a bug: the
   override looked like it took effect but didn't. E.g. with
   `visreg: { viewports: ['desktop', 'phone'] }` in the file, a test's
   `config: { visreg: { viewports: ['tablet'] } }` used to run at **zero**
   viewports; it now actually runs at tablet (any label defined in
   `shared.viewports` works). Audit per-test lists you may have "safely"
   left in place because they did nothing will start taking effect.
2. **`viewports: []` now means none, not all.** An explicit empty list used to
   be treated as "no narrowing" (run every category viewport). It now replaces
   the file list with nothing: the test is skipped for that category, with a
   visible "viewport filter excluded all" outcome in the report. If you meant
   "all viewports", delete the key.
3. **A label with no `shared.viewports` definition now throws.** A typo'd
   per-test label (e.g. `'phome'`) used to be silently dropped; it now fails
   the run with `Unknown viewport label 'phome' — defined in shared.viewports:
   …`. Fix the label or add the definition to `shared.viewports`.

---

<!-- deploy: keep this line last; /deploy updates the version on publish -->
Current version: shaka-perf 0.1.6, shaka-shared 0.1.6 (breaking changes under
**Unreleased** ship in the next release).
