import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Blog posts (2 representative samples)
 * ----------------------------------------------------------------------------
 * Representative: /blog/30a-beaches-in-south-walton-fl, /blog/why-book-direct
 *
 * Blog post template:
 *   - .blog-page-hero            (~280px) — hero banner
 *   - .blog-hero-image           (~285px) — featured image
 *   - .blog-show                 (1875px) — wrapper
 *     - .blog-show-header        (250px)  — title + metadata
 *     - .blog-show-content       (875px)  — article body
 *     - .blog-show-img-container (650px)  — image grid
 *       - .blog-show-img-wrapper (285px)  — each image
 *
 * A1 lazy load:    not probed; 14 images at initial load for 30a post,
 *                  2642px total height.
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A5/A6 interactions: only header search (covered by homepage)
 * A7 modals:       none
 * A8 mobile:       Single-column stack.
 * Claimed shared:  .footer-container from homepage
 * ========================================================================== */

const POSTS = [
  { slug: '30a-beaches-in-south-walton-fl', name: '30A Beaches' },
  { slug: 'why-book-direct', name: 'Why Book Direct' },
];

for (const post of POSTS) {
  /**
   * @section Blog post hero
   * @selector .blog-page-hero
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.05
   * @probed    A4 280px tall hero with post title.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`Blog Post: ${post.name} Hero`, {
    startingPath: `/blog/${post.slug}`,
    options: { visreg: { selectors: ['.blog-page-hero'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Blog post header (title + metadata)
   * @selector .blog-show-header
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.01
   * @probed    A4 250px header block.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`Blog Post: ${post.name} Header`, {
    startingPath: `/blog/${post.slug}`,
    options: { visreg: { selectors: ['.blog-show-header'], misMatchThreshold: 0.01 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Blog post content body
   * @selector .blog-show-content
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.01  (static text article)
   * @probed    A4 varies (875px on 30a post). Contains the article text.
   *            Note: unique class has post ID suffix (e.g.
   *            .blog-show-description-144) but .blog-show-content alone
   *            also matches.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`Blog Post: ${post.name} Content`, {
    startingPath: `/blog/${post.slug}`,
    options: { visreg: { selectors: ['.blog-show-content'], misMatchThreshold: 0.01 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  // ========================================================================
  // Pass 2: Interactive tests — user mindset: "I'm reading an article. I
  // might scroll through the image gallery or click a related link."
  // ========================================================================

  /**
   * @section Blog post full article (header + content)
   * @selector .blog-show
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.01
   * @probed    Pass 2 — full article wrapper for complete coverage.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`Blog Post: ${post.name} Full Article`, {
    startingPath: `/blog/${post.slug}`,
    options: {
      visreg: {
        selectors: ['.blog-show'],
        misMatchThreshold: 0.01,
        viewports: [{ label: 'desktop', width: 1280, height: 800 }],
      },
    },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Blog post image gallery hover
   * @selector .blog-show-img-container
   * @viewports all
   * @waitFor   hover state
   * @threshold 0.05
   * @probed    Pass 2 — blog posts have .blog-show-img-wrapper images that
   *            may be clickable.
   * @interactions
   *   - Hover first blog image
   *       trigger: .blog-show-img-wrapper (first)
   *       action:  hover
   * @form No form found
   */
  abTest(`Blog Post: ${post.name} Image Hover`, {
    startingPath: `/blog/${post.slug}`,
    options: { visreg: { selectors: ['.blog-show-img-container'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('hovering first blog image');
    await page.locator('.blog-show-img-wrapper').first().hover();
    await page.waitForTimeout(200);
  });
}
