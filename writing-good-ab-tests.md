# Writing Good AB Tests

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

## Capture each UI state once

Different test names, setup steps, or routes do not make captures distinct. If tests finish by capturing the same component in the same rendered state, they duplicate coverage and multiply snapshot noise and runtime.

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

Before adding a test, inventory the final component and state already captured by the suite. Add another route only when it produces a materially different rendered state or when route performance is itself the subject and the capture provides route-specific evidence. Otherwise, cover alternate-route behavior in vanilla Playwright or Cypress.

