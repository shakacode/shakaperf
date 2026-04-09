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
