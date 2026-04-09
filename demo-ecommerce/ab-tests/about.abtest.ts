import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * About (/about)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none (13 images, 2007px total)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .static-page-container-hero    (510px)  — hero
 *                  .static-page-container-body.about-page (448px) — body text
 *                  .about-page-card-container     (196px)  — feature cards
 *                  .footer-container              (claimed by homepage)
 * A5/A6 interactions:
 *                  - "Explore Properties" button — navigates to search (homepage test covers)
 *                  - "List Your Property" button — navigates (its own test)
 *                  - "Open chat" button — third-party chat widget (Intercom etc.) — skipped
 *                  - "Dismiss" button — chat dismiss, skipped
 * A7 modals:       none opened (chat widget is third-party)
 * A8 mobile:       Grid stacks.
 * Claimed shared:  .static-page-container-hero would be shared but is scoped
 *                  to the page's container. Each static page claims its own.
 * ========================================================================== */

/**
 * @section Hero
 * @selector .static-page-container-hero
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 510px hero with h1 "About Us".
 * @interactions No interactions found
 * @form No form found
 */
abTest('About Hero', {
  startingPath: '/about',
  options: { visreg: { selectors: ['.static-page-container-hero'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Body ("About Us")
 * @selector .about-page
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static marketing text)
 * @probed    A4 .static-page-container-body.about-page, 448px body text.
 * @interactions
 *   - Explore Properties
 *       trigger: button "Explore Properties"
 *       action:  navigates to /search (covered by homepage hero test implicitly)
 *       effect:  navigation
 *   - List Your Property
 *       trigger: button "List Your Property"
 *       action:  navigates to /list-your-property
 *       effect:  navigation
 * @form No form found
 */
abTest('About Body', {
  startingPath: '/about',
  options: { visreg: { selectors: ['.about-page'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Feature cards
 * @selector .about-page-card-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 196px tall grid of 3 cards.
 * @interactions No interactions found
 * @form No form found
 */
abTest('About Cards', {
  startingPath: '/about',
  options: { visreg: { selectors: ['.about-page-card-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
