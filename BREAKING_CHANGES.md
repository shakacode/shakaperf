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

### `abtests.config.ts` is now REQUIRED for every command

`shaka-perf compare`, `shaka-perf audit` (and `compare bisect`, which always
required it) now fail up front when no `abtests.config.ts` resolves:
`No abtests.config.ts found — it is required. Run 'shaka-perf init' to create
one, or pass --config <path>.` Previously `audit --url …` could limp along on
an empty config (and would then fail on the now-required fields anyway, with a
less helpful error).

The same applies inside the engines: the perf Lighthouse fork and the visreg
bridge rebuild the effective config in their own process, and a config that
fails to **load or parse** there now **fails the unit** instead of printing a
yellow warning and running without your config. The old degrade-and-continue
path silently dropped `shared.beforeNavigate` — auth/cookie setup quietly
gone, both visreg sides screenshotting the same login wall and passing.

### `*_TALL_VIEWPORT` heights changed 9000 → 3000

`PHONE_TALL_VIEWPORT`, `TABLET_TALL_VIEWPORT`, and `DESKTOP_TALL_VIEWPORT`
(shaka-shared) are now 3000px tall instead of 9000px — 9000px captures were
extremely slow and heavy for little extra signal. If you use them in
`shared.viewports`:

- **Visreg baselines change dimensions**, and a dimension mismatch now always
  fails the compare — expect every `*-tall` unit to fail once; re-baseline.
- **Content between 3000px and 9000px is no longer captured.** If you added a
  tall viewport specifically for an element deeper than 3000px, define your own
  viewport instead of the constant, e.g.
  `{ label: 'phone-tall', width: 375, height: 9000, formFactor: 'mobile', deviceScaleFactor: 3 }`.

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

#### Renamed / relocated

Test-identity and capture fields move to the top level; every surviving override
moves under `config`, mirroring the `abtests.config.ts` section shape.

| Old (`options.…`) | New |
|---|---|
| `options.visreg.selectors` | top-level **`visregSelectors`** |
| `options.visreg.selectorExpansion` / `visregSelectorExpansion` | **removed** — just use `visregSelectors`, listing each element to capture |
| `options.markers` | top-level **`markers`** |
| `options.beforeNavigate` | `config.shared.beforeNavigate` (see below) |
| `options.visreg.misMatchThreshold` | `config.visreg.mismatchThreshold` |
| `visreg.defaultMisMatchThreshold` (in `abtests.config.ts`) | `visreg.mismatchThreshold` — old key fails config parsing loudly |
| `options.visreg.maxNumDiffPixels` | `config.visreg.maxNumDiffPixels` |
| `options.visreg.comparePixelmatchThreshold` | `config.visreg.comparePixelmatchThreshold` |
| `options.visreg.compareRetries` / `options.visreg.compareRetryDelay` | `config.visreg.{compareRetries,compareRetryDelay}` — honoured per-test (`--burn` still forces `compareRetries` to 0, like every other retry) |
| `options.visreg.requireSameDimensions` / `visreg.requireSameDimensions` (in `abtests.config.ts`) | **removed** — a dimension change always fails the compare now (a resize IS a visual difference). A leftover key fails config parsing loudly; delete it. There is no "tolerate resizes" mode — if you relied on `requireSameDimensions: false`, previously-tolerated resizes will start failing. |
| `options.viewports` (one list, all categories) | per-category: `config.visreg.viewports`, `config.perf.viewports`, `config.audit.viewports`, `config.accessibility.viewports` |
| `options.accessibility.tags` | `config.accessibility.tags` |
| `options.accessibility.disableRules` | `config.accessibility.disableRules` (see merge change below) |
| `options.accessibility.includeRules` | `config.accessibility.includeRules` |

The `config` **type** accepts every section except `twinServers`/`bisect`;
what the engines actually honour per-test:

| Per-test `config` knob | Honoured per-test? |
| --- | --- |
| `visreg` comparison tuning (`mismatchThreshold`, `maxNumDiffPixels`, `comparePixelmatchThreshold`, `resembleOutputOptions`, `compareRetries`, `compareRetryDelay`) | Yes (`--burn` still forces `compareRetries` to 0) |
| per-category `viewports` | Yes |
| `accessibility` rule sets + verdict (`tags`, `disableRules`, `includeRules`, `failOnViolation`) | Yes |
| `perf` measurement counts/thresholds (`numberOfMeasurements`, `regressionThreshold`, `pValueThreshold`, `regressionThresholdStat`) | Yes (warmup/low-noise stages keep their fixed 1-sample runs) |
| `audit.limitVideoFramesCount` | Yes |
| `shared.beforeNavigate` | Yes — replaces the global hook |
| `playwrightOptions` (`shared` / `visreg` / `perf`) | Yes on engines that launch per unit (visreg, perf, audit); accessibility/agent-readiness reuse a browser per worker slot and resolve once per run |
| `perf.lighthouseConfig` / `audit.lighthouseConfig` | Yes |
| run-level pool/infra fields (`shared.parallelism`, `retries`, `timeoutMs`, `perf.samplingMode`, …) | No — resolve once per run; set them in `abtests.config.ts` |

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
merge as everything else. `abTest()` **throws at load time** on a top-level
`beforeNavigate` (like it does for `options`), because a stale hook would
otherwise be silently ignored — auth/cookie setup quietly gone while the
suite stays green. Two changes: it moves from the top level onto
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
  the file list with nothing — the test is skipped for that category with a
  visible `skipped: test's <category>.viewports override is []` outcome. For
  "all viewports", delete the key.
