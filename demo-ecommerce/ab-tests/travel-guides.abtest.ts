import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Travel Guides index (/travel-guides)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none (17 images, 2000px total)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .travel-guide-index-header-container (510px) — hero
 *                  .states-pics-container                (165px) — state tile row
 *                  .travel-guides-container              (1167px) — body
 *                  .travel-guides-content-container      (626px) — content
 *                  .travel-guides-content-picture-container (528px) — pic collage
 * A5/A6 interactions: only header search (covered)
 * A7 modals:       none
 * A8 mobile:       Expected to stack.
 * Claimed shared:  page-specific containers
 * ========================================================================== */

/**
 * @section Hero header
 * @selector .travel-guide-index-header-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 510px tall hero container.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Travel Guides Hero', {
  startingPath: '/travel-guides',
  options: { visreg: { selectors: ['.travel-guide-index-header-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section State picture tile row
 * @selector .states-pics-container
 * @viewports all
 * @waitFor   networkidle (images loaded)
 * @threshold 0.05
 * @probed    A4 165px tall grid of state pictures.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Travel Guides State Pics', {
  startingPath: '/travel-guides',
  options: { visreg: { selectors: ['.states-pics-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Main content block
 * @selector .travel-guides-content-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 626px tall body content.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Travel Guides Content', {
  startingPath: '/travel-guides',
  options: { visreg: { selectors: ['.travel-guides-content-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// ============================================================================
// Pass 2: Interactive tests — user mindset: "I'm planning a trip. Which
// state do I want to explore?"
// ============================================================================

/**
 * @section State picture hover (first)
 * @selector .states-pics-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — states-pics-container has clickable state tiles.
 * @interactions
 *   - Hover first state tile
 *       trigger: .states-pics-container > *:first-child
 *       action:  hover
 * @form No form found
 */
abTest('Travel Guides State Hover', {
  startingPath: '/travel-guides',
  options: { visreg: { selectors: ['.states-pics-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first state tile');
  await page.locator('.states-pics-container > *').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Content picture grid hover
 * @selector .travel-guides-content-picture-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — .travel-guides-content-picture-container has images.
 * @interactions
 *   - Hover first picture
 * @form No form found
 */
abTest('Travel Guides Picture Hover', {
  startingPath: '/travel-guides',
  options: { visreg: { selectors: ['.travel-guides-content-picture-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first picture');
  await page.locator('.travel-guides-content-picture-container > *').first().hover();
  await page.waitForTimeout(200);
});
