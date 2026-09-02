# Writing Good AB Tests

Canonical list of test code rules. Both `discover-abtests` (when writing new tests) and this skill (when grading existing tests) read from this file.

A visreg test exists to **fail loudly** when the UI changes. Control flow that hides "the element wasn't there" or "the action didn't happen" defeats the whole point — a green test that silently did nothing is worse than no test. So:

1. **No error swallowing.** Never wrap an action in `try/catch` to keep going, and never `.catch(() => {})` a promise. A failed click, fill, or wait *is* the finding — let it throw so the report shows "Failed while \<annotation\>". "It might not be there" is a reason to assert it (rule 3), not to guard it.

2. **No loops.** No `for` / `while` / `forEach` / `for await` in a test body. Steps stay explicit and linear, so a failure points at one action and the run is reproducible.
   - Don't loop to "click through" N items — that's N separate tests, or one snapshot of the container. Split it.
   - Never write a `while (!atBottom)` scroll loop — it hangs in this harness (`window.scrollY` doesn't update in the Playwright context). Use `scrollIntoViewIfNeeded()` on a known bottom element (see the lazy-load pattern in `discover-abtests/references/patterns.md`).

3. **No `if` — assert the expectation instead.** Don't branch on page state (`if (await locator.isVisible())`, `if (await locator.count())`, `if (el) …`). A branch means the test quietly takes the "do nothing" path *exactly when* the thing you're testing has regressed. State what you expect and let Playwright's auto-waiting throw when it's wrong — these are your assertions:
   - `await page.waitForSelector(sel, { state: 'visible' })` — the element must appear.
   - `await page.waitForURL('**/path')` — navigation must happen.
   - Need different behaviour per viewport? Don't branch on `viewport.label` — write a separate `abTest` scoped to that viewport via `config: { visreg: { viewports: [...] } }` (see "Viewport-conditional selectors" in `patterns.md`). Each test stays linear.

4. **Wait for conditions, not the clock.** Use `waitUntilPageSettled(page)` and `waitForSelector(sel, { state })` to wait. `page.waitForTimeout(ms)` is a guess — flaky when short, slow when long. A short fixed delay (≤500ms) is acceptable *only* to let a confirmed animation/transition finish where there's no event to wait on, never to "hope" content loads.

5. **Prefer user-facing locators.** `getByRole`, `getByLabel`, `getByText` express intent and survive refactors better than brittle CSS/XPath; fall back to a stable selector (`[data-cy=…]`, a semantic class) when there's no accessible handle. (Section *captures* still use CSS selectors — see Selectors strategy in `patterns.md`.)

6. **Deterministic inputs *and* content.** Fill fixed values — a fixed date, name, count — never `Date.now()`, randomness, or "today". When the *page itself* renders nondeterministic content (timestamps, "2 minutes ago", live counters, randomized ordering, today's date, ads), **alter the page to force it deterministic** rather than raising `config.visreg.mismatchThreshold` to hide it — a raised threshold isn't determinism, it just blinds the test to real diffs. In order of preference:
   - **Freeze it at the source** in `beforeNavigate`, before the page loads, so it renders identically every run and on both sides:
     ```typescript
     beforeNavigate: async ({ context }) => {
       await context.addInitScript(() => {
         const FIXED = new Date('2026-01-01T00:00:00Z').getTime();
         Date.now = () => FIXED;            // also stub the Date constructor if the app uses `new Date()`
         Math.random = () => 0.42;          // pin shuffles / randomized order
       });
     },
     ```
   - **Overwrite the rendered text** in `testFn` before capture (it runs before the screenshot). Annotate it, and don't guard it — if the element is gone, let it throw:
     ```typescript
     annotate('pinning the relative timestamp');
     await page.locator('.posted-at').evaluate((el) => { el.textContent = 'Jan 1, 2026'; });
     ```
   - **Drop it from the capture** in the test body when the dynamic element isn't what this test is about (e.g. an ad slot inside a section you're snapshotting): `await page.locator('.ad-slot').evaluateAll((els) => els.forEach((el) => el.remove()))`.
   - **Stub images** with `interceptImages(page)` (call before `page.goto`) and freeze animations/background images with `overrideCSS(page)`.

7. **Each test stands alone.** It starts from its `startingPath` and assumes nothing from any other test — no shared state, no ordering. One behaviour (one section, one interaction) per `abTest`, so a failure pinpoints what broke.

And keep annotating: an `annotate(...)` immediately before each user action is what turns a thrown assertion into a readable "Failed while \<doing X\>".


## What to do when the component you want to capture is below the viewport? Avoid scrolling.

1. Script an interaction only when the interaction *is* the test. On a virtualized page this is not a style preference: as sections mount, estimated heights are replaced by measured ones and `scrollHeight` moves under you (18,669 → 8,940 px on a real menu page), so fraction-based scrolling overshoots and unmounts everything you meant to assert on.
2. Use 'desktop-tall', 'phone-tall', 'tablet-tall' viewports.
3. Set display:none to elements above the desired component.

### BAD — scroll to compensate for a shrinking page

```typescript
for (let step = 1; step <= 8; step += 1) {
  await page.evaluate((f) => window.scrollTo(0, document.documentElement.scrollHeight * f), step / 8);
  await page.waitForTimeout(200);
}
await page.waitForSelector('.dish-card', { state: 'visible' }); // page has scrolled past every card
```

### GOOD — measure at a tall viewport and hide unwanted chrome before first paint

```typescript
import { hideBeforeFirstPaint } from 'shaka-shared';

const TALL = ['desktop-tall', 'phone-tall', 'tablet-tall'] satisfies [string, ...string[]];
const MENU_CHROME = '#navbar, #page-header';

abTest(
  'Menu page',
  {
    startingPath: '/menus/dinner-menu',
    testTypes: ['perf', 'visreg', 'accessibility'],
    visregSelectors: ['viewport'],
    config: {
      accessibility: { viewports: TALL },
      audit: { viewports: TALL },
      perf: { viewports: TALL },
      shared: {
        // Per-test beforeNavigate replaces the global hook, so compose both.
        beforeNavigate: async (ctx) => {
          await applyGlobalBeforeNavigate(ctx);
          await hideBeforeFirstPaint(ctx.context, MENU_CHROME);
        },
      },
      visreg: { viewports: TALL },
    },
  },
  async ({ page }) => {
    await waitUntilPageSettled(page);
    await page.waitForSelector('.dish-card', { state: 'visible' });
  },
);
```

## Keep perf and audit viewports a subset of the visreg ones

Visreg is cheap, so it can cover more viewports than perf and audit. What those
must never do is cover *different* ones. If `visreg` runs `desktop-tall` and
`perf` runs `desktop`, perf measures a rendering no screenshot ever captured —
it never sees the content below the fold that visreg is diffing, so a perf
number has no visual evidence to explain it. The same goes for `audit`. Every
perf and audit viewport must also be a visreg viewport.

### BAD — perf and audit measure viewports visreg never captures

```typescript
config: {
  visreg: { viewports: ['desktop-tall', 'phone-tall'] },
  perf: { viewports: ['desktop'] },
  audit: { viewports: ['phone'] },
}
```

### GOOD — perf and audit narrow the visreg list, reusing the same sizes

```typescript
const VISREG = ['desktop-tall', 'tablet-tall', 'phone-tall'] satisfies [string, ...string[]];
const MEASURED = ['desktop-tall', 'phone-tall'] satisfies [string, ...string[]];

config: {
  visreg: { viewports: VISREG },
  perf: { viewports: MEASURED },
  audit: { viewports: MEASURED },
}
```

## Wait for a durable final state, not the first success signal

Modern UIs can expose a component before its content and geometry have finished updating. Wait for both the meaningful state and the specific component's rendered size to settle.

### BAD — capture as soon as one expected element appears

```typescript
await page.getByRole('button', { name: 'Add to order' }).click();
await page.getByRole('dialog', { name: 'My Cart' }).waitFor({ state: 'visible' });
// The drawer can be visible while its line item and totals are still changing its height.
```

### GOOD — wait until page is reliably settled

```typescript
await page.getByRole('button', { name: 'Add to order' }).click();
const cart = page.getByRole('dialog', { name: 'My Cart' });
await cart.getByText('Curly Fries', { exact: true }).waitFor({ state: 'visible' });
await page.waitForFunction(
  () => !document.querySelector('[role="progressbar"], .MuiCircularProgress-root'),
);
await waitForStableElementSize(cart);
```

## Settle one mutation before starting a dependent mutation

Two clicks being sequential in Playwright does not mean their server mutations are sequential. If the second action depends on the first write, wait for the first state transition to finish.

### BAD — remove an item while its add mutation is still in flight

```typescript
await page.getByRole('button', { name: 'Add to order' }).click();
await openCartDrawer(page);
await page.getByRole('button', { name: 'Remove Curly Fries' }).click();
```

### GOOD — establish the precondition, act, and verify the result

```typescript
await page.getByRole('button', { name: 'Add to order' }).click();
await openCartDrawer(page);
await waitUntilPageSettled(page);

await page.getByRole('button', { name: 'Remove Curly Fries' }).click();
await page.getByRole('heading', { name: 'Your cart is empty' }).waitFor({ state: 'visible' });
```

This is causal waiting, not defensive waiting: the remove request is invalid until the add request has committed.

## Never alter the database; intercept writes

A/B tests may read seeded data, but they must not create, update, or delete persistent database state. Any example in this guide that triggers a writing interaction assumes its request is intercepted. Cleanup afterward is not sufficient: the other twin, a retry, or a later test can observe the intermediate write.
The reason is parallelism and retries. AB tests are reusing the same twin-servers setup and so they should not create any side effects for next reruns.
Want to test business logic involving DB mutations? Probably, shakaperf is the wrong tool for that. You can of course setup DB reseeding in `beforeNavigate` and limit parallelism to 1, but that's not a recommended usage as statistically rigorous perf-tests will take ages and ages.

### BAD — let an interaction reach a real write mutation

```typescript
abTest('Like a dish', {
  startingPath: '/menus/dinner-menu',
}, async ({ page }) => {
  await page.getByRole('button', { name: 'Like this Dish' }).click(); // Alters the DB.
});
```

### GOOD — intercept only the write and return deterministic state

```typescript
async function stubLikeMutation(context: BrowserContext): Promise<void> {
  await context.route('**/graphql', async (route) => {
    if (!route.request().postData()?.includes('updateMenuItemPop')) {
      await route.continue();
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        data: {
          updateMenuItemPop: {
            __typename: 'Pop',
            dishableId: 123,
            dishableType: 'Dish',
            id: 'stub:123:loved_it',
            popType: 'loved_it',
          },
        },
      }),
      contentType: 'application/json',
    });
  });
}

abTest('Like a dish', {
  startingPath: '/menus/dinner-menu',
  config: {
    shared: {
      beforeNavigate: async (ctx) => {
        await applyGlobalBeforeNavigate(ctx);
        await stubLikeMutation(ctx.context);
      },
    },
  },
}, async ({ page }) => {
  await page.getByRole('button', { name: 'Like this Dish' }).click();
});
```

Keep stubs narrow: continue unmatched GraphQL operations and return the complete response shape the UI reads. Use the same interception pattern for nondeterministic third-party APIs such as geocoders, which can rank results differently or time out. For merely blocking resources in perf runs, prefer `installRequestBlocking(context, patterns)`; general Playwright routing disables Chromium's HTTP cache and can distort the measurement.

## Do not hand-roll counters for what the run already records

The trace behind every perf run already carries each network request as a span,
and same-origin `/graphql` POSTs are keyed by their `operationName`. A repeated
request is therefore visible as repeated bars on one side of the timeline strip.
Counting the same requests yourself adds a listener that can only agree with the
trace, and asserting on the count turns a measurement into a pass/fail gate that
hides the numbers when it trips. Reproduce the condition and let the comparison
report it.

### BAD — count requests in the test and throw

```typescript
abTest('Autonavigate', { startingPath: '/order?location=main', testTypes: ['perf'] },
  async ({ browserContext, page }) => {
    const updates = cartUpdateMutationCount(browserContext); // duplicates the trace
    if (updates > 2) throw new Error(`sent ${updates} cart updates`);
  });
```

### GOOD — drive the page to the state and let the trace show the requests

```typescript
abTest('Autonavigate', { startingPath: '/order?location=main', testTypes: ['perf'] },
  async ({ page }) => {
    await page.waitForURL('**/order/main/menus/**');
    await waitUntilPageSettled(page);
  });
```

## Never branch on page state

A branch or swallowed rejection makes the test pass when expected UI is missing. State the
expected journey and let Playwright throw when it cannot complete it.

### BAD — silently works whether the element exists or not

```typescript
  if (await toast.count()) {
    await toast.click();
  }

  await trigger.click().catch(() => undefined);
```

### GOOD — one expected journey

```typescript
  await toast.click();
  await trigger.click();
```

If the toast matters, click it unconditionally; otherwise omit it. For viewport-specific
journeys, use separate viewport-scoped tests.

## Never branch the test body on `isControl`

Control is not a fixed baseline — it is the merge-base today and your merged work tomorrow —
so `if (!isControl)` will cause false regressions.

### BAD — the wait is skipped on control, and silently on both sides after the merge

```typescript

  await openCartDrawer(page);
  // A new element was just introduced, to fix the fail, we only check it in experiment.
  if (!isControl) {
    await page.locator('[data-section-id="cart-upsell"]').waitFor({ state: 'visible' });
  }
```

### GOOD — one journey, gated on state both sides reach

```typescript
  await openCartDrawer(page);
  // Wait unconditionally. Initial failure against master is expected.
  await page.locator('[data-section-id="cart-upsell"]').waitFor({ state: 'visible' });
```

## Compose per-test `beforeNavigate` setup explicitly

A per-test `config.shared.beforeNavigate` **replaces** the file-level hook. It does not run after it automatically. Put global setup in a callable function and invoke it from overrides.

### BAD — replace request blocking and other global setup accidentally

```typescript
abTest('Address suggestions', {
  startingPath: '/order',
  config: {
    shared: {
      beforeNavigate: async ({ context }) => installDeterministicRoutes(context),
    },
  },
}, async () => {});
```

### GOOD — run shared setup before test-specific setup

```typescript
export async function applyGlobalBeforeNavigate(ctx: BeforeNavigateContext): Promise<void> {
  await installRequestBlocking(ctx.context, ['/recaptcha/']);
  await ctx.context.addInitScript(() => {
    document.documentElement.dataset.testMode = 'true';
  });
}

abTest('Address suggestions', {
  startingPath: '/order',
  config: {
    shared: {
      beforeNavigate: async (ctx) => {
        await applyGlobalBeforeNavigate(ctx);
        await installDeterministicRoutes(ctx.context);
      },
    },
  },
}, async ({ page }) => {
  await page.getByRole('combobox').fill('225 Creekstone');
  await page.getByRole('option').first().waitFor({ state: 'visible' });
});
```

`beforeNavigate` runs on the `BrowserContext` before the page exists, so cookies, init scripts, request blocking, and routes cover the first navigation and subframes.

## Annotate only user actions

Annotations form a timeline of the user journey. Use them for actions a user performs—clicking, typing, selecting, hovering, or submitting—not for test mechanics such as setup, request interception, waiting, assertions, retries, or stabilization.

### BAD — annotate test plumbing

```typescript
abTest('Compact cards', {
  startingPath: '/menus/compact-menu',
}, async ({ page, browserContext, annotate }) => {
  await annotate('installing compact-card interception');
  await stubCompactCards(browserContext);

  await annotate('clicking Compact layout');
  await page.getByRole('button', { name: 'Compact layout' }).click();

  await annotate('waiting for compact cards');
  await page.locator('.pm-compact-dish-card').first().waitFor({ state: 'visible' });
});
```

### GOOD — annotate the action, leave mechanics unannotated

```typescript
abTest('Compact cards', {
  startingPath: '/menus/compact-menu',
  config: {
    shared: {
      beforeNavigate: async (ctx) => {
        await applyGlobalBeforeNavigate(ctx);
        await stubCompactCards(ctx.context);
      },
    },
  },
}, async ({ page, annotate }) => {
  await annotate('clicking Compact layout');
  await page.getByRole('button', { name: 'Compact layout' }).click();
  await page.locator('.pm-compact-dish-card').first().waitFor({ state: 'visible' });
});
```

Put an annotation immediately before its user action so the timeline chip marks that action. The surrounding setup and readiness checks should remain visible in the source, but not compete with the user journey in reports.

## Capture presence, not absence

Shaka-perf is a snapshot-heavy framework: the captured artifact should contain the UI that proves the state under test. Do not use it for behavior whose only result is that an element is gone. A screenshot of the page after a dialog closes provides no meaningful evidence about the dialog or its close button.

### BAD — close the visual subject before capture

```typescript
abTest('Close item dialog', {
  startingPath: '/menus/dinner-menu',
  testTypes: ['visreg', 'accessibility'],
  visregSelectors: ['viewport'],
}, async ({ page }) => {
  await page.getByRole('button', { name: /Curly Fries/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Curly Fries/ });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'close dialog' }).click();
  await dialog.waitFor({ state: 'detached' });
  // The snapshot contains only the background; the UI under test is absent.
});
```

### GOOD — capture the dialog and its meaningful contents

```typescript
const ITEM_DIALOG = '[role="dialog"][aria-label*="Curly Fries"]';

abTest('Item dialog', {
  startingPath: '/menus/dinner-menu',
  testTypes: ['visreg', 'accessibility'],
  visregSelectors: [ITEM_DIALOG],
}, async ({ page }) => {
  await page.getByRole('button', { name: /Curly Fries/ }).first().click();
  const dialog = page.locator(ITEM_DIALOG);
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Add to order' }).waitFor({ state: 'visible' });
  await waitForStableElementSize(dialog);
});
```

If the requirement is “the Close button dismisses the dialog,” write that as a behavioral assertion in vanilla Playwright or Cypress. Keep the shaka-perf test focused on the presence and rendered quality of the open dialog.

## Capture the final component, not unstable surroundings

The element that exists before an interaction may be replaced afterward. Capturing the viewport can also make an unrelated, still-settling background dominate the diff.

### BAD — capture the viewport or a selector from the previous state

```typescript
abTest('Pick schedule time', {
  startingPath: '/order',
  visregSelectors: ['viewport'],
}, async ({ page }) => {
  await page.locator('[aria-labelledby="schedule-for-later-title"] [data-cy="time-option"]').first().click();
});
```

### GOOD — target the component that represents the resulting state

```typescript
abTest('Pick schedule time', {
  startingPath: '/order',
  visregSelectors: ['[role="dialog"][aria-labelledby="order-info-title"]'],
}, async ({ page }) => {
  await page.locator('[aria-labelledby="schedule-for-later-title"] [data-cy="time-option"]').first().click();
  await page.locator('[role="dialog"][aria-labelledby="order-info-title"]').waitFor({ state: 'visible' });
  await waitUntilPageSettled(page);
});
```

Choose `viewport` only when the whole viewport is the subject. Otherwise, a narrow selector produces a more meaningful diff and isolates the test from unrelated layout churn.

## Trim unrelated chrome, never the component's own parts

`visregSelectors` is for excluding page furniture that has nothing to do with the subject. It is not for cropping a component down to the piece you changed. A nav and the content it drives are one component: capture the nav alone and the shot cannot show whether the nav did anything.

### BAD — crop to the nav, losing the menu it navigates

```typescript
const SIDEBAR_NAV = '.pm-menu-sidebar';

abTest('Sidebar Section Tab Click', {
  startingPath: '/sidebar-menu-tabs-layout',
  visregSelectors: [SIDEBAR_NAV], // the sidebar means nothing outside its menu
}, async ({ page }) => {
  await page.locator(SIDEBAR_NAV).getByRole('tab', { name: 'Sides' }).click();
  /* page stabilization is ommitted */
});
```

### GOOD — capture the whole menu group, nav and content together

```typescript
abTest('Sidebar Section Tab Click', {
  startingPath: '/sidebar-menu-tabs-layout',
  visregSelectors: ['.pm-menus-bg'],
}, async ({ page }) => {
  await page.locator('.pm-menu-sidebar').getByRole('tab', { name: 'Sides' }).click();
  /* page stabilization is ommitted */
});
```

If the whole-component shot looks nearly identical to another test's, make the states genuinely different or drop the redundant test — do not crop until a diff appears.

## Keep the default perf set small

Perf costs `numberOfMeasurements` samples per viewport per twin, so every test that opts into it multiplies the run. Visreg is cheap by comparison. Tag each test with the suite it belongs to and let an env var widen it, so a normal run measures only the numbers someone actually reads while visual coverage stays complete.

### BAD — every test measures perf forever

```typescript
abTest('Menu tab switch', { startingPath: '/menus', testTypes: ['perf', 'visreg'] }, async () => {});
abTest('Dish modal', { startingPath: '/menus', testTypes: ['perf', 'visreg'] }, async () => {});
```

### GOOD — tag the suite

```typescript
export function perfTestSuite(suite: 'essential' | 'all', types: TestType[] = ['perf', 'visreg']): TestType[] {
  const measuresPerf = suite === 'essential' || process.env.ALL_PERF_TESTS === 'true';
  return measuresPerf ? types : types.filter(type => type !== 'perf');
}

abTest('Menu tab switch', { startingPath: '/menus', testTypes: perfTestSuite('all') }, async () => {});
abTest('Core layout', { startingPath: '/menus/core', testTypes: perfTestSuite('essential') }, async () => {});
```

## Capture each UI state once

Different test names, setup steps, or routes do not make captures distinct. If two tests finish by capturing the same component in the same rendered state, they duplicate coverage and multiply snapshot noise and runtime.

This rule is about **other tests**, not about your own test's viewports. Viewports are exempt. The same subject can render differently on different screens. So several do not dedupe viewports.

### BAD — capture the same sign-in dialog through two routes

```typescript
const SIGN_IN_DIALOG = '[role="dialog"][aria-labelledby="sign-in-title"]';

abTest('Sign in from menu', {
  startingPath: '/menus/dinner-menu',
  visregSelectors: [SIGN_IN_DIALOG],
}, async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator(SIGN_IN_DIALOG).waitFor({ state: 'visible' });
  /* page stabilization is ommitted */
});

abTest('Sign in from cart', {
  startingPath: '/cart',
  visregSelectors: [SIGN_IN_DIALOG],
}, async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator(SIGN_IN_DIALOG).waitFor({ state: 'visible' });
  /* page stabilization is ommitted */
});
```

### BAD — trim viewports because the shots would match

```typescript
abTest('Sign-in dialog', {
  startingPath: '/menus/dinner-menu',
  visregSelectors: [SIGN_IN_DIALOG],
  config: {
    // all viewports render the same dialog element, so desktop is enough - DO NOT DO THAT!!!
    visreg: { viewports: ['desktop'] },
    perf: { viewports: ['desktop', 'phone'] },
  },
}, async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  const dialog = page.locator(SIGN_IN_DIALOG);
  /* page stabilization is ommitted */
});
```

Fewer visreg viewports than perf viewports is always backwards.

### GOOD — use one canonical route for one rendered state

```typescript
const SIGN_IN_DIALOG = '[role="dialog"][aria-labelledby="sign-in-title"]';

abTest('Sign-in dialog', {
  startingPath: '/menus/dinner-menu',
  visregSelectors: [SIGN_IN_DIALOG],
}, async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  const dialog = page.locator(SIGN_IN_DIALOG);
  /* page stabilization is ommitted */
});
```

Before adding a test, inventory the final component and state already captured by **the rest of the suite**. Add another route only when it produces a materially different rendered state or when route performance is itself the subject and the capture provides route-specific evidence. Otherwise, cover alternate-route behavior in vanilla Playwright or Cypress.

The inventory is across tests. Within one test, the viewport list is a separate decision and this rule has nothing to say about it.

## No test name may contain another test name

`troubleshoot --filter` must resolve to exactly ONE test. A name that is a prefix of a sibling's cannot be addressed at all, so the test becomes undebuggable — and `compare --filter` silently runs more tests than you asked for.

### BAD — the first name is a prefix of the other two

```typescript
abTest('Consumer App Menu - Material Menu Tabs Layout', /* … */);
abTest('Consumer App Menu - Material Menu Tabs Layout Single Menu', /* … */);
abTest('Consumer App Menu - Material Menu Tabs Layout Tab Switch', /* … */);
```

### GOOD — qualify the base case too

```typescript
abTest('Consumer App Menu - Material Menu Tabs Layout Multi Menu', /* … */);
abTest('Consumer App Menu - Material Menu Tabs Layout Single Menu', /* … */);
abTest('Consumer App Menu - Material Menu Tabs Layout Tab Switch', /* … */);
```

When you add a variant of an existing test, rename the original rather than extending its name.


## Declare the viewport you need; never resize mid-test

Dynamic resizing causes all kinds of flakiness and kill LH measurements.

### BAD — grow the viewport at runtime to trip lazy loading

```typescript
const viewport = page.viewportSize();
await page.setViewportSize({ width: viewport.width, height: 6000 }); // everything reflows
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.setViewportSize(viewport);                                // and reflows back
```

### GOOD — declare it once, so both sides render at that size from the first paint

```typescript
// abtests.config.ts
viewportDefinitions: [{ ...DESKTOP_VIEWPORT, height: 6000 }, { ...PHONE_VIEWPORT, height: 6000 }],
```

## Make the viewport bigger than the element you capture

A screenshot is cropped to the viewport, so a subject taller than the window comes back
clipped or full of capture artifacts (fixed chrome mid-image, unmounted lazy content).
Check the subject's height and pick a viewport it fits inside — the tall trio
(`desktop-tall`, `tablet-tall`, `phone-tall`: same widths, 3000 px) exists for this.
Phone is the worst case: 667 px tall, and columns restack into one long strip.

### BAD — a ~2,200 px footer at phone's 667 px

```typescript
abTest('Footer locations', {
  startingPath: '/custom-form',
  visregSelectors: ['footer'],
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
```

### GOOD — a viewport the footer fits inside

```typescript
const MEASURED = ['desktop-tall', 'tablet-tall', 'phone-tall'] satisfies [string, ...string[]];

abTest('Footer locations', {
  startingPath: '/custom-form',
  visregSelectors: ['footer'],
  config: {
    visreg: { viewports: MEASURED },
  },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
```

