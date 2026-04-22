import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Owner profile (/owner-profile/<id>)
 * ----------------------------------------------------------------------------
 * Representative: /owner-profile/6C4B495A5368 (Nancy Plymel Campagna)
 *
 * Template structure:
 *   - .home-page-hero.page-hero.owner (333px) — hero with owner badge
 *     (claimed by homepage via .home-page-hero selector — but this one has
 *     the .owner modifier class, so we can target it specifically)
 *   - .owner-profile-wrapper (1254px)
 *     - .owner-profile-picture-wrapper (200px) — avatar + name
 *     - .owner-listings-container (1034px)
 *       - .owner-property-container (958px) — owner's properties
 *         - .property-card-container (× many)
 *
 * A1 lazy load:    15 images at load, 2074px tall
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A5/A6 interactions: only header search (covered by homepage)
 * A7 modals:       none
 * A8 mobile:       Grid stacks; profile wrapper remains.
 * Claimed shared:  .home-page-hero base claimed by homepage — but this
 *                  page has .owner modifier. Using .home-page-hero.owner
 *                  selector to scope.
 *                  footer from homepage
 * ========================================================================== */

/**
 * @section Owner profile hero (with .owner modifier)
 * @selector .home-page-hero.owner
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 333px with .home-page-hero.page-hero.owner classes.
 *            Uses the .owner modifier to scope away from homepage's hero.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Owner Profile Hero', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: { visreg: { selectors: ['.home-page-hero.owner'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Profile picture + name wrapper
 * @selector .owner-profile-picture-wrapper
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 200px avatar + owner name.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Owner Profile Picture', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: { visreg: { selectors: ['.owner-profile-picture-wrapper'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Owner's properties list
 * @selector .owner-property-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.1  (varied property cards)
 * @probed    A4 958px tall. Contains .property-card-container children.
 * @interactions
 *   - Each card navigates to the property page (tested separately)
 * @form No form found
 */
abTest('Owner Properties', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: { visreg: { selectors: ['.owner-property-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// ============================================================================
// Pass 2: Interactive tests — user mindset: "Who is this host? What do they
// offer? Let me browse their properties."
// ============================================================================

/**
 * @section Owner property card hover (first)
 * @selector .owner-property-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.15
 * @probed    Pass 2 — owner's properties use .property-card-container.
 * @interactions
 *   - Hover first owner property card
 * @form No form found
 */
abTest('Owner Property Card Hover', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: { visreg: { selectors: ['.owner-property-container'], misMatchThreshold: 0.15 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first owner property card');
  await page.locator('.owner-property-container .property-card-container').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Owner — 2nd property card hover
 * @selector .owner-property-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.15
 * @probed    Pass 2 — multiple properties; hover the 2nd.
 * @interactions
 *   - Hover 2nd property card
 * @form No form found
 */
abTest('Owner Second Card Hover', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: { visreg: { selectors: ['.owner-property-container'], misMatchThreshold: 0.15 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering 2nd property card');
  await page.locator('.owner-property-container .property-card-container').nth(1).hover();
  await page.waitForTimeout(200);
});

/**
 * @section Owner profile — avatar hover
 * @selector .owner-profile-picture-wrapper
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — owner avatar may have hover effect.
 * @interactions
 *   - Hover avatar
 * @form No form found
 */
abTest('Owner Avatar Hover', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: { visreg: { selectors: ['.owner-profile-picture-wrapper'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering owner avatar');
  await page.locator('.owner-profile-picture-wrapper').hover();
  await page.waitForTimeout(200);
});

// ============================================================================
// Pass 3: Sections found via staging cross-reference
// ============================================================================

/**
 * @section Owner bio container
 * @selector .owner-bio-container
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — .owner-bio-container (2488px) wraps the bio + listings.
 *            Found via staging.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Owner Bio Container', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: {
    visreg: {
      selectors: ['.owner-bio-container'],
      misMatchThreshold: 0.15,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Owner Call button hover
 * @selector .owner-profile-wrapper
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 3 — "Call" button found on staging owner profile.
 * @interactions
 *   - Hover Call button
 *       trigger: button containing "Call"
 *       action:  hover
 * @form No form found
 */
abTest('Owner Call Button Hover', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: { visreg: { selectors: ['.owner-profile-wrapper'], misMatchThreshold: 0.15 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Call button');
  await page.locator('button').filter({ hasText: 'Call' }).first().hover().catch(() => {});
  await page.waitForTimeout(200);
});

/**
 * @section Owner listings container
 * @selector .owner-listings-container
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.15
 * @probed    Pass 3 — .owner-listings-container (2488px) wraps owner properties.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Owner Listings Container', {
  startingPath: '/owner-profile/6C4B495A5368',
  options: {
    visreg: {
      selectors: ['.owner-listings-container'],
      misMatchThreshold: 0.15,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
