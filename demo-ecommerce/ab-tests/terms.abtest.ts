import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Terms & Conditions (/terms)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none (10 images, 8097px tall — mostly text)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .terms-container  (7774px — very tall single section)
 *                  .footer-container (claimed by homepage)
 *                  Tall static legal text — single capture of terms-container.
 * A5/A6 interactions: none beyond the search-btn in header (homepage covered)
 * A7 modals:       none
 * A8 mobile:       Text reflows.
 * Claimed shared:  .terms-container is page-specific
 * ========================================================================== */

/**
 * @section Full terms content
 * @selector .terms-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static legal text)
 * @probed    A4 .container.full-page-width.terms-container is 7774px tall.
 *            Single block; capture as-is.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Terms Content', {
  startingPath: '/terms',
  options: { visreg: { selectors: ['.terms-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