- **An unknown label now throws** instead of being silently dropped:
  `Unknown viewport label 'phome' — defined in shared.viewports: …`. Fix the
  label or add it to `shared.viewports`.

### `engineOptions` → `shared.playwrightOptions`, required, respected by every stage

Browser-launch options are now ONE setting with ONE shape, on
`shared.playwrightOptions`, and every stage respects it — visreg, perf
(Lighthouse), audit, agent-readiness, and accessibility. `visreg.playwrightOptions`
and `perf.playwrightOptions` may override it per-category (a partial of the same
shape, merged per-key over shared). The old keys fail config parsing loudly:

| Old | New |
|---|---|
| `visreg.engineOptions` | `shared.playwrightOptions` — or `visreg.playwrightOptions` for a visreg-only override |
| `accessibility.engineOptions` | `shared.playwrightOptions` (accessibility has no category override) |

```ts
// BEFORE
visreg: { engineOptions: { browser: 'chromium', args: ['--no-sandbox'] } },
accessibility: { engineOptions: { browser: 'chromium', args: ['--no-sandbox'] } },

// AFTER
shared: { playwrightOptions: { browser: 'chromium', args: ['--no-sandbox'] } },
```

**`shared.playwrightOptions` is REQUIRED, with an explicit `browser`.** There
are no hidden launch defaults anymore — the old engines' implicit
`{ browser: 'chromium', args: ['--no-sandbox'] }` is gone; what the config says
is what every stage launches with. A config without the block now fails parsing
(`shared.playwrightOptions: Required`); add the line from the starter template:

```ts
shared: { playwrightOptions: { browser: 'chromium', args: ['--no-sandbox'], waitTimeout: 60_000 } },
```

**`waitTimeout` is respected by every Playwright engine, identically.** It
used to be three different things: visreg's navigation timeout (fallback 60s),
accessibility's default+navigation timeout (fallback 30s), and ignored by
agent-readiness (hardcoded 45s). Now it is the default action + navigation
timeout on every Playwright engine (visreg, accessibility, agent-readiness),
with ONE default — 60_000 ms — instead of per-engine fallback constants.
Accessibility scans that relied on the implicit 30s and agent-readiness scans
on the hardcoded 45s now wait up to 60s unless you set `waitTimeout`. It
deliberately does not affect the perf/audit Lighthouse engine: LH's page-load
wait is a different concern, configured via `lighthouseConfig.maxWaitForLoad`
as before.

**`ignoreHTTPSErrors` is respected by EVERY engine, identically.** Previously
only visreg honoured it (context option, default true); accessibility and
agent-readiness dropped it (it was passed to `launch()`, which ignores it) and
always enforced strict certs; Lighthouse always passed
`--ignore-certificate-errors` regardless. Now every engine defaults to lax
(self-signed twin-server certs work everywhere, including accessibility and
agent-readiness, which previously failed on them) and `ignoreHTTPSErrors:
false` makes every engine — Lighthouse included — enforce strict certificate
checking.

Because `args` now reach every stage, the perf/audit **Lighthouse Chrome also
launches with your configured `args`** (e.g. the template's `--no-sandbox`),
which the old worker never applied — absolute audit numbers can shift
accordingly.

**`accessibility.playwrightOptions` / `audit.playwrightOptions` fail loudly.**
Those sections have no category override (they resolve `shared.playwrightOptions`
once per run); the key used to be silently stripped, now config parsing rejects
it with a pointer to `shared.playwrightOptions`.

Notes:

- The `SHAKA_PERF_CHROME_ARGS` / `SHAKA_PERF_HEADED` env vars are **removed**.
  They briefly carried the resolved launch options into the forked Lighthouse
  worker; that now travels over the worker's `setup` IPC message, so setting
  either env var by hand has no effect. Extra Chrome flags belong in
  `shared.playwrightOptions.args` (or `perf.playwrightOptions.args`); headed
  runs use `--headed` or `playwrightOptions.headless: false`.
- The perf/audit Lighthouse engine is chromium-only: it maps `args` and
  `headless` onto its Chrome flags and warns-and-ignores a non-chromium
  `browser`.
- Per-test overrides now reach the engines: `config.visreg.playwrightOptions`
  (or `config.shared.playwrightOptions`, or `config.perf.playwrightOptions`)
  in an `abTest()` applies to that test's launches on engines that launch per
  unit (visreg, perf, audit). Accessibility and agent-readiness reuse one
  browser per worker slot, so they resolve launch options once per run.
- Type export rename: `EngineOptionsInput` / `AccessibilityEngineOptionsInput`
  (shaka-shared) are replaced by `PlaywrightOptionsInput`; the visreg engine's
  `EngineOptions` type (`shaka-perf/visreg/core/types`) is now
  `EnginePlaywrightOptions` (named to stay distinct from the config-level
  `PlaywrightOptions` in `shaka-perf/src/config`).

---

<!-- deploy: keep this line last; /deploy updates the version on publish -->
Current version: shaka-perf 0.1.6, shaka-shared 0.1.6 (breaking changes under
**Unreleased** ship in the next release).
