# Move visreg/selector config into abTest() definitions

## Context

Currently visreg config lives in `visreg.json` with a `scenarios` array, while bench tests use `abTest()` in `.bench.ts` files. We want to unify these so that `abTest()` is the single source of truth for both perf benchmarking and visual regression testing. shaka-visreg remains the visreg runner — we're only changing how it receives input.

**Key decisions:**
- Extract ab-test registry to a shared package (both bench and visreg depend on it)
- `testFn` replaces `onReadyScript` in the visreg capture flow
- Global visreg settings (viewports, paths, engine options) stay in a separate slimmed-down config file
- Replace `visreg.json` entirely (no backwards compat)

---

## Step 1: Create shared ab-test registry package

Create `packages/shaka-shared/` with the ab-test registry that both shaka-bench and shaka-visreg will import.

### Files to create

- `packages/shaka-shared/package.json` — minimal package, exports the registry
- `packages/shaka-shared/tsconfig.json`
- `packages/shaka-shared/src/index.ts` — re-exports
- `packages/shaka-shared/src/ab-test-registry.ts` — moved from shaka-bench

### Type changes to `AbTestDefinition`

The abTest config should accept all `Scenario` properties (minus `url`, `referenceUrl`, `onReadyScript`, `label` which are derived). The new interface:

```ts
// In shaka-shared
export interface AbTestVisregConfig {
  // Selectors to capture (from Scenario)
  selectors?: string[];
  selectorExpansion?: boolean | string;
  hideSelectors?: string[];
  removeSelectors?: string[];

  // Interactions (from Scenario)
  hoverSelector?: string;
  hoverSelectors?: string[];
  clickSelector?: string;
  clickSelectors?: string[];
  scrollToSelector?: string;
  postInteractionWait?: number | string;

  // Comparison thresholds (from Scenario)
  misMatchThreshold?: number;
  requireSameDimensions?: boolean;
  maxNumDiffPixels?: number;
  compareRetries?: number;
  compareRetryDelay?: number;
  liveComparePixelmatchThreshold?: number;

  // Ready state (from Scenario)
  readyEvent?: string;
  readySelector?: string;
  readyTimeout?: number;
  delay?: number;

  // Cookies
  cookiePath?: string;

  // Scripts (onBeforeScript only — onReadyScript replaced by testFn)
  onBeforeScript?: string;

  // Viewport override
  viewports?: Viewport[];
}

export interface AbTestOptions {
  markers?: Marker[];
  lhConfigPath?: string;
  resultsFolder?: string;
  visreg?: AbTestVisregConfig;
}

export interface AbTestDefinition {
  name: string;
  startingPath: string;
  options: AbTestOptions;
  testFn: (context: { page: Page }) => Promise<void>;
}
```

### Files to modify

- `packages/shaka-bench/src/core/ab-test-registry.ts` — replace with re-export from shaka-shared
- `packages/shaka-bench/package.json` — add shaka-shared dependency
- `packages/shaka-bench/src/core/index.ts` — update imports

---

## Step 2: Create slimmed-down visreg config format

Replace `visreg.json` (which had scenarios + global config) with a config file that only has global settings. Scenarios come from `abTest()` registrations instead.

### New config file format (`visreg.config.ts`)

```ts
import { defineVisregConfig } from 'shaka-visreg';

export default defineVisregConfig({
  viewports: [
    { label: 'phone', width: 375, height: 667 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1280, height: 800 },
  ],
  // Global defaults (all optional)
  defaultMisMatchThreshold: 0.1,
  maxNumDiffPixels: 50,
  compareRetries: 5,
  compareRetryDelay: 1000,
  asyncCaptureLimit: 5,
  engineOptions: { browser: 'chromium', args: ['--no-sandbox'] },
  paths: { ... },
  // No scenarios array — those come from abTest()
});
```

### Files to create/modify

- `packages/shaka-visreg/core/types.ts` — add `VisregGlobalConfig` type (VisregConfig minus `scenarios`), add `defineVisregConfig` helper
- New export from shaka-visreg package for `defineVisregConfig`

---

## Step 3: Wire abTest registry into visreg liveCompare flow

The core change: `shaka-visreg liveCompare` accepts `--testFile` (like bench does), loads registered tests, converts each `AbTestDefinition` into a `Scenario`, and runs the existing comparison pipeline.

### Conversion: AbTestDefinition → Scenario

In a new helper (e.g. `packages/shaka-visreg/core/util/convertAbTestToScenario.ts`):

