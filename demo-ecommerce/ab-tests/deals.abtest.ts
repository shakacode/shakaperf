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

// ============================================================================
// Pass 2: Interactive tests — user mindset: "I want a Gulf Coast deal. Let me
// filter by state, by city, click a card I like."
// ============================================================================

/**
 * @section Deals — All States dropdown opened
 * @selector .new-listings-dropdown-container
 * @viewports all
 * @waitFor   dropdown expanded (showing state options)
 * @threshold 0.05
 * @probed    Pass 2 — confirmed in Chrome (screenshot ss_4966pfgjv) that
 *            clicking the "All States (2)" button expands a panel showing
 *            "All States", "Alabama", "Florida" options.
 * @interactions
 *   - Open All States dropdown
 *       trigger: button.new-listings-dropdown-btn containing "All States"
 *       action:  click
 *       effect:  dropdown panel shows state filter options
 * @form No form found
 */
abTest('Deals All States Dropdown Open', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.new-listings-dropdown-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking All States dropdown');
  await page.locator('button.new-listings-dropdown-btn').filter({ hasText: 'All States' }).click();
  await page.waitForTimeout(400);
});

/**
 * @section Deals — All Cities dropdown opened
 * @selector .new-listings-dropdown-container
 * @viewports all
 * @waitFor   dropdown expanded
 * @threshold 0.05
 * @probed    Pass 2 — second dropdown button "All Cities (11)".
 * @interactions
 *   - Open All Cities dropdown
 *       trigger: button.new-listings-dropdown-btn containing "All Cities"
 *       action:  click
 *       effect:  dropdown panel shows city filter options
 * @form No form found
 */
abTest('Deals All Cities Dropdown Open', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.new-listings-dropdown-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking All Cities dropdown');
  await page.locator('button.new-listings-dropdown-btn').filter({ hasText: 'All Cities' }).click();
  await page.waitForTimeout(400);
});

/**
 * @section Deals — First deal card hovered
 * @selector .deals-card-container
 * @viewports all
 * @waitFor   hover state applied
 * @threshold 0.1
 * @probed    Pass 2 — deal cards are likely clickable links. Hovering may
 *            reveal a hover style (shadow, scale).
 * @interactions
 *   - Hover first deal card
 *       trigger: .deals-card-container (first)
 *       action:  hover
 * @form No form found
 */
abTest('Deals First Card Hover', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first deal card');
  await page.locator('.deals-card-container').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Deals — List Your Property promo CTA hover
 * @selector .list-promote-deal-button
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — "List Your Property & Promote a Deal" button (primary-btn).
 *            Hovering reveals hover state if present.
 * @interactions
 *   - Hover List Your Property CTA
 *       trigger: button.primary-btn.list-promote-deal-button
 *       action:  hover
 * @form No form found
 */
abTest('Deals Promote CTA Hover', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['button.list-promote-deal-button'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering List Your Property CTA');
  await page.locator('button.list-promote-deal-button').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Deals — View all on map button hover
 * @selector .new-listings-dropdown-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — "View all on map" button.
 * @interactions
 *   - Hover View on map button
 * @form No form found
 */
abTest('Deals View On Map Hover', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.new-listings-dropdown-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering View all on map');
  await page.locator('button').filter({ hasText: 'View all on map' }).hover();
  await page.waitForTimeout(200);
});

/**
 * @section Deals — 5th deal card hover
 * @selector .deals-card-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — middle of the deal list.
 * @interactions
 *   - Hover 5th deal card (using :nth-of-type strategy)
 * @form No form found
 */
abTest('Deals Fifth Card Hover', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering 5th deal card');
  await page.locator('.deals-card-container').nth(4).hover();
  await page.waitForTimeout(200);
});

/**
 * @section Deals — Destin link in top description hover
 * @selector .deals-description-paragraph
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — "Destin", "30A", "Panama City Beach" links in top
 *            paragraph.
 * @interactions
 *   - Hover Destin link
 * @form No form found
 */
abTest('Deals Destin Link Hover', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-description-paragraph'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Destin link');
  await page.locator('.deals-description-paragraph a').filter({ hasText: 'Destin' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Deals — Panama City Beach link hover
 * @selector .deals-description-paragraph
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — Panama City Beach link.
 * @interactions
 *   - Hover Panama City Beach link
 * @form No form found
 */
abTest('Deals PCB Link Hover', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-description-paragraph'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Panama City Beach link');
  await page.locator('.deals-description-paragraph a').filter({ hasText: 'Panama City Beach' }).first().hover();
  await page.waitForTimeout(200);
});

// ============================================================================
// Pass 3: Sections found via staging cross-reference
// ============================================================================

/**
 * @section Infinite grid deals container
 * @selector .infinite-grid-deals-container
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.15
 * @probed    Pass 3 — .infinite-grid-deals-container (2730px on staging)
 *            wraps the deal cards. Found via staging probe.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Infinite Grid Container', {
  startingPath: '/deals',
  options: {
    visreg: {
      selectors: ['.infinite-grid-deals-container'],
      misMatchThreshold: 0.15,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Deal card image part
 * @selector .deals-card-image-container
 * @viewports all
 * @waitFor   image loaded
 * @threshold 0.1
 * @probed    Pass 3 — 180px image part of deal card. Found via staging.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Card Image Container', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-image-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Deal card text part
 * @selector .deals-card-text-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — 255px text part of deal card with deal info.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Card Text Container', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-text-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Deal card text header (title)
 * @selector .deals-card-text-header
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — header part of deal text. Found via deeper staging probe.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Card Header', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-text-header'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Deal card text date
 * @selector .deals-card-text-date
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — date display in deal card.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Card Date', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-text-date'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Deal card text description
 * @selector .deals-card-text-description
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — description text in deal card.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Card Description', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-text-description'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Deal tag (the orange "Deal" badge)
 * @selector .deals-tag
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — .deals-tag is the visual deal badge.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Deals Tag Badge', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-tag'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Deal card link wrapper
 * @selector .deals-card-link
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.1
 * @probed    Pass 3 — anchor wrapping the entire deal card.
 * @interactions
 *   - Hover deal card link
 * @form No form found
 */
abTest('Deals Card Link Hover', {
  startingPath: '/deals',
  options: { visreg: { selectors: ['.deals-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering deals card link');
  await page.locator('.deals-card-link').first().hover();
  await page.waitForTimeout(200);
});
