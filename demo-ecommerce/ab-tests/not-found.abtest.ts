import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * 404 Not Found page — discovered via staging probe
 * ----------------------------------------------------------------------------
 * Any non-existent URL renders the 404 page.
 * Sample: /this-page-does-not-exist-test-404
 *
 * NEW page type not in Pass 1 or Pass 2. Sections:
 *   - .booking-container.full-page-width (503px)
 *   - .booking-pal-success-container (223px) — contains the message
 *
 * Buttons: "Back to Home"
 * ========================================================================== */

const NOT_FOUND_PATH = '/this-page-does-not-exist-test-404';

/**
 * @section 404 page main container
 * @selector .booking-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — 404 page uses .booking-container as wrapper.
 * @interactions
 *   - Back to Home button
 * @form No form found
 */
abTest('404 Page Main', {
  startingPath: NOT_FOUND_PATH,
  options: { visreg: { selectors: ['.booking-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section 404 page success container (the message box)
 * @selector .booking-pal-success-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — 223px message box with "Oops! We can't find that page".
 * @interactions No interactions found
 * @form No form found
 */
abTest('404 Page Message', {
  startingPath: NOT_FOUND_PATH,
  options: { visreg: { selectors: ['.booking-pal-success-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section 404 — Back to Home button hover
 * @selector .booking-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 3 — "Back to Home" button on 404.
 * @interactions
 *   - Hover Back to Home
 * @form No form found
 */
abTest('404 Back Home Button Hover', {
  startingPath: NOT_FOUND_PATH,
  options: { visreg: { selectors: ['.booking-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Back to Home button');
  await page.locator('button').filter({ hasText: 'Back to Home' }).hover();
  await page.waitForTimeout(200);
});
