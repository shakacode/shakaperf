# abtest.ts Patterns

Each pattern below corresponds to a scenario you confirmed during probing. Only use a pattern if the corresponding behavior was actually observed.

## Selectors strategy

Choose selectors in this order:

1. **CSS selectors (preferred)** — `selectors: ['.section-class']` captures the element's bounding box thanks to `useBoundingBoxViewportForSelectors: true` in `visreg.config.ts`. This is the default approach for most tests.

2. **Viewport + scroll (fallback)** — only use `selectors: ['viewport']` + `scrollIntoViewIfNeeded()` if the CSS selector can't be found AND the test screenshot shows mostly whitespace in the bottom 60% of the page. Read the test images to verify before switching to this approach. See Pattern 7.

3. **Short pages** — a single `'document'` capture is enough. No need for viewport or per-section selectors.

4. **Tall pages (>3000px)** — split into multiple tests, each targeting a different section with a CSS selector.

When a locator might match multiple elements, always use `.first()`:
```typescript
await page.locator('.section-class').first().scrollIntoViewIfNeeded();
```

## Simple snapshot (most pages)

Use for any page with no meaningful dynamic content.

```typescript
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Page Name', {
  startingPath: '/path',
  options: { visreg: { delay: 50, misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
```

## With specific selectors

Use when the page has notable named sections worth capturing individually, or when `document` would be too tall (>3000px).

```typescript
abTest('Page Name', {
  startingPath: '/path',
  options: { visreg: { selectors: ['[data-cy="hero"]', 'document'], delay: 50, misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
```

## Interaction test (click confirmed working in probing)

Only use if you clicked the element during probing and saw a visible effect.

```typescript
import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Click [Button] on [Page]', {
  startingPath: '/start',
  options: { visreg: { misMatchThreshold: 0.05, maxNumDiffPixels: 5 } },
}, async ({ page, testType, annotate }) => {
  annotate('waiting for element to appear');
  await page.waitForSelector('[data-cy="element"]');
  annotate('clicking button');
  await page.click('text=Button Text');
  annotate('waiting for navigation to expected path');
  await page.waitForURL('**/expected-path');
  if (testType === TestType.VisualRegression) {
    annotate('waiting for page to settle after navigation');
    await waitUntilPageSettled(page);
  }
});
```

## Page with lazy-loaded content (scroll confirmed in probing)

Only use if `scripts/probe-lazy-load.js` (or manual scroll probing) confirmed new content appeared after scrolling.

**NEVER use `while (!atBottom)` scroll loops with `page.mouse.wheel()`** — they go infinite in shaka-visreg because `window.scrollY` doesn't update in the Playwright context. Instead, use `scrollIntoViewIfNeeded()` on a known bottom element (footer, last section) to trigger lazy loading.

```typescript
abTest('Page Name', {
  startingPath: '/path',
  options: { visreg: { delay: 50, misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('scrolling to bottom to trigger lazy load');
  await page.locator('footer').scrollIntoViewIfNeeded();
  annotate('waiting for lazy-loaded content to finish loading');
  await page.waitForLoadState('networkidle');
  annotate('scrolling back to top');
  await page.evaluate(() => window.scrollTo(0, 0));
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
```

If there's no footer, use the last visible section or `page.locator('body > *:last-child')`. The key is to avoid scroll loops entirely.

## Viewport-conditional selectors (element hidden on some viewports)

Use when a selector only exists on certain viewports (e.g. `display: none` on mobile). The `viewport` labels come from `visreg.config.ts` (e.g. `'phone'`, `'tablet'`, `'desktop'`).

### Preferred: split into separate tests with `viewports` override

Write separate `abTest()` calls scoped to specific viewports via the `viewports` option, so each test only runs where its selector exists. This is the cleanest approach — no branching logic, clear test names, and failures are easy to trace.

```typescript
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

// Desktop/tablet only — .map-container is display:none on phone
abTest('Homepage Map Section', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.map-container'],
      misMatchThreshold: 0.05,
      viewports: [
        { label: 'tablet', width: 768, height: 1024 },
        { label: 'desktop', width: 1280, height: 800 },
      ],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// Phone only — .mobile-featured-grid replaces the desktop grid
abTest('Homepage Mobile Featured', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.mobile-featured-grid'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'phone', width: 375, height: 667 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
```

### Alternative: branch inside the test callback

When the viewport difference involves test logic (not just which selector to capture) — e.g. different waits, clicks, or scroll behavior — use the `viewport` parameter to branch within a single test.

```typescript
abTest('Search Results', {
  startingPath: '/search',
  options: {
    visreg: { misMatchThreshold: 0.05, delay: 100 },
  },
}, async ({ page, viewport, annotate }) => {
  if (viewport.label === 'phone') {
    annotate('waiting for mobile results list');
    await page.waitForSelector('.mobile-results', { state: 'visible' });
  } else {
    annotate('waiting for split-panel search layout');
    await page.waitForSelector('.search-split-panel', { state: 'visible' });
  }
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
```

