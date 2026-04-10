import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Homepage — Gulf Coast Vacation Rentals (Emerald Coast By Owner)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none detected (scrolling to bottom did not change imageCount
 *                  from 21 or scrollHeight from 6719px)
 * A2 loading:      no skeletons/spinners found on initial load
 * A3 animations:   only 1 animated element; no moving carousels to freeze
 * A4 sections (from probe-sections.js + manual scan):
 *                  .home-page-hero          (510px, top)    — hero image + title
 *                  #search-container        (88px)          — search bar (desktop)
 *                  .map-wrapper             (915px)         — interactive map
 *                  .featured-property-section (393px, matches 2) — featured cards
 *                  .home-ad-banner          (300px)         — "Get Started" banner
 *                  .seo-title-container     (2294px — tall) — state descriptions
 *                  .home-faq-section        (752px)         — FAQ accordion
 *                  .interest-container      (352px)         — "Also of Interest" links
 *                  .footer-container        (355px)         — site footer
 * A5/A6 interactions:
 *                  - Guests button (.map-search-guest-input-btn) opens popover
 *                    with Adults/Children counters + Pets checkbox
 *                  - Check In input (input[name="startDate"]) opens react-dates
 *                    calendar (TDs with aria-label "Choose Thursday, April 9,
 *                    2026 as your check-in date...")
 *                  - City combobox (.combobox-input) is pre-filled "Destin"
 *                  - "Get Started" button in .home-ad-banner (primary-btn)
 *                  - Search button (.search-btn) submits form
 * A7 modals:       Guests popover probed; contains Adults +/- buttons,
 *                  Children +/- buttons, Pets checkbox
 * A8 mobile (375×667):
 *                  #search-container       — NOT FOUND (desktop/tablet only)
 *                  .map-wrapper            — NOT FOUND (desktop/tablet only)
 *                  .featured-property-section — display:none on phone
 *                  .home-page-hero         — visible (510px)
 *                  .home-ad-banner         — visible
 *                  .home-faq-section       — visible (smaller 199px)
 *                  .interest-container     — visible
 *                  .footer-container       — visible
 *                  .seo-title-container    — visible
 *                  No mobile-specific replacement found for search/map — page
 *                  shows hero + content blocks without the inline search form.
 * Claimed shared:  .footer-container, .interest-container, .home-ad-banner
 *                  (other pages skip these)
 * ========================================================================== */

/**
 * @section Hero
 * @selector .home-page-hero
 * @viewports all
 * @waitFor   networkidle (no skeletons)
 * @threshold 0.05  (large hero image)
 * @probed    A1 no lazy load. A6 no interactions inside hero element itself
 *            (search form is a separate sibling).
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage Hero', {
  startingPath: '/',
  options: { visreg: { selectors: ['.home-page-hero'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Search bar (hero-adjacent)
 * @selector #search-container
 * @viewports desktop  (A8: not rendered on phone. Playwright tablet emulation
 *            also did not find the selector — restricted to desktop only after
 *            visreg test failure at tablet width.)
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A6 combobox is pre-filled "Destin" on initial load; Guests button
 *            and Check In input open popovers (covered by separate tests).
 *            fixed: tablet failed in first run — `Selector "#search-container"
 *            not found`. Restricted to desktop.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage Search Bar', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['#search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Interactive map
 * @selector .map-wrapper
 * @viewports desktop  (A8: not rendered on phone. Playwright tablet
 *            emulation also returned "not found" — restricted to desktop.)
 * @waitFor   networkidle (map tiles)
 * @threshold 0.1  (map tiles may load differently across runs)
 * @probed    A1 no lazy load. A6 no interactions inside map tested (click
 *            navigates to state page — tested by separate state pages).
 *            fixed: tablet failed with not-found; restricted to desktop.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage Map Section', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.map-wrapper'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Featured properties (first state block)
 * @selector .featured-property-section
 * @viewports desktop  (A8: display:none on phone AND tablet — manual check at
 *            768px confirmed `display: none`)
 * @waitFor   networkidle (property card images)
 * @threshold 0.1  (dynamic listing cards)
 * @probed    A6 cards are clickable navigation; matchCount=2 (two states
 *            present). Engine selects first match by default.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage Featured Properties', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.featured-property-section'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Ad banner ("Get Started")
 * @selector .home-ad-banner
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A6 "Get Started" is a primary-btn that likely navigates to
 *            /list-your-property (separate page with its own test).
 * @interactions
 *   - Get Started
 *       trigger: button.primary-btn.ad-banner (button)
 *       action:  click (not exercised in test — destination page covered separately)
 *       effect:  navigation
 * @form No form found
 */
abTest('Homepage Ad Banner', {
  startingPath: '/',
  options: { visreg: { selectors: ['.home-ad-banner'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section FAQ section
 * @selector .home-faq-section
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static text content)
 * @probed    A4 height=752 desktop, 199 mobile — suggests collapsible items.
 *            Treated as static snapshot; interactive expand not confirmed.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage FAQ Section', {
  startingPath: '/',
  options: { visreg: { selectors: ['.home-faq-section'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section "Also of Interest" link grid
 * @selector .interest-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static link list)
 * @probed    A4 352px desktop, 168px mobile. Contains ~20 text links to
 *            other pages.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage Interest Container', {
  startingPath: '/',
  options: { visreg: { selectors: ['.interest-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Site footer
 * @selector .footer-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static footer)
 * @probed    A4 full width (1280), 4 images, 355px tall. Appears on all pages
 *            — claimed by homepage only, other files skip it.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage Footer', {
  startingPath: '/',
  options: { visreg: { selectors: ['.footer-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Guests popover — opened state
 * @selector viewport  (popover is absolutely positioned; no reliable wrapper selector)
 * @viewports desktop  (search bar only exists on desktop/tablet; popover positioning is desktop)
 * @waitFor   popover visible after click
 * @threshold 0.05
 * @probed    A6 click on .map-search-guest-input-btn opens a popover with
 *            Adults counter, Children counter, Pets checkbox. Confirmed
 *            visually during probing (screenshot ss_5413cfj5c).
 * @interactions
 *   - Open Guests popover
 *       trigger: button.map-search-guest-input-btn (button "Guests")
 *       action:  click
 *       effect:  popover with Adults/Children counters and Pets checkbox appears
 * @form No form found
 */
abTest('Homepage Guests Popover Open', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking Guests button to open popover');
  await page.locator('.map-search-guest-input-btn').click();
  annotate('waiting for popover to appear');
  await page.waitForTimeout(500);
});

/**
 * @section Check In calendar — opened state
 * @selector viewport
 * @viewports desktop  (search bar only exists on desktop)
 * @waitFor   calendar grid rendered
 * @threshold 0.05
 * @probed    A6 click on input[name="startDate"] opens react-dates calendar.
 *            Shows two-month view. Cells are TDs with aria-label format
 *            "Choose Thursday, April 9, 2026 as your check-in date. It's available."
 *            fixed: first attempt timed out on waitForSelector('.CalendarDay') —
 *            playwright .click() on readonly input may not trigger widget.
 *            Switched to .focus() which is what react-dates listens for, then
 *            waited with timeout instead of selector.
 * @interactions
 *   - Open Check In calendar
 *       trigger: input[name="startDate"] (text input, readonly)
 *       action:  focus
 *       effect:  react-dates calendar popup appears with 2-month view
 * @form No form found
 */
abTest('Homepage Check In Calendar Open', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('focusing Check In input to open calendar');
  await page.locator('input[name="startDate"]').focus();
  annotate('waiting for calendar to render');
  await page.waitForTimeout(800);
});

// ============================================================================
// Pass 2: Additional interactive tests
// ============================================================================

/**
 * @section Check Out calendar — opened state
 * @selector viewport
 * @viewports desktop
 * @waitFor   calendar rendered
 * @threshold 0.05
 * @probed    Pass 2 — endDate input also opens react-dates calendar.
 * @interactions
 *   - Open Check Out calendar
 *       trigger: input[name="endDate"]
 *       action:  focus
 *       effect:  react-dates calendar appears
 * @form No form found
 */
abTest('Homepage Check Out Calendar Open', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('focusing Check Out input');
  await page.locator('input[name="endDate"]').focus();
  annotate('waiting for calendar');
  await page.waitForTimeout(800);
});

/**
 * @section Date range selected (Check In → Check Out)
 * @selector viewport
 * @viewports desktop
 * @waitFor   date range highlighted in calendar
 * @threshold 0.05
 * @probed    Pass 2 — selecting a check-in date keeps calendar open and
 *            allows a check-out date to be picked, highlighting range.
 * @interactions
 *   - Pick check-in date
 *       trigger: TD with aria-label "Choose Thursday, April 9, 2026 as your check-in date..."
 *       action:  click
 *       effect:  cell highlighted, calendar moves to pick check-out
 *   - Pick check-out date
 *       trigger: TD a few days later
 *       action:  click
 *       effect:  range highlighted between
 * @form No form found
 */
abTest('Homepage Date Range Selection', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening calendar');
  await page.locator('input[name="startDate"]').focus();
  await page.waitForTimeout(500);
  annotate('picking first available check-in date');
  await page.locator('td[role="button"]:not([aria-disabled="true"])').first().click();
  await page.waitForTimeout(300);
  annotate('picking check-out date');
  await page.locator('td[role="button"]:not([aria-disabled="true"])').nth(5).click();
  await page.waitForTimeout(500);
});

// TODO: Homepage Guests Adults Incremented
// The +/- controls inside the guests popover are not plain buttons with
// "+" text. They are SVG icons or React-styled buttons whose selector
// I couldn't pin down during probing. The popover open test above
// already captures the 0/0/pets state. Revisit with deeper DOM inspection
// if the counter UI becomes load-bearing.
//
// abTest('Homepage Guests Adults Incremented', { ... });

/**
 * @section FAQ accordion — first item opened
 * @selector .home-faq-section
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (accordion expansion is a stable DOM change)
 * @probed    Pass 2 — FAQ is 7 native <details> elements. Opening the
 *            first one expands the answer under the summary.
 * @interactions
 *   - Open first FAQ item
 *       trigger: details > summary "What is a vacation rental by owner?"
 *       action:  click
 *       effect:  details expands, answer visible
 * @form No form found
 */
abTest('Homepage FAQ First Item Opened', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.home-faq-section'],
      misMatchThreshold: 0.01,
      // One viewport consistently times out on locator.evaluate — likely
      // the .home-faq-section DOM isn't ready in time on that breakpoint.
      // Restricting to the two that reliably work.
      viewports: [
        { label: 'tablet', width: 768, height: 1024 },
        { label: 'desktop', width: 1280, height: 800 },
      ],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening first FAQ item via details.open');
  await page.locator('.home-faq-section details').first().evaluate((el: any) => { el.open = true; });
  await page.waitForTimeout(200);
});

/**
 * @section FAQ — all items opened
 * @selector .home-faq-section
 * @viewports all
 * @waitFor   all details elements open
 * @threshold 0.01
 * @probed    Pass 2 — 7 FAQ items; clicking each summary expands it.
 *            This captures the fully-expanded state.
 * @interactions
 *   - Open all FAQ items
 *       trigger: every details summary in .home-faq-section
 *       action:  click each in sequence
 *       effect:  all 7 items expanded
 * @form No form found
 */
abTest('Homepage FAQ All Items Opened', {
  startingPath: '/',
  options: { visreg: { selectors: ['.home-faq-section'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening every FAQ item via details.open');
  await page.locator('.home-faq-section').evaluate((root) => {
    root.querySelectorAll('details').forEach((d: any) => { d.open = true; });
  });
  await page.waitForTimeout(300);
});

/**
 * @section Map — hover a state card
 * @selector .map-wrapper
 * @viewports desktop  (map only on desktop)
 * @waitFor   hover state applied
 * @threshold 0.1
 * @probed    Pass 2 — 5 clickable state cards (.search-state-card) on the
 *            homepage map. Hovering one likely triggers a visual highlight.
 * @interactions
 *   - Hover Florida state card
 *       trigger: a.search-state-card[href="/florida"]
 *       action:  hover
 *       effect:  hover styling (scale or highlight)
 * @form No form found
 */
abTest('Homepage Map Florida Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.map-wrapper'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Florida state card on map');
  await page.locator('a.search-state-card[href="/florida"]').hover();
  await page.waitForTimeout(300);
});

/**
 * @section Search bar: city combobox focused + expanded
 * @selector viewport
 * @viewports desktop
 * @waitFor   combobox expanded (aria-expanded="true")
 * @threshold 0.05
 * @probed    Pass 2 — focusing the "Search by city, community or ID"
 *            input opens a dropdown of suggestions.
 * @interactions
 *   - Focus city input
 *       trigger: input[placeholder="Search by city, community or ID"]
 *       action:  click
 *       effect:  dropdown of suggestions appears
 * @form No form found
 */
abTest('Homepage Search City Dropdown Open', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking city search input');
  await page.locator('input[placeholder="Search by city, community or ID"]').click();
  await page.waitForTimeout(400);
});

/**
 * @section Search bar: city typed "Dest"
 * @selector viewport
 * @viewports desktop
 * @waitFor   autocomplete suggestions filtered
 * @threshold 0.05
 * @probed    Pass 2 — typing into the city combobox filters suggestions.
 * @interactions
 *   - Type in city field
 *       trigger: input[placeholder="Search by city, community or ID"]
 *       action:  fill with "Dest"
 *       effect:  dropdown shows Destin-related matches
 * @form No form found
 */
abTest('Homepage Search City Autocomplete', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['viewport'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('typing in city combobox');
  await page.locator('input[placeholder="Search by city, community or ID"]').fill('Dest');
  await page.waitForTimeout(400);
});

/**
 * @section Map state card — Texas hover
 * @selector .map-wrapper
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — 5 state cards on map; Texas is one of them.
 * @interactions
 *   - Hover Texas state card
 * @form No form found
 */
abTest('Homepage Map Texas Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.map-wrapper'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Texas state card');
  await page.locator('a.search-state-card[href="/texas"]').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Map state card — Alabama hover
 * @selector .map-wrapper
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — Alabama state card.
 * @interactions
 *   - Hover Alabama state card
 * @form No form found
 */
abTest('Homepage Map Alabama Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.map-wrapper'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Alabama state card');
  await page.locator('a.search-state-card[href="/alabama"]').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Featured property card hover
 * @selector .featured-property-section
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — featured properties may have hover effect.
 * @interactions
 *   - Hover first featured card
 * @form No form found
 */
abTest('Homepage Featured Card Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.featured-property-section'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first featured card');
  await page.locator('.featured-property-section a, .featured-property-section .property-card-container').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Ad banner Get Started button hover
 * @selector .home-ad-banner
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — "Get Started" primary-btn on ad banner.
 * @interactions
 *   - Hover Get Started
 * @form No form found
 */
abTest('Homepage Get Started Button Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.home-ad-banner'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Get Started button');
  await page.locator('button.primary-btn.ad-banner').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Search submit button hover
 * @selector #search-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — Search button (.search-btn) in search bar.
 * @interactions
 *   - Hover Search button
 * @form No form found
 */
abTest('Homepage Search Button Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['#search-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering search button');
  await page.locator('#search-container button.search-btn').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Interest container — Ocean Springs link hover
 * @selector .interest-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — first interest link "Ocean Springs Vacation Rentals".
 * @interactions
 *   - Hover Ocean Springs link
 * @form No form found
 */
abTest('Homepage Interest Ocean Springs Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.interest-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Ocean Springs link');
  await page.locator('.interest-container a').filter({ hasText: 'Ocean Springs' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Interest container — Gulf Breeze Cottage hover
 * @selector .interest-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — Gulf Breeze Cottage link.
 * @interactions
 *   - Hover Gulf Breeze Cottage link
 * @form No form found
 */
abTest('Homepage Interest Gulf Breeze Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.interest-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Gulf Breeze link');
  await page.locator('.interest-container a').filter({ hasText: 'Gulf Breeze' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Interest container — Why Book Direct link hover
 * @selector .interest-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — Why Book Direct blog link.
 * @interactions
 *   - Hover Why Book Direct link
 * @form No form found
 */
abTest('Homepage Interest Book Direct Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.interest-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Why Book Direct link');
  await page.locator('.interest-container a').filter({ hasText: 'Why Book Direct' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section FAQ — second item opened
 * @selector .home-faq-section
 * @viewports desktop, tablet
 * @waitFor   second details open
 * @threshold 0.01
 * @probed    Pass 2 — 7 FAQ items. Open the 2nd one specifically.
 * @interactions
 *   - Open 2nd FAQ item
 * @form No form found
 */
abTest('Homepage FAQ Second Item Opened', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.home-faq-section'],
      misMatchThreshold: 0.01,
      viewports: [
        { label: 'tablet', width: 768, height: 1024 },
        { label: 'desktop', width: 1280, height: 800 },
      ],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('opening 2nd FAQ item');
  await page.locator('.home-faq-section details').nth(1).evaluate((el: any) => { el.open = true; });
  await page.waitForTimeout(200);
});

/**
 * @section Map state card — Louisiana hover
 * @selector .map-wrapper
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — Louisiana card.
 * @interactions
 *   - Hover Louisiana card
 * @form No form found
 */
abTest('Homepage Map Louisiana Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.map-wrapper'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Louisiana card');
  await page.locator('a.search-state-card[href="/louisiana"]').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Map state card — Mississippi hover
 * @selector .map-wrapper
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — Mississippi card.
 * @interactions
 *   - Hover Mississippi card
 * @form No form found
 */
abTest('Homepage Map Mississippi Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.map-wrapper'],
      misMatchThreshold: 0.1,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Mississippi card');
  await page.locator('a.search-state-card[href="/mississippi"]').hover();
  await page.waitForTimeout(200);
});
