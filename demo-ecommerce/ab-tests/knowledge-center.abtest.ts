import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * About / Knowledge Center (/about/knowledge-center)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none (11 images, 6582px tall)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .static-page-container-hero (510px)
 *                  .static-page-container-body.about-page (5419px — tall,
 *                   main article content; test targets a sub-section if possible)
 *                  Single big body — use it as-is.
 *                  .footer-container (claimed by homepage)
 * A5/A6 interactions: only header search (covered)
 * A7 modals:       none
 * A8 mobile:       Text reflows.
 * Claimed shared:  .static-page-container-hero would clash with /about —
 *                  but each page's hero has different text/image. Both files
 *                  claim their own via startingPath isolation.
 * ========================================================================== */

/**
 * @section Hero
 * @selector .static-page-container-hero
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 510px hero with h1 "Emerald Coast By Owner — Travel & Vacation
 *            Rental Knowledge Hub".
 * @interactions No interactions found
 * @form No form found
 */
abTest('Knowledge Center Hero', {
  startingPath: '/about/knowledge-center',
  options: { visreg: { selectors: ['.static-page-container-hero'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Body content
 * @selector .about-page
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static article text)
 * @probed    A4 .static-page-container-body.about-page is 5419px tall. Very
 *            long article; single-section capture.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Knowledge Center Body', {
  startingPath: '/about/knowledge-center',
  options: { visreg: { selectors: ['.about-page'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// ============================================================================
// Pass 2: Interactive tests — user mindset: "I'm browsing the knowledge hub.
// Let me scan through the article."
// ============================================================================

/**
 * @section Knowledge center first heading hover (link in TOC-like section)
 * @selector .about-page
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — any internal link within the article body.
 * @interactions
 *   - Hover first article link
 * @form No form found
 */
abTest('Knowledge Center First Link Hover', {
  startingPath: '/about/knowledge-center',
  options: { visreg: { selectors: ['.about-page'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first link in body');
  await page.locator('.about-page a').first().hover();
  await page.waitForTimeout(200);
});

// ============================================================================
// Pass 3: Sections found via staging cross-reference
// ============================================================================

/**
 * @section Knowledge center page header (sub-header below hero)
 * @selector .static-page-container-header
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — .static-page-container-header (96px) found on staging
 *            knowledge-center. Sub-section between hero and body.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Knowledge Center Page Header', {
  startingPath: '/about/knowledge-center',
  options: { visreg: { selectors: ['.static-page-container-header'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Knowledge center static-page wrapper
 * @selector .static-page-container-wrapper
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — full static page content wrapper.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Knowledge Center Page Wrapper', {
  startingPath: '/about/knowledge-center',
  options: {
    visreg: {
      selectors: ['.static-page-container-wrapper'],
      misMatchThreshold: 0.01,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
