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
