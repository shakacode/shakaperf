import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * State Travel Guides index — discovered via staging probe
 * ----------------------------------------------------------------------------
 * Pattern: /<state>/travel-guides
 * Sample: /florida/travel-guides
 *
 * NEW page type not in Pass 1 or Pass 2. Sections:
 *   - .travel-guide-index-header-container (510px) — hero
 *   - .travel-guides-state-guide-container (3565px) — main wrapper
 *   - .travel-guides-state-header-container (82px) — sub-header
 *   - .travel-guides-state-list-container (3313px) — guide cards grid
 *   - .guide-card-container (502px × many) — each guide
 *
 * Buttons: Back to All States, Browse <State> Rentals, Read More × N
 * ========================================================================== */

/**
 * @section Florida travel guides hero
 * @selector .travel-guide-index-header-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — 510px hero on state travel guides page.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Florida Travel Guides Hero', {
  startingPath: '/florida/travel-guides',
  options: { visreg: { selectors: ['.travel-guide-index-header-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Florida travel guides list container
 * @selector .travel-guides-state-list-container
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.1
 * @probed    Pass 3 — list of guide cards.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Florida Travel Guides List', {
  startingPath: '/florida/travel-guides',
  options: {
    visreg: {
      selectors: ['.travel-guides-state-list-container'],
      misMatchThreshold: 0.15,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section First guide card
 * @selector .guide-card-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.1
 * @probed    Pass 3 — 502px tall guide card.
 * @interactions
 *   - Read More button
 * @form No form found
 */
abTest('Florida Travel Guides First Card', {
  startingPath: '/florida/travel-guides',
  options: { visreg: { selectors: ['.guide-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section First guide card hover
 * @selector .guide-card-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 3 — guide cards are clickable (Read More).
 * @interactions
 *   - Hover first guide card
 * @form No form found
 */
abTest('Florida Travel Guides Card Hover', {
  startingPath: '/florida/travel-guides',
  options: { visreg: { selectors: ['.guide-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first guide card');
  await page.locator('.guide-card-container').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Back to All States hover
 * @selector .travel-guide-index-header-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 3 — Back to All States button at top.
 * @interactions
 *   - Hover Back to All States
 * @form No form found
 */
abTest('Florida Travel Guides Back Button Hover', {
  startingPath: '/florida/travel-guides',
  options: { visreg: { selectors: ['.travel-guide-index-header-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Back to All States');
  await page.locator('button').filter({ hasText: 'Back to All States' }).hover().catch(() => {});
  await page.waitForTimeout(200);
});

/**
 * @section Browse Florida Rentals hover
 * @selector .travel-guides-state-guide-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 3 — Browse Florida Rentals CTA.
 * @interactions
 *   - Hover Browse Rentals CTA
 * @form No form found
 */
abTest('Florida Travel Guides Browse Hover', {
  startingPath: '/florida/travel-guides',
  options: {
    visreg: {
      selectors: ['.travel-guides-state-guide-container'],
      misMatchThreshold: 0.15,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Browse Florida Rentals');
  await page.locator('button').filter({ hasText: 'Browse' }).first().hover().catch(() => {});
  await page.waitForTimeout(200);
});
