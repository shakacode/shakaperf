import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * City Travel Guide pages — discovered via staging probe
 * ----------------------------------------------------------------------------
 * Pattern: /<state>/<city>/travel-guide
 * Sample: /florida/destin/travel-guide
 *
 * This is a NEW page type not covered in Pass 1 or Pass 2 — found via
 * staging cross-reference. Sections:
 *   - .travel-guide-show-header-container (510px) — hero with city image
 *   - .travel-guides-state-guide-container (1782px) — main guide content
 *   - .travel-guides-state-header-container (1648px) — state header
 *
 * Buttons:
 *   - "Back to All Guides" — navigates to /travel-guides
 *   - "Browse <City> Rentals" — navigates to /<state>/<city>
 * ========================================================================== */

/**
 * @section Travel guide hero header
 * @selector .travel-guide-show-header-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — 510px hero with city title and image.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Destin Travel Guide Hero', {
  startingPath: '/florida/destin/travel-guide',
  options: { visreg: { selectors: ['.travel-guide-show-header-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Travel guide main content
 * @selector .travel-guides-state-guide-container
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — 1782px tall main guide content.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Destin Travel Guide Content', {
  startingPath: '/florida/destin/travel-guide',
  options: {
    visreg: {
      selectors: ['.travel-guides-state-guide-container'],
      misMatchThreshold: 0.01,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Travel guide — Back to All Guides hover
 * @selector .travel-guide-show-header-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 3 — "Back to All Guides" button at top.
 * @interactions
 *   - Hover Back to All Guides
 * @form No form found
 */
abTest('Destin Travel Guide Back Button Hover', {
  startingPath: '/florida/destin/travel-guide',
  options: { visreg: { selectors: ['.travel-guide-show-header-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Back to All Guides');
  await page.locator('button').filter({ hasText: 'Back to All Guides' }).hover().catch(() => {});
  await page.waitForTimeout(200);
});

/**
 * @section Travel guide — Browse Rentals CTA hover
 * @selector .travel-guides-state-guide-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 3 — "Browse Destin Rentals" CTA at the bottom of the
 *            travel guide content.
 * @interactions
 *   - Hover Browse Rentals CTA
 * @form No form found
 */
abTest('Destin Travel Guide Browse Rentals Hover', {
  startingPath: '/florida/destin/travel-guide',
  options: {
    visreg: {
      selectors: ['.travel-guides-state-guide-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Browse Rentals CTA');
  await page.locator('button').filter({ hasText: 'Browse' }).filter({ hasText: 'Rentals' }).hover().catch(() => {});
  await page.waitForTimeout(200);
});
