import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Global navigation — header and footer interactions
 * ----------------------------------------------------------------------------
 * The header is present on every page. Rather than duplicating nav tests on
 * every page, this file captures header + footer interactions that represent
 * what a user actually clicks:
 *   - Header nav links (Deals, List Your Property, Contact, Blog, Owner Login)
 *   - Header "Activities" external link
 *   - Footer column link hovers
 *   - Footer link clicks for the most common journeys
 *
 * User mindset: "I'm on any page. The first thing I see is the header nav.
 * I might click Deals to find discounts, or Blog to read articles, or
 * List Your Property to sign up as a host."
 *
 * Tests are scoped to selectors that live inside .header-container or
 * .footer-container so they can run from any starting path — using '/' is
 * fine as the header is identical.
 * ========================================================================== */

/**
 * @section Header — Deals & Specials link hover
 * @selector .header-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — a[href="/deals"] in header.
 * @interactions
 *   - Hover Deals link
 * @form No form found
 */
abTest('Header Deals Link Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.header-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Deals link');
  await page.locator('.header-container a[href="/deals"]').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Header — List Your Property link hover
 * @selector .header-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — a[href="/list-your-property"] in header.
 * @interactions
 *   - Hover List Your Property link
 * @form No form found
 */
abTest('Header List Property Link Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.header-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering List Your Property link');
  await page.locator('.header-container a[href="/list-your-property"]').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Header — Owner Login link hover
 * @selector .header-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — owner_login link (external).
 * @interactions
 *   - Hover Owner Login link
 * @form No form found
 */
abTest('Header Owner Login Link Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.header-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Owner Login link');
  await page.locator('.header-container a').filter({ hasText: 'Owner Login' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Header — Activities external link hover
 * @selector .header-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — links to external ECBYO activities site.
 * @interactions
 *   - Hover Activities link
 * @form No form found
 */
abTest('Header Activities Link Hover', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: ['.header-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Activities link');
  await page.locator('.header-container a').filter({ hasText: 'Activities' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Header — Logo hover
 * @selector .header-container
 * @viewports desktop
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — ecbyo logo link (a[href="/"]). Desktop-only since
 *            the mobile variant has a different position.
 *            fixed: restricted to desktop after 1 viewport timeout.
 * @interactions
 *   - Hover logo
 * @form No form found
 */
abTest('Header Logo Hover', {
  startingPath: '/deals',
  options: {
    visreg: {
      selectors: ['.header-container'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering logo (desktop)');
  await page.locator('.header-container a[href="/"]:not(.header-left--mobile)').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Footer — About Us column first link hover
 * @selector .footer-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — footer has About Us, FAQ, Explore columns with links.
 * @interactions
 *   - Hover first link in About Us column
 * @form No form found
 */
abTest('Footer About Link Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.footer-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first footer About Us link');
  await page.locator('.footer-container a').filter({ hasText: 'Our Story' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Footer — Contact Us link hover
 * @selector .footer-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — footer has Contact Us link in Explore column.
 * @interactions
 *   - Hover Contact Us link
 * @form No form found
 */
abTest('Footer Contact Link Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.footer-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Contact Us link');
  await page.locator('.footer-container a').filter({ hasText: 'Contact Us' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Footer — FAQ Travel Guides column hover (second link)
 * @selector .footer-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — replaced Subscribe link (not found in visreg env)
 *            with another footer hover. Footer has List Your Property link.
 * @interactions
 *   - Hover List Your Property link in footer
 * @form No form found
 */
abTest('Footer List Property Link Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.footer-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering List Your Property link in footer');
  await page.locator('.footer-container a[href="/list-your-property"]').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Footer — Travel Guides link hover
 * @selector .footer-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — Travel Guides link in footer FAQ column.
 * @interactions
 *   - Hover Travel Guides link
 * @form No form found
 */
abTest('Footer Travel Guides Link Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.footer-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Travel Guides link');
  await page.locator('.footer-container a').filter({ hasText: 'Travel Guides' }).first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Footer — New Listings link hover
 * @selector .footer-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — New Listings link in Explore column.
 * @interactions
 *   - Hover New Listings link
 * @form No form found
 */
abTest('Footer New Listings Link Hover', {
  startingPath: '/',
  options: { visreg: { selectors: ['.footer-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering New Listings link');
  await page.locator('.footer-container a').filter({ hasText: 'New Listings' }).first().hover();
  await page.waitForTimeout(200);
});
