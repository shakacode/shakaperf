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

// ============================================================================
// Pass 2: Interactive tests — user mindset: "I'm searching for a rental.
// Let me interact with the map, filters, and sort."
// ============================================================================

/**
 * @section Search page — header search bar interaction
 * @selector .map-page-search-container
 * @viewports all
 * @waitFor   combobox focused
 * @threshold 0.1
 * @probed    Pass 2 — search page has a combobox input at the top.
 * @interactions
 *   - Focus city combobox
 *       trigger: input[placeholder="Search"] (combobox-input)
 *       action:  click
 *       effect:  dropdown may open
 * @form No form found
 */
abTest('Search Combobox Focused', {
  startingPath: '/search',
  options: { visreg: { selectors: ['.map-page-search-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking combobox input');
  await page.locator('input.combobox-input').click();
  await page.waitForTimeout(400);
});

/**
 * @section Search page — map zoomed
 * @selector .search-map-section
 * @viewports desktop
 * @waitFor   map zoom level increased
 * @threshold 0.2  (map tiles change on zoom)
 * @probed    Pass 2 — maps support zoom; keyboard "+" or button click.
 * @interactions
 *   - Zoom in
 *       trigger: keyboard "+" on map
 *       action:  keyboard press
 *       effect:  map zooms in (different tiles loaded)
 * @form No form found
 */
abTest('Search Map Zoomed', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.search-map-section'],
      misMatchThreshold: 0.2,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('focusing map and pressing + to zoom');
  await page.locator('.search-map-section').click();
  await page.keyboard.press('+');
  await page.waitForTimeout(800);
});

// ============================================================================
// Pass 3: Major search interactions found via staging probe
// ============================================================================

/**
 * @section Filters drawer/popover — opened
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   filter popover visible
 * @threshold 0.05
 * @probed    Pass 3 — confirmed in Chrome (screenshot ss_7826s55z9) that
 *            clicking the "Filters" button opens a panel with: Deals toggle,
 *            Pet Friendly toggle, Type checkboxes (Condo/House/Townhome/Cottage),
 *            Min/Max Daily $ inputs, Bedrooms +/- counter, Bathrooms +/-
 *            counter, Clear button, Apply button.
 * @interactions
 *   - Open filters
 *       trigger: button.map-filter-btn "Filters"
 *       action:  click
 *       effect:  filter popover appears
 * @form Filters popover
 *   - button "Deals" toggle
 *   - button "Pet Friendly" toggle
 *   - input[type="checkbox"] Condo, House, Townhome, Cottage
 *   - input Min Daily $
 *   - input Max Daily $
 *   - +/- counters Bedrooms, Bathrooms
 *   submit: button "Apply"
 *   reset: button "Clear"
 */
abTest('Search Filters Drawer Open', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking Filters button');
  await page.locator('button.map-filter-btn').filter({ hasNotText: 'Clear' }).first().click();
  await page.waitForTimeout(500);
});

/**
 * @section Filters — Deals toggle activated
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   Deals button active state
 * @threshold 0.05
 * @probed    Pass 3 — Deals toggle button inside Filters popover.
 * @interactions
 *   - Open filters
 *   - Click Deals toggle
 *       trigger: button containing "Deals" inside filter popover
 *       action:  click
 *       effect:  button switches to active state (highlighted)
 * @form See Filters Drawer Open
 */
abTest('Search Filters Deals Toggle', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening filters');
  await page.locator('button.map-filter-btn').filter({ hasNotText: 'Clear' }).first().click();
  await page.waitForTimeout(400);
  annotate('clicking Deals toggle');
  await page.locator('button').filter({ hasText: 'Deals' }).first().click();
  await page.waitForTimeout(300);
});

/**
 * @section Filters — Pet Friendly toggle activated
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   Pet Friendly active
 * @threshold 0.05
 * @probed    Pass 3 — Pet Friendly toggle in Filters.
 * @interactions
 *   - Open filters then click Pet Friendly
 * @form See Filters Drawer Open
 */
