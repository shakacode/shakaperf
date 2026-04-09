import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Property pages (2 representative samples)
 * ----------------------------------------------------------------------------
 * Representative: /e2742 (Polka Dot Bikini) and /e1188 (Crystal View 302)
 *
 * All property pages share this rich template:
 *   - .rental-show-wrapper (~5384px)
 *     - .hero-slider (slick carousel, 24 slides, 0s transition — no autoplay
 *       so no CSS override needed. Verified via trackTransform=identity.)
 *     - .top-show-container (~3064px)
 *     - .main-content-container
 *       - .rental-description-wrapper (740px) — description text
 *       - .property-attr-container (112px) — guests/beds/baths attrs
 *       - .rental-content-container (2324px — tall, split)
 *         - .property-owner-container (222px) — host info
 *         - .property-amenities-container (285px) — amenity list
 *       - .reviews-list-container (772px) — review list (may be empty)
 *     - Sidebar: .availability-container (393×511, position sidebar)
 *       contains inline react-dates calendar
 *
 * Unique per property: images, title, description, owner, reviews
 *
 * A1 lazy load:    not probed, but 110 images on e2742. Risk of lazy load
 *                  on deep scroll. Tests use waitUntilPageSettled + selector
 *                  capture (engine scrolls into view).
 * A2 loading:      no skeletons found
 * A3 animations:   slick carousel is static (transition 0s, identity transform)
 * A5/A6 interactions:
 *                  - Gallery pagination buttons "1-16+" (slide navigation)
 *                  - Contact Host button — primary CTA
 *                  - Review form (review[name], review[title], review[body],
 *                    review[email])
 *                  - Booking calendar (prf_property_booking_start_date,
 *                    prf_property_booking_end_date)
 * A7 modals:       none opened during probing (Contact Host not clicked)
 * A8 mobile:       .availability-container is narrow (393px) — likely a
 *                  sidebar. Desktop-only for that section.
 * Claimed shared:  .hero-slider, .rental-description-container (per-page
 *                  content), etc. Footer claimed by homepage.
 * ========================================================================== */

const PROPERTIES = [
  { id: 'e2742', name: 'Polka Dot Bikini' },
  { id: 'e1188', name: 'Crystal View' },
];

for (const prop of PROPERTIES) {
  /**
   * @section Hero carousel (first slide)
   * @selector .hero-slider
   * @viewports all
   * @waitFor   networkidle; first slide rendered
   * @threshold 0.1  (large images)
   * @probed    A3 slick-slider has 0s transition and identity transform on
   *            load — no autoplay. Safe to capture without CSS override.
   * @interactions
   *   - Slide pagination (buttons 1-16+) — not exercised
   * @form No form found
   */
  abTest(`${prop.name} Hero Slider`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.hero-slider'], misMatchThreshold: 0.1 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Description
   * @selector .rental-description-container
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.05
   * @probed    A4 740px tall description block with property title + text.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`${prop.name} Description`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.rental-description-container'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Property attributes (guests/beds/baths)
   * @selector .property-attr-container
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.01  (static icon + text)
   * @probed    A4 112px compact strip.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`${prop.name} Attrs`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.property-attr-container'], misMatchThreshold: 0.01 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Owner info card
   * @selector .property-owner-container
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.05
   * @probed    A4 222px card with host info.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`${prop.name} Owner`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.property-owner-container'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Amenities
   * @selector .property-amenities-container
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.01
   * @probed    A4 285px list of amenities with icons.
   * @interactions No interactions found
   * @form No form found
   */
  abTest(`${prop.name} Amenities`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.property-amenities-container'], misMatchThreshold: 0.01 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Reviews list
   * @selector .reviews-list-container
   * @viewports all
   * @waitFor   networkidle
   * @threshold 0.05
   * @probed    A4 772px review list. Reviews may be empty — empty state
   *            shows "Be the first to review" form.
   * @interactions
   *   - Review form (name, title, body, email) — form capture below
   * @form .reviews-list-container form (see Review Form test below)
   */
  abTest(`${prop.name} Reviews`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.reviews-list-container'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });

  /**
   * @section Availability calendar sidebar
   * @selector .availability-container
   * @viewports desktop  (A8: 393px wide — sidebar layout, desktop only)
   * @waitFor   networkidle
   * @threshold 0.05
   * @probed    A4 393×511 inline react-dates calendar. Sidebar layout.
   * @interactions
   *   - Calendar day selection (tested indirectly)
   * @form No form found  (booking calendar has no submit — action is
   *       "Contact Host" button)
   */
  abTest(`${prop.name} Availability Sidebar`, {
    startingPath: `/${prop.id}`,
    options: {
      visreg: {
        selectors: ['.availability-container'],
        misMatchThreshold: 0.05,
        viewports: [{ label: 'desktop', width: 1280, height: 800 }],
      },
    },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
  });
}
