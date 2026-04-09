import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Privacy Policy (/privacy-policy)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none (10 images, 3501px tall)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .privacy-container (3178px — single section)
 *                  .footer-container  (claimed by homepage)
 * A5/A6 interactions: none beyond search header
 * A7 modals:       none
 * A8 mobile:       Text reflows.
 * Claimed shared:  .privacy-container is page-specific
 * ========================================================================== */

/**
 * @section Full privacy policy content
 * @selector .privacy-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static legal text)
 * @probed    A4 3178px tall container.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Privacy Policy Content', {
  startingPath: '/privacy-policy',
  options: { visreg: { selectors: ['.privacy-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
