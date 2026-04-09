import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Deals & Specials (/deals)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none detected (26 images loaded on initial render)
 * A2 loading:      no skeletons/spinners found
 * A3 animations:   none moving
 * A4 sections:     .new-listings-header        (54px)   — page H1
 *                  .new-listings-dropdown-container (50px) — filter row
 *                  .deals-card-container       (×84, 389px each) — deal cards
 *                  .new-listings-deals-container (5961px — too tall, use children)
 *                  .deals-content-container    (439px)  — SEO text blocks
 *                  .also-of-interest           (83px)   — related links
 *                  .footer-container           (claimed by homepage)
 * A5/A6 interactions:
 *                  - All States dropdown button (.new-listings-dropdown-btn)
 *                    — click did not reveal a dropdown in Chrome; unclear
 *                    whether it requires specific state. Not exercised.
 *                  - All Cities dropdown button — same as above, not tested
 *                  - "View all on map" button — navigates to search page
 *                  - "List Your Property & Promote a Deal" primary CTA
 *                    — navigates to /list-your-property (its own test)
 *                  - Combobox search input in header — homepage test covers
 * A7 modals:       none opened during A6 probing
 * A8 mobile:       All probed selectors present at 768px; assumed ok for
 *                  phone (static list layout). If failures, will restrict.
 * Claimed shared:  .deals-card-container (first one),
 *                  .new-listings-header, .deals-content-container
 *                  (.footer-container, .interest-container — claimed by homepage)
 * ========================================================================== */

/**
 * @section Page header (h1 + description)
 * @selector .new-listings-header
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static heading)
 * @probed    A4 matches once, height 54. Contains the H1.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Page Header', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.new-listings-header'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Filter row (All States / All Cities / View on map)
 * @selector .new-listings-dropdown-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 50px tall filter bar. Dropdowns not expanded by default.
 * @interactions
 *   - All States dropdown
 *       trigger: button.new-listings-dropdown-btn (button "All States (2)")
 *       action:  click — did not visibly expand during probing; not exercised.
 *       effect:  unknown
 *   - All Cities dropdown
 *       trigger: button.new-listings-dropdown-btn (button "All Cities (7)")
 *       action:  click — not exercised.
 *       effect:  unknown
 * @form No form found
 */
abTest('Deals Filter Row', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.new-listings-dropdown-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section First deal card
 * @selector .deals-card-container
 * @viewports all
 * @waitFor   networkidle (card image loaded)
 * @threshold 0.1  (image content)
 * @probed    A4 84 cards found, each ~389px tall. Using .first() implicitly
 *            via engine default behavior (first match).
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals First Card', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section SEO content block
 * @selector .deals-content-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static marketing text)
 * @probed    A4 439px tall, appears near bottom of page (absTop 5398).
 *            Contains "Top Vacation Rental Discounts by Destination" etc.
 *            bounding-box viewport scroll via engine should reach it.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals SEO Content', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-content-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
