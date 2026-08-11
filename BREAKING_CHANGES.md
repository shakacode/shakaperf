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

### `SHAKA_PERF_NODE` removed, and the CLI no longer pins a Node version

`npm install -g shaka-perf` used to record the installing Node binary (a
`postinstall` hook wrote it to `bin/.node-path`) and re-exec the CLI under it,
with `SHAKA_PERF_NODE` as a manual override. Both are gone — the CLI now runs
under whatever `node` is first on PATH.

This only affects global installs alongside a version manager. If a project
pins a Node older than shaka-perf's `engines` (`>=20.6.0`), the CLI now fails
there instead of silently re-execing under the Node it was installed with.

```bash
# BEFORE — ran under the install-time Node whatever the project pinned
cd project-pinned-to-node-18 && shaka-perf audit --url https://example.com/
```
```bash
# AFTER — select a supported Node in the shell that runs shaka-perf
nvm use 22 && shaka-perf audit --url https://example.com/
```

### `playwrightOptions.headless` is no longer accepted

Browser visibility is owned by the framework and comes from `--headed` alone, so
`headless` is now rejected in `shared`/`visreg`/`perf` `playwrightOptions` (and
in a test's own `config` overrides of those). A config that sets it fails at load.

```ts
// before
playwrightOptions: { browser: 'chromium', headless: false },
// after
playwrightOptions: { browser: 'chromium' },
```
```bash
shaka-perf compare --headed        # what `headless: false` used to do
```

Two things to know beyond the edit:

- **It's a workflow change.** If `headless: false` was your local default, you
  now pass `--headed` on *every* invocation rather than once in the file.
- **Per-category visibility is gone.** `visreg` and `perf` could previously
  disagree; `--headed` now applies to the whole run.

Runs are still headless by default. This exists so a committed config can no
longer silently beat what the command line asked for.

### Uncaught page errors now fail a test

An uncaught exception in the page now fails that test, on either side. It never
reaches `console`, so it was previously invisible — a `beforeNavigate` init
script could throw and the run stayed green with wrong screenshots.

Gated by the existing `shared.browserConsole` knobs, so no config change is
required to opt out:

```ts
shared: {
  browserConsole: {
    failOn: ['error', 'warn'], // remove 'error' (or use []) to ignore page errors
    allowList: ['ResizeObserver loop'], // or silence one by substring
  },
},
```

### `SHAKA_BENCH_ALLOWED_CONSOLE_ERRORS` removed (Replaced by `browserConsole.allowList`)
### Browser console errors and warnings now fail a test

A `console.error` / `console.warn` from the page under test now fails that test,
on either side. Previously visreg ignored console output entirely and perf only
printed it in red. On by default, so pages that log warnings will start failing.

`shared.browserConsole` is REQUIRED, and so are both of its fields, so every
config must be updated — a missing section fails with


```bash
# BEFORE
SHAKA_BENCH_ALLOWED_CONSOLE_ERRORS='Failed to load resource,favicon' shaka-perf compare
```
```ts
// AFTER — in abtests.config.ts
shared: {
  browserConsole: { 
    failOn: ['error', 'warn'], 
    allowList: ['Failed to load resource', 'favicon'],
  },
},
```

Entries are no longer matched against a `JSON.stringify` of the whole message
record, so a value that used to match the level (e.g. `"error"`) now silences
nothing.

---

## 0.2.0 — 2026-07-28

### Existing result artifacts must be removed

The persisted stage-measurement and report-artifact schema has changed.
Artifacts written by older shaka-perf versions are not supported by
`--report-only` or `--keep-old-results`. Remove the existing `test-results`
directory (or your configured results directory) and run the measurements
again before generating reports with this version.


### `shared.viewports` renamed to `shared.viewportDefinitions`; `shared.viewports` is now the default label list
`shared.viewports` used to hold the full viewport **definitions**. It is now
`shared.viewportDefinitions`, and the freed-up `shared.viewports` becomes a list
of **labels** — the viewports every category runs at unless it sets its own.

```ts
// BEFORE
shared: {
  viewports: [DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT],
},
visreg: { viewports: ['desktop', 'tablet', 'phone'] },
perf:   { viewports: ['desktop', 'phone'] },
audit:  { viewports: ['desktop', 'phone'] },

// AFTER
shared: {
  viewportDefinitions: [DESKTOP_VIEWPORT, TABLET_VIEWPORT, PHONE_VIEWPORT],  // the registry
  viewports: ['desktop', 'phone'],                                           // what actually runs
},
visreg: { viewports: ['desktop', 'tablet', 'phone'] },  // keep: visreg wants the extra breakpoint
perf:   { },                                            // drop: inherits shared.viewports
audit:  { },                                            // drop: inherits shared.viewports
```

**The config is `.strict()`, so leaving `shared.viewports` holding definitions
fails loudly** — `Expected string, received object` at `shared.viewports.0`.
Rename the key; you don't have to add the new `shared.viewports` unless you want
something other than the desktop + phone default.

**Watch the visreg default.** Every category now shares ONE default,
`['desktop', 'phone']`. visreg's old built-in default was `['desktop',
'tablet', 'phone']`, so **a config that never set `visreg.viewports` silently
stops running tablet** — those baselines just disappear from the run rather
than failing. To keep them, set it explicitly (as the two examples above and
`shaka-perf init`'s template now do), or put `tablet` in `shared.viewports` and
accept it for perf/audit/accessibility too. perf, audit, and accessibility
already defaulted to desktop + phone and are unaffected.

Precedence, most specific first — the per-test level is new:

```
config.<category>.viewports   (per-test)
<category>.viewports          (file)
config.shared.viewports       (per-test)
shared.viewports              (file)
```

So `config: { shared: { viewports: ['phone'] } }` on a single test makes that
test phone-only across visreg, perf, audit, and accessibility at once — except
for any category the FILE config pinned itself, which stays more specific. This
replaces the whole-test `options.viewports` removed in the flat-`config`
migration below.

`shared.viewportDefinitions` is only a registry: every label used anywhere must
resolve to an entry in it, and an unknown one is rejected at parse time with
`unknown viewport label "…" — define it in shared.viewportDefinitions or drop it
here`. Defining a viewport does not run it.

If your registry does NOT define both `desktop` and `phone` (you renamed the
canonical viewports, or listed only one), that same error now fires on
`shared.viewports` because its default names both — set `shared.viewports` to
your own labels. Previously the equivalent error came from each category's
default list, so this is one fix instead of four.

### Agent-readiness is now OFF by default (opt in with `agentReadiness.enabled`)

The `agent-readiness` stage (the AI-legibility scan behind the client report's
"Agent Ready" tab) used to run for every page of every `shaka-perf audit`. It is
now **off by default** and gated by a new config option:

```ts
// abtests.config.ts — new section (defaults to { enabled: false })
agentReadiness: { enabled: true },   // enable for EVERY test (rarely what you want)
```

**Recommended: enable it per-test**, on the specific landing pages where a
crawler's-eye view actually matters — because agent-readiness measures each URL
*anonymously* (no cookies, no auth, and it never runs your test body), so it only
ever scores a test's `startingPath` as a cold, non-rendering/rendering crawler
would see it. Turning it on for interaction/authed tests just scores their
landing URL cold, which is rarely useful:

```ts
abTest('Homepage', {
  startingPath: '/',
  config: { agentReadiness: { enabled: true } },   // opt THIS page in
}, async ({ page }) => { /* ... */ });
```

If you relied on the old always-on behaviour, add `agentReadiness: { enabled:
true }` to `abtests.config.ts` to restore it for all tests. With nothing enabled,
no `agent-readiness.json` is written and the client report simply omits the
"Agent Ready" tab (byte-identical to a run without agent data).

The reason is pipeline performance. shaka-perf is playwright first, so a lot of 
tests start from the same path and lead to duplication. Before the change it could 
be disabled with skip: true, however such setting leads to clutter in test definitions. 

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
extremely slow and heavy for little extra signal. If you include them in
`shared.viewportDefinitions` and select their labels in `shared.viewports` or a
category's `viewports`:

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

#### Removed — use Playwright directly

These duplicated things Playwright already does. Most move directly into the
test body. `readyEvent` is the exception: arm its listener from
`config.shared.beforeNavigate` so an event emitted during initial navigation
cannot be missed, then await it in the test body.

| Removed option | Fix in the test body |
|---|---|
| `hideSelectors` | `await page.locator(sel).evaluateAll((els) => els.forEach((el) => { el.style.visibility = 'hidden'; }))` |
| `removeSelectors` | `await page.locator(sel).evaluateAll((els) => els.forEach((el) => el.remove()))` |
| `hoverSelector` / `hoverSelectors` | `await page.hover(sel)` |
| `clickSelector` / `clickSelectors` | `await page.click(sel)` |
| `scrollToSelector` | `await page.locator(sel).scrollIntoViewIfNeeded()` |
| `postInteractionWait` | `await page.waitForTimeout(ms)` (number) or `await page.waitForSelector(sel)` (string) |
| `readyEvent` | Arm a context `console` listener in per-test `config.shared.beforeNavigate`, then await it in the body. |
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
`shared.viewportDefinitions`:

- **Labels outside the file list now run.** With `visreg.viewports: ['desktop','phone']`
  in the file, a test's `config.visreg.viewports: ['tablet']` used to run at
  **zero** viewports (silently dropped — a bug); it now runs at tablet. Audit
  per-test lists you left in place because they did nothing will start taking effect.
- **Empty viewport lists are invalid.** Each configured category must name at
  least one viewport. To skip a category for one test, omit it from that test's
  `testTypes`; for all configured viewports, delete the per-test `viewports`
  key.
- **An unknown label now throws** instead of being silently dropped:
  `Unknown viewport label 'phome' — defined in shared.viewportDefinitions: …`.
  Fix the label or add its full definition to `shared.viewportDefinitions`.

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
Current version: shaka-perf 0.2.3, shaka-shared 0.2.1 (breaking changes under
**Unreleased** ship in the next release).
