import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Community pages — discovered via staging probe
 * ----------------------------------------------------------------------------
 * Pattern: /<state>/<area>/<community-name>/<id>
 * Sample: /florida/30a-beaches-south-walton/hidden-highlands/1353
 *
 * NEW page type not in Pass 1 or Pass 2. Sections:
 *   - .c-index-header-container (114px) — community header
 *   - .search-container (88px) — header search
 *   - .breadcrumbs-wrapper (168px)
 *   - .c-index-container — body wrapper
 *   - .community-properties-display-container (185px)
 *   - .community-about-content-wrapper (552px) — community description
 *
 * Buttons: Guests, View Map
 * ========================================================================== */

const COMMUNITY = '/florida/30a-beaches-south-walton/hidden-highlands/1353';

/**
 * @section Community header
 * @selector .c-index-header-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — community-specific header.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Community Hidden Highlands Header', {
  startingPath: COMMUNITY,
  options: { visreg: { selectors: ['.c-index-header-container'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Community breadcrumbs
 * @selector .breadcrumbs-wrapper
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — 168px breadcrumb trail.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Community Hidden Highlands Breadcrumbs', {
  startingPath: COMMUNITY,
  options: { visreg: { selectors: ['.breadcrumbs-wrapper'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Community properties display
 * @selector .community-properties-display-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.1
 * @probed    Pass 3 — 185px container of properties for this community.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Community Hidden Highlands Properties', {
  startingPath: COMMUNITY,
  options: { visreg: { selectors: ['.community-properties-display-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Community about content
 * @selector .community-about-content-wrapper
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — 552px description of the community.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Community Hidden Highlands About', {
  startingPath: COMMUNITY,
  options: { visreg: { selectors: ['.community-about-content-wrapper'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Community — View Map button hover
 * @selector .c-index-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 3 — "View Map" button on community page.
 * @interactions
 *   - Hover View Map
 * @form No form found
 */
abTest('Community Hidden Highlands View Map Hover', {
  startingPath: COMMUNITY,
  options: { visreg: { selectors: ['.c-index-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering View Map');
  await page.locator('button').filter({ hasText: 'View Map' }).first().hover().catch(() => {});
  await page.waitForTimeout(200);
});
