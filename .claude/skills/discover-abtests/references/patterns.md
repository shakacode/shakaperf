# abtest.ts Patterns

Each pattern below corresponds to a scenario you confirmed during Phase 1 probing. Only use a pattern if the corresponding behavior was actually observed.

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

## Interaction test (click confirmed working in Phase 1)

Only use if you clicked the element in Phase 1 and saw a visible effect.

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

## Page with lazy-loaded content (scroll confirmed in Phase 1)

Only use if `scripts/probe-lazy-load.js` (or manual scroll probing) confirmed new content appeared after scrolling.

Use `page.mouse.wheel()` for real incremental scrolling — not `window.scrollTo()` in JS. Sites that use IntersectionObserver-based lazy loaders only respond to genuine scroll events; a JS jump to the bottom bypasses them entirely.

```typescript
abTest('Page Name', {
  startingPath: '/path',
  options: { visreg: { delay: 50, misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('scrolling incrementally to trigger lazy load');
  let atBottom = false;
  while (!atBottom) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(100);
    atBottom = await page.evaluate(() =>
      window.scrollY + window.innerHeight >= document.body.scrollHeight
    );
  }
  annotate('waiting for lazy-loaded content to finish loading');
  await page.waitForLoadState('networkidle');
  annotate('scrolling back to top');
  await page.evaluate(() => window.scrollTo(0, 0));
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
```

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

## Carousel / animation (CSS override confirmed in Phase 1)

Only use if injecting the CSS override in Phase 1 visually froze the animation.

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
