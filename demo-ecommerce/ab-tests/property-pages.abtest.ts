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

  // ========================================================================
  // Pass 2: Interactive tests
  // ========================================================================

  /**
   * @section Description — "Read More" expanded
   * @selector .rental-description-container
   * @viewports all
   * @waitFor   description expanded
   * @threshold 0.05
   * @probed    Pass 2 — description is truncated with a "Read More" affordance.
   *            Probing showed it's a DIV, not a button (querySelector returned
   *            DIV with text "Read More"). Need to click the div itself.
   *            fixed: switched from button:has-text to generic locator by text.
   * @interactions
   *   - Read More
   *       trigger: div containing text "Read More" in .rental-description-container
   *       action:  click
   *       effect:  full description text revealed
   * @form No form found
   */
  abTest(`${prop.name} Description Expanded`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.rental-description-container'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking Read More via getByText');
    await page.locator('.rental-description-container').getByText('Read More', { exact: true }).click();
    await page.waitForTimeout(300);
  });

  /**
   * @section Gallery — second slide via dot click
   * @selector .hero-slider
   * @viewports all
   * @waitFor   slide 2 active
   * @threshold 0.1
   * @probed    Pass 2 — 24 slick-dots. Clicking the 2nd dot changes the
   *            displayed slide.
   * @interactions
   *   - Click 2nd gallery dot
   *       trigger: .slick-dots li:nth-child(2) button
   *       action:  click
   *       effect:  gallery advances to slide 2
   * @form No form found
   */
  abTest(`${prop.name} Gallery Slide 2`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.hero-slider'], misMatchThreshold: 0.1 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking second gallery dot');
    await page.locator('.slick-dots li').nth(1).click();
    await page.waitForTimeout(500);
  });

  /**
   * @section Gallery — fifth slide via dot click
   * @selector .hero-slider
   * @viewports all
   * @waitFor   slide 5 active
   * @threshold 0.1
   * @probed    Pass 2 — clicking deeper dot jumps multiple slides.
   * @interactions
   *   - Click 5th gallery dot
   *       trigger: .slick-dots li:nth-child(5)
   *       action:  click
   *       effect:  gallery displays slide 5 image
   * @form No form found
   */
  abTest(`${prop.name} Gallery Slide 5`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.hero-slider'], misMatchThreshold: 0.1 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking fifth gallery dot');
    await page.locator('.slick-dots li').nth(4).click();
    await page.waitForTimeout(500);
  });

  /**
   * @section Write A Review modal — opened
   * @selector .property-review-form
   * @viewports all
   * @waitFor   modal visible (.property-review-form ancestor loses .hidden)
   * @threshold 0.05
   * @probed    Pass 2 — confirmed in Chrome via ref_504 click. The review
   *            form lives inside `.modal-container.hidden > .property-review-form`
   *            and is only visible after clicking "Write A Review". Contains
   *            Name input, Rating stars (react-stars, 3 pre-selected), Title,
   *            Review textarea, Email.
   * @interactions
   *   - Open review modal
   *       trigger: button.rectangle-btn "Write A Review"
   *       action:  click
   *       effect:  .modal-container wrapping .property-review-form loses .hidden,
   *                modal becomes visible
   * @form .property-review-form (inside modal)
   *   - input[name="review[name]"]  type=text    placeholder="Full Name"
   *   - react-stars div              rating=3 default, clickable stars
   *   - input[name="review[title]"] type=text    placeholder="Title"
   *   - textarea[name="review[body]"] type=text  placeholder="Write a review"
   *   - input[name="review[email]"] type=email   placeholder="Email"
   *   submit: form has no visible submit button in the probed state
   */
  abTest(`${prop.name} Write Review Modal Open`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.property-review-form'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking Write A Review to open modal');
    await page.locator('button:has-text("Write A Review")').click();
    annotate('waiting for modal');
    await page.waitForTimeout(500);
  });

  /**
   * @section Write A Review modal — form filled
   * @selector .property-review-form
   * @viewports all
   * @waitFor   all fields populated
   * @threshold 0.05
   * @probed    Pass 2 — after opening modal, fields are accessible at the
   *            names above. Filled state captures the populated form UI.
   * @interactions
   *   - Open review modal then fill all fields
   * @form .property-review-form
   *   - input[name="review[name]"]   fill: "Jane Doe"
   *   - input[name="review[title]"]  fill: "Great stay!"
   *   - textarea[name="review[body]"] fill: "Lovely property..."
   *   - input[name="review[email]"]  fill: "jane@example.com"
   */
  abTest(`${prop.name} Review Form Filled In Modal`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.property-review-form'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('opening Write A Review modal');
    await page.locator('button:has-text("Write A Review")').click();
    await page.waitForTimeout(400);
    annotate('filling name');
    await page.locator('input[name="review[name]"]').fill('Jane Doe');
    annotate('filling title');
    await page.locator('input[name="review[title]"]').fill('Great stay!');
    annotate('filling body');
    await page.locator('textarea[name="review[body]"]').fill('Lovely property, highly recommend.');
    annotate('filling email');
    await page.locator('input[name="review[email]"]').fill('jane@example.com');
    await page.waitForTimeout(300);
  });

  /**
   * @section Show All Reviews modal — opened
   * @selector .all-reviews-container
   * @viewports all
   * @waitFor   modal visible
   * @threshold 0.05
   * @probed    Pass 2 — .modal-container > .all-reviews-container is hidden
   *            initially. "Show All Reviews" button toggles it visible.
   * @interactions
   *   - Open all reviews modal
   *       trigger: button.rectangle-btn "Show All Reviews"
   *       action:  click
   *       effect:  all-reviews-container modal becomes visible
   * @form No form found
   */
  abTest(`${prop.name} Show All Reviews Modal`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.all-reviews-container'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking Show All Reviews');
    await page.locator('button:has-text("Show All Reviews")').click();
    await page.waitForTimeout(500);
  });

  /**
   * @section Show All Amenities modal — opened
   * @selector .amenities-modal
   * @viewports all
   * @waitFor   modal visible
   * @threshold 0.05
   * @probed    Pass 2 — "Show all 55 amenities" button (.rectangle-btn.amenities)
   *            opens .amenities-modal from the hidden modal-container.
   * @interactions
   *   - Open amenities modal
   *       trigger: button.rectangle-btn.amenities
   *       action:  click
   *       effect:  amenities-modal becomes visible with full list
   * @form No form found
   */
  abTest(`${prop.name} Show All Amenities Modal`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.amenities-modal'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking Show all amenities');
    await page.locator('button.rectangle-btn.amenities').click();
    await page.waitForTimeout(500);
  });

  /**
   * @section Share Property modal — opened
   * @selector .share-modal
   * @viewports all
   * @waitFor   modal visible
   * @threshold 0.05
   * @probed    Pass 2 — button[aria-label="Share Property"] with class
   *            .property-action opens .share-modal.
   * @interactions
   *   - Open share modal
   *       trigger: button[aria-label="Share Property"]
   *       action:  click
   *       effect:  share-modal becomes visible
   * @form No form found
   */
  abTest(`${prop.name} Share Property Modal`, {
    startingPath: `/${prop.id}`,
    options: {
      visreg: {
        selectors: ['.share-modal'],
        misMatchThreshold: 0.05,
        // Share button may be hidden or repositioned on phone
        viewports: [
          { label: 'tablet', width: 768, height: 1024 },
          { label: 'desktop', width: 1280, height: 800 },
        ],
      },
    },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking Share Property button');
    await page.locator('button[aria-label="Share Property"]').click();
    await page.waitForTimeout(500);
  });

  /**
   * @section Image gallery lightbox — opened
   * @selector .image-modal
   * @viewports all
   * @waitFor   image-modal visible
   * @threshold 0.1
   * @probed    Pass 2 — clicking the first hero-slider slide opens the
   *            .image-modal lightbox (fullscreen view).
   * @interactions
   *   - Open image lightbox
   *       trigger: first .slick-slide image (clickable)
   *       action:  click
   *       effect:  full-screen image modal appears
   * @form No form found
   */
  abTest(`${prop.name} Image Lightbox`, {
    startingPath: `/${prop.id}`,
    options: {
      visreg: {
        selectors: ['.image-modal'],
        misMatchThreshold: 0.1,
        // Lightbox trigger may not work on phone
        viewports: [
          { label: 'tablet', width: 768, height: 1024 },
          { label: 'desktop', width: 1280, height: 800 },
        ],
      },
    },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('clicking first gallery slide');
    await page.locator('.slick-slide.slick-active img').first().click();
    await page.waitForTimeout(500);
  });

  /**
   * @section Availability calendar — next month
   * @selector .availability-container
   * @viewports desktop
   * @waitFor   next month displayed
   * @threshold 0.05
   * @probed    Pass 2 — .DayPickerNavigation_button (5 nav buttons).
   *            Clicking "next" advances the displayed month.
   * @interactions
   *   - Next month
   *       trigger: .DayPickerNavigation_button next (aria-label contains "next")
   *       action:  click
   *       effect:  calendar shows following month
   * @form No form found
   */
  abTest(`${prop.name} Availability Next Month`, {
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
    annotate('clicking next month in availability calendar');
    await page.locator('.availability-container .DayPickerNavigation_button').nth(1).click();
    await page.waitForTimeout(400);
  });

  /**
   * @section Booking — check-in date picked
   * @selector .availability-container
   * @viewports desktop
   * @waitFor   check-in selected
   * @threshold 0.05
   * @probed    Pass 2 — clicking input[name="prf_property_booking_start_date"]
   *            opens the calendar inline (it's already visible in sidebar).
   *            Clicking an available day cell selects it.
   * @interactions
   *   - Pick booking start date
   *       trigger: first .CalendarDay:not([aria-disabled="true"])
   *       action:  click
   *       effect:  day highlighted
   * @form .availability-container booking form
   *   - input[name="prf_property_booking_start_date"] type=text placeholder="Check In"
   *   - input[name="prf_property_booking_end_date"]   type=text placeholder="Check Out"
   *   submit: "Contact Host" button (not clicked in this test)
   */
  abTest(`${prop.name} Booking Start Date Selected`, {
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
    annotate('focusing check-in input');
    await page.locator('input[name="prf_property_booking_start_date"]').focus();
    await page.waitForTimeout(400);
    annotate('clicking first available calendar day');
    await page.locator('.availability-container .CalendarDay:not(.CalendarDay__blocked_calendar):not([aria-disabled="true"])').first().click();
    await page.waitForTimeout(300);
  });

  /**
   * @section Amenities list hover (first item)
   * @selector .property-amenities-container
   * @viewports all
   * @waitFor   hover state applied
   * @threshold 0.05
   * @probed    Pass 2 — 18 amenity items. Each is a list entry.
   * @interactions
   *   - Hover first amenity
   *       trigger: .property-amenities-container > *:first-child
   *       action:  hover
   * @form No form found
   */
  abTest(`${prop.name} Amenity Hover`, {
    startingPath: `/${prop.id}`,
    options: { visreg: { selectors: ['.property-amenities-container'], misMatchThreshold: 0.05 } },
  }, async ({ page, annotate }) => {
    annotate('waiting for page to settle');
    await waitUntilPageSettled(page);
    annotate('hovering first amenity item');
    await page.locator('.property-amenities-container > *').first().hover();
    await page.waitForTimeout(200);
  });
}
