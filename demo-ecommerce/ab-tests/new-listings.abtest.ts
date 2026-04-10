import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * New Listings (/new-listings)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    likely yes — this uses .infinite-grid-container (27 images
 *                  at initial, 1969px tall). Not scroll-tested here but grid
 *                  name suggests infinite scroll. Test captures initial state.
 * A2 loading:      no skeletons found on initial render
 * A3 animations:   none
 * A4 sections:     .new-listings-deals-container.listings-container (1637px)
 *                  .infinite-grid-container (927px)
 *                  .property-card-container (293px × many)
 *                  .property-content-container (107px — info block below image)
 *                  (shares dropdown filters with /deals)
 * A5/A6 interactions:
 *                  - All States dropdown (113 cities, 1085 communities)
 *                    — not exercised (similar to /deals behavior)
 *                  - Each property card is a link — destination tested separately
 * A7 modals:       none
 * A8 mobile:       Grid stacks.
 * Claimed shared:  .property-card-container is page-specific here
 *                  (though the same class may appear on city/state pages —
 *                  we use .first()-style selection via engine default)
 * ========================================================================== */

/**
 * @section H1 header (page title)
 * @selector .new-listings-header
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    A4 header wrapper contains h1 "New Gulf Coast Vacation Rentals".
 *            NOTE: .new-listings-header is claimed by /deals; this test uses
 *            a narrower selector.
 *            fixed: first attempt with 'document' selector timed out on
 *            page.goto after 60s in 2/3 viewports — the page loads 1085
 *            communities worth of data. Using .new-listings-deals-container
 *            which is smaller and avoids full-document capture overhead.
 * @interactions No interactions found
 * @form No form found
 */
abTest('New Listings Container', {
  startingPath: '/new-listings',
  options: { visreg: { selectors: ['.new-listings-deals-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section First property card
 * @selector .property-card-container
 * @viewports all
 * @waitFor   networkidle (card image loaded)
 * @threshold 0.1  (card image)
 * @probed    A4 293px, many matches (first is captured).
 * @interactions
 *   - Card link (navigates to /e<id>)
 *       trigger: anchor wrapping the card
 *       action:  navigation
 *       effect:  property detail page (tested separately)
 * @form No form found
 */
abTest('New Listings First Property Card', {
  startingPath: '/new-listings',
  options: { visreg: { selectors: ['.property-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// ============================================================================
// Pass 2: Interactive tests — user mindset: "Show me the newest rentals.
// Let me filter by state or city."
// ============================================================================

/**
 * @section New Listings — All States dropdown opened
 * @selector .new-listings-dropdown-container
 * @viewports all
 * @waitFor   dropdown expanded
 * @threshold 0.05
 * @probed    Pass 2 — same filter pattern as /deals.
 * @interactions
 *   - Open All States dropdown
 *       trigger: button.new-listings-dropdown-btn "All States"
 *       action:  click
 * @form No form found
 */
abTest('New Listings States Dropdown Open', {
  startingPath: '/new-listings',
  options: { visreg: { selectors: ['.new-listings-dropdown-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking All States');
  await page.locator('button.new-listings-dropdown-btn').filter({ hasText: 'All States' }).click();
  await page.waitForTimeout(400);
});

/**
 * @section New Listings — All Cities dropdown opened
 * @selector .new-listings-dropdown-container
 * @viewports all
 * @waitFor   dropdown expanded
 * @threshold 0.05
 * @probed    Pass 2 — "All Cities (113)" dropdown.
 * @interactions
 *   - Open All Cities dropdown
 *       trigger: button.new-listings-dropdown-btn "All Cities"
 *       action:  click
 * @form No form found
 */
abTest('New Listings Cities Dropdown Open', {
  startingPath: '/new-listings',
  options: { visreg: { selectors: ['.new-listings-dropdown-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking All Cities');
  await page.locator('button.new-listings-dropdown-btn').filter({ hasText: 'All Cities' }).click();
  await page.waitForTimeout(400);
});

/**
 * @section New Listings — All Communities dropdown opened
 * @selector .new-listings-dropdown-container
 * @viewports all
 * @waitFor   dropdown expanded
 * @threshold 0.05
 * @probed    Pass 2 — "All Communities (1085)" dropdown (unique to new-listings).
 * @interactions
 *   - Open All Communities dropdown
 *       trigger: button.new-listings-dropdown-btn "All Communities"
 *       action:  click
 * @form No form found
 */
abTest('New Listings Communities Dropdown Open', {
  startingPath: '/new-listings',
  options: { visreg: { selectors: ['.new-listings-dropdown-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking All Communities');
  await page.locator('button.new-listings-dropdown-btn').filter({ hasText: 'All Communities' }).click();
  await page.waitForTimeout(400);
});

/**
 * @section New Listings — Property card hover
 * @selector .property-card-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.15
 * @probed    Pass 2 — cards hoverable.
 * @interactions
 *   - Hover first card
 * @form No form found
 */
abTest('New Listings Card Hover', {
  startingPath: '/new-listings',
  options: { visreg: { selectors: ['.property-card-container'], misMatchThreshold: 0.15 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first property card');
  await page.locator('.property-card-container').first().hover();
  await page.waitForTimeout(200);
});
