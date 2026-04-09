import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * List Your Property (/list-your-property)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    33 images all present on load
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none moving
 * A4 sections:     .static-page-container-hero   (510px)  — hero
 *                  .list-your-prop-container-desc (441px) — description + images
 *                  .list-your-prop-container-list (814px) — feature list
 *                  .benefits-card-container       (800px) — benefits grid
 *                  .integrations-container        (2111px — too tall, split below)
 *                  .integrations-btn-container    (68px)  — "Show All" button row
 *                  .footer-container              (claimed by homepage)
 * A5/A6 interactions:
 *                  - "List Your Property" primary-btn — redirects to signup
 *                    (skipped: no signup page discovered in crawl)
 *                  - "Show All Integrations" secondary-btn — click did not
 *                    visibly change the integrations-container height (still
 *                    2111px) or item count. Skipping as unconfirmed.
 * A7 modals:       none
 * A8 mobile:       Tablet probe 768px showed all sections rendering. Phone
 *                  not explicitly probed (window still 768); assuming stack
 *                  layout, same selectors present.
 * Claimed shared:  page-specific sections (nothing shared outside footer)
 * ========================================================================== */

/**
 * @section Hero section
 * @selector .static-page-container-hero
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 510px hero with background image + h1 "List Your Property with ECBYO".
 * @interactions
 *   - List Your Property CTA
 *       trigger: button.primary-btn.list-your-prop-btn (button "List Your Property")
 *       action:  not clicked during probing — destination unknown
 *       effect:  unknown
 * @form No form found
 */
abTest('List Your Property Hero', {
  startingPath: '/list-your-property',
  options: { visreg: { selectors: ['.static-page-container-hero'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Description block
 * @selector .list-your-prop-container-desc
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 441px, "Reach the travelers you are looking for".
 * @interactions No interactions found
 * @form No form found
 */
abTest('List Your Property Description', {
  startingPath: '/list-your-property',
  options: { visreg: { selectors: ['.list-your-prop-container-desc'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Features list
 * @selector .list-your-prop-container-list
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    A4 814px, list of features (Photos, Direct communication, etc.)
 * @interactions No interactions found
 * @form No form found
 */
abTest('List Your Property Features List', {
  startingPath: '/list-your-property',
  options: { visreg: { selectors: ['.list-your-prop-container-list'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Benefits card grid
 * @selector .benefits-card-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 800px grid of benefit cards.
 * @interactions No interactions found
 * @form No form found
 */
abTest('List Your Property Benefits', {
  startingPath: '/list-your-property',
  options: { visreg: { selectors: ['.benefits-card-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Integrations button row
 * @selector .integrations-btn-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 68px tall, contains "Show All Integrations" button.
 *            Click did not visibly alter the page — not exercised in test.
 * @interactions
 *   - Show All Integrations
 *       trigger: button.secondary-btn.list-your-prop-btn
 *       action:  click (attempted in probing)
 *       effect:  no visible change to integrations-container dimensions;
 *                possibly an accessibility-only toggle. Not exercised.
 * @form No form found
 */
abTest('List Your Property Integrations Button', {
  startingPath: '/list-your-property',
  options: { visreg: { selectors: ['.integrations-btn-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