## Carousel / animation (CSS override confirmed in probing)

Only use if injecting the CSS override during probing visually froze the animation.

```typescript
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled, overrideCSS } from 'shaka-visreg/helpers';

const PAUSE_CSS = `
  [data-cy="carousel-track"] { animation: none !important; transform: translateX(0) !important; }
`;

abTest('Carousel on [Page]', {
  startingPath: '/path',
  options: { visreg: { delay: 50, misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for carousel to appear');
  await page.waitForSelector('[data-cy="carousel-track"]', { state: 'visible' });
  annotate('overriding CSS to freeze carousel animation');
  await overrideCSS(page);
  await page.addStyleTag({ content: PAUSE_CSS });
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
```

## Scroll to section (fallback — CSS selector not available)

Only use when a CSS selector can't target the section you need AND the test screenshot shows mostly whitespace in the bottom 60% of the page. Read the test images to verify before switching to this pattern. The preferred approach is always a CSS selector (see "Selectors strategy" above).

```typescript
abTest('Below-fold Section on [Page]', {
  startingPath: '/path',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      delay: 50,
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('scrolling target section into view');
  await page.locator('.target-section').first().scrollIntoViewIfNeeded();
});
```

## Modal / expandable interaction (confirmed in probing)

Click a button to open a modal, drawer, or expanded panel, then capture the result. Also probe and test interactions INSIDE the modal — if the modal contains forms, buttons, or links, write separate tests for those (see form filling and chained interaction patterns below).

```typescript
abTest('Open [Modal Name] on [Page]', {
  startingPath: '/path',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking button to open modal');
  await page.locator('[data-cy="open-modal"]').click();
  annotate('waiting for modal to appear');
  await page.waitForTimeout(500);
});
```

## Form filling (confirmed in probing)

Fill form inputs and capture the filled state. Use `page.fill()` for text inputs and textareas. For `type="number"` inputs, use numeric-only strings (no dashes or special characters). Use `page.getByLabel()` when inputs have associated labels.

```typescript
abTest('Fill [Form Name] on [Page]', {
  startingPath: '/path',
  options: {
    visreg: {
      selectors: ['.form-container'],
      misMatchThreshold: 0.05,
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('filling name field');
  await page.fill('input[name="name"]', 'Jane Smith');
  annotate('filling email field');
  await page.fill('input[name="email"]', 'jane@example.com');
  // For type="number" inputs, use numeric-only strings:
  annotate('filling phone field');
  await page.fill('input[name="phone"]', '5551234567');
  // For textareas:
  annotate('filling message field');
  await page.fill('textarea[name="message"]', 'Test message text');
});
```

## Checkbox / filter interaction (confirmed in probing)

Use `page.getByLabel()` for checkboxes and radio buttons. Add `{ exact: true }` when the label text could partially match other labels.

```typescript
abTest('Apply Filters on [Page]', {
  startingPath: '/path',
  options: {
    visreg: {
      selectors: ['.results-container'],
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('checking first filter option');
  await page.getByLabel('Option A').check();
  await page.waitForTimeout(200);
  annotate('checking second filter option');
  await page.getByLabel('Option B', { exact: true }).check();
  await page.waitForTimeout(300);
});
```

## Chained interaction (confirmed in probing)

Click something → new UI appears → interact with the new UI. Each link in the chain should have been confirmed during probing. If the new UI itself reveals more interactions (e.g., a filter panel with checkboxes), chain further.

```typescript
abTest('Open Filters and Apply on [Page]', {
  startingPath: '/path',
  options: {
    visreg: {
      selectors: ['.results-container'],
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking to open filter panel');
  await page.locator('[aria-expanded]').first().click();
  await page.waitForTimeout(300);
  annotate('checking filter option');
  await page.getByLabel('Category A').check();
  await page.waitForTimeout(200);
  annotate('clicking apply button');
  await page.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(500);
});
```

## Navigation click (confirmed in probing)

Click a CTA or link that navigates to another page, then capture the destination. Use `{ waitUntil: 'commit' }` for pages with slow server responses (>30s).

```typescript
import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Click [CTA] on [Page]', {
  startingPath: '/start-page',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, testType, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking CTA link');
  await page.locator('a[href="/destination"]').click();
  annotate('waiting for navigation');
  await page.waitForURL('**/destination');
  // For slow pages: await page.waitForURL('**/destination', { waitUntil: 'commit' });
  if (testType === TestType.VisualRegression) {
    annotate('waiting for destination page to settle');
    await waitUntilPageSettled(page);
  }
});
```