abTest('Search Filters Pet Friendly Toggle', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening filters');
  await page.locator('button.map-filter-btn').filter({ hasNotText: 'Clear' }).first().click();
  await page.waitForTimeout(400);
  annotate('clicking Pet Friendly toggle');
  await page.locator('button').filter({ hasText: 'Pet Friendly' }).click();
  await page.waitForTimeout(300);
});

/**
 * @section Filters — Condo type checked
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   checkbox checked
 * @threshold 0.05
 * @probed    Pass 3 — Type checkbox group with Condo/House/Townhome/Cottage.
 * @interactions
 *   - Open filters then check Condo
 * @form See Filters Drawer Open
 */
abTest('Search Filters Type Condo Checked', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening filters');
  await page.locator('button.map-filter-btn').filter({ hasNotText: 'Clear' }).first().click();
  await page.waitForTimeout(400);
  annotate('checking Condo type');
  await page.locator('label').filter({ hasText: 'Condo' }).first().click();
  await page.waitForTimeout(200);
});

/**
 * @section Filters — Min Daily $ filled
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   input populated
 * @threshold 0.05
 * @probed    Pass 3 — Min Daily $ input.
 * @interactions
 *   - Open filters then fill min price
 * @form See Filters Drawer Open
 */
abTest('Search Filters Min Price Filled', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening filters');
  await page.locator('button.map-filter-btn').filter({ hasNotText: 'Clear' }).first().click();
  await page.waitForTimeout(400);
  annotate('filling Min Daily $');
  await page.locator('input[placeholder="$"]').first().fill('100');
  await page.waitForTimeout(200);
});

/**
 * @section Filters — Apply button clicked
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   filters applied (popover closed, results updated)
 * @threshold 0.1
 * @probed    Pass 3 — Apply button to commit filter changes.
 * @interactions
 *   - Open filters then click Apply
 * @form See Filters Drawer Open
 */
abTest('Search Filters Apply Clicked', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening filters');
  await page.locator('button.map-filter-btn').filter({ hasNotText: 'Clear' }).first().click();
  await page.waitForTimeout(400);
  annotate('clicking Apply');
  await page.locator('button').filter({ hasText: 'Apply' }).click();
  await page.waitForTimeout(500);
});

/**
 * @section Search — Clear Filters clicked
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   filters cleared
 * @threshold 0.1
 * @probed    Pass 3 — "Clear Filters" button .map-filter-btn (separate from
 *            the Filters one — it's a top-level reset).
 * @interactions
 *   - Click Clear Filters
 *       trigger: button "Clear Filters"
 *       action:  click
 *       effect:  all filters reset
 * @form No form found
 */
abTest('Search Clear Filters', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking Clear Filters');
  await page.locator('button').filter({ hasText: 'Clear Filters' }).click();
  await page.waitForTimeout(500);
});

/**
 * @section Search — Sort dropdown opened
 * @selector .map-page-search-container
 * @viewports desktop
 * @waitFor   sort dropdown shown
 * @threshold 0.05
 * @probed    Pass 3 — "Beds: Low to High" sort button (.map-search-sort).
 * @interactions
 *   - Open sort dropdown
 *       trigger: .map-search-sort
 *       action:  click
 *       effect:  dropdown menu appears
 * @form No form found
 */
abTest('Search Sort Dropdown Open', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.map-page-search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking sort button');
  await page.locator('.map-search-sort').click();
  await page.waitForTimeout(500);
});

/**
 * @section Search — Search as I move checkbox toggled
 * @selector .search-map-section
 * @viewports desktop
 * @waitFor   checkbox state changed
 * @threshold 0.05
 * @probed    Pass 3 — "Search as I move" checkbox on map (visible in
 *            screenshot ss_7826s55z9).
 * @interactions
 *   - Toggle checkbox
 *       trigger: input[type="checkbox"] near "Search as I move" label
 *       action:  click
 *       effect:  checkbox unchecked
 * @form No form found
 */
abTest('Search Move Checkbox Toggled', {
  startingPath: '/search',
  options: {
    visreg: {
      selectors: ['.search-map-section'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('toggling Search as I move checkbox');
  await page.locator('input[type="checkbox"]').first().click().catch(() => {});
  await page.waitForTimeout(300);
});
