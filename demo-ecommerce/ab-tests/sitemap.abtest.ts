import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Sitemap (/sitemap)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none (mostly text links, 10 images, 65406px total)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .sitemap-container (64859px — HUGE, full link index)
 *                  Single very tall section; capture the container directly
 *                  rather than 'document' to avoid auto-scroll failure.
 * A5/A6 interactions: only header search (covered by homepage)
 * A7 modals:       none
 * A8 mobile:       Text reflows to single column.
 * Claimed shared:  .sitemap-container is page-specific
 * ========================================================================== */

/**
 * @section Full sitemap link list
 * @selector .sitemap-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static text list — no images in body)
 * @probed    A4 64859px tall single container with all internal links.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Sitemap Content', {
  startingPath: '/sitemap',
  options: { visreg: { selectors: ['.sitemap-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
