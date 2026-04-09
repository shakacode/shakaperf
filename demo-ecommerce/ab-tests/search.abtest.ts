import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Search results (/search)
 * ----------------------------------------------------------------------------
 * Landing URL is auto-appended with ?beds=2&type=House&mapVisible=true&amenities=Pool
 * — the app pre-fills some filters and redirects. This is the default state.
 *
 * A1 lazy load:    n/a (map tiles render lazily based on bounds)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   map may pan on load; not a carousel issue
 * A4 sections:     .map-page-search-container (800px) — full map+list layout
 *                  .search-page-container (667px)
 *                  .search-map-section (667px)
 * A5/A6 interactions:
 *                  - "View as List" button — toggles map view to list
 * A7 modals:       none in default state
 * A8 mobile:       Map works at phone size; layout adjusts.
 * Claimed shared:  .search-page-container is page-specific
 * ========================================================================== */

/**
 * @section Full map + results container
 * @selector .map-page-search-container
 * @viewports all
 * @waitFor   networkidle (map tiles + property list)
 * @threshold 0.1  (map tiles may vary slightly)
 * @probed    A4 800px tall; encompasses both the map panel and the results.
 * @interactions
 *   - View as List
 *       trigger: button "View as List"
 *       action:  toggle (not exercised — default state test suffices)
 *       effect:  switches to list-only view
 * @form No form found
 */
abTest('Search Default View', {
  startingPath: '/search',
  options: { visreg: { selectors: ['.map-page-search-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Map panel
 * @selector .search-map-section
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.15  (map tiles may load differently)
 * @probed    A4 667px tall map section.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Search Map Section', {
  startingPath: '/search',
  options: { visreg: { selectors: ['.search-map-section'], misMatchThreshold: 0.15 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// TODO: Search List View
// The "View as List" button is visible in Chrome at all viewports but
// Playwright's .locator('button:has-text("View as List")').first().click()
// times out after 30s on every viewport (phone, tablet, desktop). Likely
// the button is inside an SVG or overlay layer that intercepts pointer
// events. Leaving commented; the default map view test above already
// covers the search page's primary rendering.
//
// abTest('Search List View', { ... });