```ts
function convertAbTestToScenario(
  testDef: AbTestDefinition,
  controlURL: string,
  experimentURL: string
): Scenario {
  const visreg = testDef.options.visreg ?? {};
  return {
    label: testDef.name,
    url: experimentURL + testDef.startingPath,
    referenceUrl: controlURL + testDef.startingPath,
    selectors: visreg.selectors ?? ['document'],
    misMatchThreshold: visreg.misMatchThreshold,
    // ... spread all other visreg properties
    // onReadyScript is NOT set — testFn is used instead (see Step 4)
  };
}
```

### CLI changes

Update `shaka-visreg liveCompare` to accept:

- `--testFile <path>` — path to `.bench.ts` file (required, replaces `--config`)
- `--controlURL <url>` — control server URL (default: `http://localhost:3020`)
- `--experimentURL <url>` — experiment server URL (default: `http://localhost:3030`)
- `--config <path>` — path to global visreg config file (optional, for viewports/thresholds/etc.)

### Flow change in `createComparisonBitmaps.ts`

Instead of reading scenarios from `config.scenarios`, load test file → get registered tests → convert to scenarios:

```ts
// Before:
const scenarios = config.scenarios;

// After:
clearRegistry();
await loadTestFile(testFilePath);
const tests = getRegisteredTests();
const scenarios = tests.map(t => convertAbTestToScenario(t, controlURL, experimentURL));
```

### Files to modify

- `packages/shaka-visreg/core/command/liveCompare.ts` — accept new CLI flags
- `packages/shaka-visreg/core/util/createComparisonBitmaps.ts` — load tests from registry instead of config
- `packages/shaka-visreg/package.json` — add shaka-shared dependency

### Files to create

- `packages/shaka-visreg/core/util/convertAbTestToScenario.ts`

---

## Step 4: Replace onReadyScript with testFn in preparePage

This is the key behavioral change. When running visreg from abTest definitions, instead of loading an `onReadyScript` file, we call the test's `testFn` to get the page to the desired state before capturing screenshots.

### Approach

Attach `testFn` to the Scenario object (via a new property or a side-channel map). In `preparePage.ts`, where `onReadyScript` is currently loaded and executed, check if a `testFn` exists and call it instead:

```ts
// In preparePage.ts, replacing the onReadyScript block (~lines 150-159):
if (scenario._testFn) {
  // abTest flow: testFn replaces onReadyScript
  await scenario._testFn({ page });
} else if (onReadyScript) {
  // Legacy flow (if we ever need it)
  const readyFn = await importScript(readyScriptPath);
  await readyFn(page, scenario, viewport, isReference, browserOrContext, config);
}
```

### Special consideration: testFn runs on BOTH pages

`preparePage` is called twice per scenario (reference + test). The `testFn` will run on both the control and experiment pages, which is correct — both pages need to be in the same state for comparison.

### Files to modify

- `packages/shaka-visreg/core/util/preparePage.ts` — add testFn execution path
- `packages/shaka-visreg/core/types.ts` — add `_testFn?` to Scenario (internal, set at runtime)

---

## Step 5: Update demo-ecommerce test file

Update `shop-now.bench.ts` to include visreg config:

```ts
import { abTest } from 'shaka-shared';  // or re-exported from 'shaka-bench'

abTest('Click Shop Now on homepage', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['[data-cy="features-section"]'],
      misMatchThreshold: 0.1,
      maxNumDiffPixels: 5,
    },
  },
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="hero-section"]');
  await page.click('text=Shop Now');
  await page.waitForURL('**/products');
});
```

### Files to modify

- `demo-ecommerce/ab-tests/shop-now.bench.ts`
- Create `demo-ecommerce/visreg.config.ts` (global settings extracted from current `visreg.json`)
- Delete `demo-ecommerce/visreg.json`

---

## Step 6: Clean up old visreg.json support

Remove code paths that read scenarios from visreg.json. The `decorateConfigForCompare` function in `createComparisonBitmaps.ts` currently loads the JSON config and extracts scenarios — this needs to be refactored to separate global config loading from scenario sourcing.

### Files to modify

- `packages/shaka-visreg/core/util/createComparisonBitmaps.ts`
- `packages/shaka-visreg/core/util/makeConfig.ts`
- `packages/shaka-visreg/core/util/extendConfig.ts`

---

## Verification

1. `yarn build` — all packages compile
2. Start twin servers: `yarn shaka-twin-servers start-containers && yarn shaka-twin-servers start-servers`
3. Run visreg via new flow:
   ```bash
   yarn shaka-visreg liveCompare --testFile ./ab-tests/shop-now.bench.ts --config visreg.config.ts
   ```
4. Verify screenshots captured in results folder, diff images generated, report works
5. Run bench (unchanged):
   ```bash
   yarn shaka-bench compare --testFile ./ab-tests/shop-now.bench.ts --numberOfMeasurements 5
   ```
6. Update integration tests in `integration-tests/visreg.spec.ts` to use new CLI flags
