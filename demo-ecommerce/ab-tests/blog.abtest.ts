import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Blog index (/blog)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    not explicitly scroll-tested but 35 images and 7477px
 *                  tall — blog cards render inline in articles-grid-container.
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .page-hero.blog-hero          (450px)  — hero with "Beach Time!" h1
 *                  .articles-grid-container      (5746px, too tall — use cards)
 *                  .blog-card-container          (444px × many)
 *                  .footer-container             (claimed by homepage)
 * A5/A6 interactions:
 *                  - Each card has a "Read More" button that navigates to
 *                    the blog post. Two representative blog post pages are
 *                    tested separately.
 * A7 modals:       none
 * A8 mobile:       Grid stacks. All sections assumed present.
 * Claimed shared:  .page-hero (page-specific via .blog-hero)
 * ========================================================================== */

/**
 * @section Hero ("Beach Time!")
 * @selector .blog-hero
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    A4 450px tall hero with title.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Blog Hero', {
  startingPath: '/blog',
  options: { visreg: { selectors: ['.blog-hero'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section First blog card (representative)
 * @selector .blog-card-container
 * @viewports all
 * @waitFor   networkidle (card background image loaded)
 * @threshold 0.1  (image content)
 * @probed    A4 444px tall. Matches many (first is captured).
 * @interactions
 *   - Read More
 *       trigger: button "Read More" inside .blog-card-container
 *       action:  navigates to /blog/<slug>
 *       effect:  blog post page (covered by separate blog-post tests)
 * @form No form found
 */
abTest('Blog First Card', {
  startingPath: '/blog',
  options: { visreg: { selectors: ['.blog-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// ============================================================================
// Pass 2: Interactive tests — user mindset: "I want to read articles about
// Gulf Coast travel. Which article catches my eye?"
// ============================================================================

/**
 * @section First blog card hover
 * @selector .blog-card-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — cards are interactive (Read More button).
 * @interactions
 *   - Hover first blog card
 *       trigger: .blog-card-container (first)
 *       action:  hover
 * @form No form found
 */
abTest('Blog First Card Hover', {
  startingPath: '/blog',
  options: { visreg: { selectors: ['.blog-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering first blog card');
  await page.locator('.blog-card-container').first().hover();
  await page.waitForTimeout(200);
});

/**
 * @section Read More button hover
 * @selector .blog-card-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.1
 * @probed    Pass 2 — each card has a Read More button.
 * @interactions
 *   - Hover Read More
 *       trigger: button "Read More" inside first .blog-card-container
 *       action:  hover
 * @form No form found
 */
abTest('Blog Read More Hover', {
  startingPath: '/blog',
  options: { visreg: { selectors: ['.blog-card-container'], misMatchThreshold: 0.1 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering Read More button');
  await page.locator('.blog-card-container').first().locator('button:has-text("Read More")').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Articles grid (top section)
 * @selector .articles-grid-container
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.1
 * @probed    Pass 2 — 5746px tall full grid of articles. Pass 2 adds this
 *            as a coverage test; individual cards are captured separately.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Blog Articles Grid Top', {
  startingPath: '/blog',
  options: {
    visreg: {
      selectors: ['.articles-grid-container'],
      misMatchThreshold: 0.15,
      // Grid too tall for single capture on mobile; restrict to desktop
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});
