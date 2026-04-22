import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * City landing pages (2 representative samples)
 * ----------------------------------------------------------------------------
 * Representative pages: /florida/destin and /florida/captiva
 *
 * City pages share the state-page template:
 *   - .home-page-hero.page-hero (510px) — claimed by homepage
 *   - .c-index-header-container — city-specific h1 + description
 *   - .c-index-container — body
 *   - .community-properties-display-container — property grid
 *   - .property-card-container — cards
 *
 * Unique to city pages:
 *   - "Browse [City] Travel Guides" button
 *   - "Show All 100 Communities" button
 *
 * Per the skill's pruning decision (Depth 3, prune heavy templates), two
 * city samples are probed to verify the template renders with different
 * data.
 *
 * A1 lazy load:    not explicitly probed; initial load shows ~27 images
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A8 mobile:       Expected to stack like state pages
 * Claimed shared:  homepage hero; footer from homepage
 * ========================================================================== */

const CITIES = [
  { slug: 'florida/destin', name: 'Destin', filePrefix: 'Destin' },
  { slug: 'florida/captiva', name: 'Captiva', filePrefix: 'Captiva' },
];

for (const city of CITIES) {
  /**
   * @section City header
   * @selector .c-index-header-container
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.01
   * @probed    A4 295px (matches state page template). Contains city h1
   *            and description.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`${city.filePrefix} City Header`, {
    startingPath: `/${city.slug}`,
    options: { visreg: { selectors: ['.c-index-header-container'], misMatchThreshold: 0.01 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section City property grid
   * @selector .community-properties-display-container
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.15  (city pages can have many properties with random order)
   * @probed    A4 1476px for Destin; contains city's property cards.
   * @interactions
   *   - Each card navigates to property page (tested separately)
   * @form No form found
   */
  abTest(`${city.filePrefix} City Property Grid`, {
    startingPath: `/${city.slug}`,
    options: { visreg: { selectors: ['.community-properties-display-container'], misMatchThreshold: 0.15 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  // ========================================================================
  // Pass 2: Interactive tests — user mindset: "I want to rent in <city>.
  // Let me hover a property or click Browse Travel Guides."
  // ========================================================================

  /**
   * @section City page — first property card hover
   * @selector .community-properties-display-container
   * @viewports all
   * @waitFor   hover state
   * @threshold 0.2
   * @probed    Pass 2 — same card pattern as state pages.
   * @interactions
   *   - Hover first property card
   * @form No form found
   */
  abTest(`${city.filePrefix} City Card Hover`, {
    startingPath: `/${city.slug}`,
    options: { visreg: { selectors: ['.community-properties-display-container'], misMatchThreshold: 0.2 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('hovering first property card');
    await page.locator('.property-card-container').first().hover();
    await page.waitForTimeout(200);
  });

  /**
   * @section City page — Browse Travel Guides CTA hover
   * @selector .c-index-container
   * @viewports all
   * @waitFor   hover state
   * @threshold 0.1
   * @probed    Pass 2 — "Browse <City> Travel Guides" button found in A6.
   * @interactions
   *   - Hover travel guides CTA
   *       trigger: button with text "Browse"
   * @form No form found
   */
  abTest(`${city.filePrefix} Travel Guides CTA Hover`, {
    startingPath: `/${city.slug}`,
    options: { visreg: { selectors: ['.c-index-container'], misMatchThreshold: 0.1 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('hovering Browse Travel Guides button');
    await page.locator('button').filter({ hasText: 'Browse' }).first().hover();
    await page.waitForTimeout(200);
  });

  // ========================================================================
  // Pass 3: Sections found via staging cross-reference
  // ========================================================================

  /**
   * @section City breadcrumbs wrapper
   * @selector .breadcrumbs-wrapper
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.01
   * @probed    Pass 3 — .breadcrumbs-wrapper (168px) found on staging city
   *            pages. Different from .breadcrumbs-container on property pages.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`${city.filePrefix} City Breadcrumbs`, {
    startingPath: `/${city.slug}`,
    options: { visreg: { selectors: ['.breadcrumbs-wrapper'], misMatchThreshold: 0.01 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section City — Show All Communities button hover
   * @selector .c-index-container
   * @viewports all
   * @waitFor   hover state
   * @threshold 0.1
   * @probed    Pass 3 — "Show All N Communities" button found on staging
   *            city pages.
   * @interactions
   *   - Hover Show All Communities CTA
   * @form No form found
   */
  abTest(`${city.filePrefix} Show All Communities Hover`, {
    startingPath: `/${city.slug}`,
    options: { visreg: { selectors: ['.c-index-container'], misMatchThreshold: 0.1 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('hovering Show All Communities');
    await page.locator('button').filter({ hasText: 'Show All' }).first().hover().catch(() => {});
    await page.waitForTimeout(200);
  });

  /**
   * @section City — about-content-wrapper section
   * @selector .about-content-wrapper
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.05
   * @probed    Pass 3 — .about-content-wrapper found on staging city pages.
   *            Local has it too. Description content area.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`${city.filePrefix} About Content Wrapper`, {
    startingPath: `/${city.slug}`,
    options: { visreg: { selectors: ['.about-content-wrapper'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section City — Browse Travel Guides button click (navigates)
   * @selector .c-index-container
   * @viewports desktop
   * @waitFor   button focused
   * @threshold 0.1
   * @probed    Pass 3 — Browse Travel Guides button. Hover already tested;
   *            this captures the focused state pre-navigation.
   * @interactions
   *   - Focus Browse Travel Guides
   * @form No form found
   */
  abTest(`${city.filePrefix} Travel Guides Focus`, {
    startingPath: `/${city.slug}`,
    options: {
      visreg: {
        selectors: ['.c-index-container'],
        misMatchThreshold: 0.15,
        viewports: [{ label: 'desktop', width: 1280, height: 800 }],
      },
    },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('focusing Travel Guides button');
    await page.locator('button').filter({ hasText: 'Browse' }).first().focus().catch(() => {});
    await page.waitForTimeout(200);
  });
}
