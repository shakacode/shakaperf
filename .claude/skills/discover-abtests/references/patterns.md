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
