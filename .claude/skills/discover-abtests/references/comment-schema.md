# Comment schema for `.abtest.ts` files

The probing work in Phase 2 Step A produces a lot of context: which selectors are mobile-only, why a threshold was chosen, what happened when you clicked a button, what fields a form has and what to fill them with. That context is the audit trail for the test — without it the next person (or the next probing run) has to redo all the probing to understand a single line of test code.

So every generated `.abtest.ts` file follows the same comment shape: a file-level header summarizing cross-test findings, plus a per-test JSDoc block above each `abTest()` call. The comments are written **before** the test bodies (Step B) and **preserved verbatim** when the bodies are filled in (Step C). See SKILL.md for the workflow rules around when each is written and the rule against deleting them.

## File-level header

A `/* ... */` block at the top of the file summarizing cross-test findings — the things that apply to the page as a whole, not to one specific test. This is where A1/A2/A3/A4/A8 summaries live, plus the list of sections this file claimed (so other files can see what's already covered).

## Per-test JSDoc block

Each `abTest()` is preceded by a `/** ... */` JSDoc block with structured `@`-tags. Tags are uniform across tests so the file is greppable (`@selector .map-wrapper` finds every test that captures it) and so a reviewer can scan a test's "spec" without reading code.

These tags are mandatory in **every** JSDoc block — even trivial ones. If probing found nothing for a tag, write the explicit "none" form (`@interactions No interactions found`, `@form No form found`). The empty form is meaningful: it proves probing happened and found nothing, rather than the agent skipping the check.

| Tag             | Required | Contents                                                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@section`      | always   | Human-readable name of what this test covers                                                                              |
| `@selector`     | always   | CSS selector(s) the test screenshots                                                                                      |
| `@viewports`    | always   | `all` or comma list; include `(A8: ...)` if restricted                                                                    |
| `@waitFor`      | always   | What must settle/disappear before the screenshot                                                                          |
| `@threshold`    | always   | Number + one-line reason                                                                                                  |
| `@probed`       | always   | One-line summary of what A1/A2/A3/A6 found relevant to this test                                                          |
| `@interactions` | always   | List of `- Name` items, each with `trigger:`, `action:`, `effect:`. If none, write `@interactions No interactions found`. |
| `@form`         | always   | Header line `@form <scope>`, one `- selector type fill: value` per field, then `submit:` line. If none, write `@form No form found`. |

## Canonical example

```typescript
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Homepage — Gulf Coast Vacation Rentals
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none detected
 * A2 loading:      .skeleton-card (gone after networkidle)
 * A3 animations:   .hero-carousel paused via CSS override (confirmed)
 * A4 sections:     .home-page-hero, .map-wrapper, .featured-property-section,
 *                  .home-ad-banner, .seo-title-container, .home-faq-section,
 *                  .interest-container, .footer-container
 * A8 mobile:       #search-container, .map-wrapper, .featured-property-section
 *                  hidden on phone (375px)
 *                  Mobile-only: .show-on-mobile, .mobile-search-expanded
 * Claimed shared:  footer (only on this file)
 * ========================================================================== */

/**
 * @section Hero
 * @selector .home-page-hero
 * @viewports all
 * @waitFor   networkidle, .skeleton-card gone
 * @threshold 0.05  (dynamic hero image)
 * @probed    A1 no lazy. A6 no interactions inside hero.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Homepage Hero', {
  startingPath: '/',
  options: { visreg: { selectors: ['.home-page-hero'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Contact modal — open + fill + submit
 * @selector .contact-modal
 * @viewports desktop, tablet  (A8: .contact-cta hidden on phone)
 * @waitFor   .contact-modal[aria-hidden="false"]
 * @threshold 0.05
 * @probed    A6 confirmed click opens modal; A7 inspected modal contents.
 *
 * @interactions
 *   - Open modal
 *       trigger: button.contact-cta (button)
 *       action:  click
 *       effect:  .contact-modal slides in from right
 *   - Close modal
 *       trigger: button.close-modal (button)
 *       action:  click
 *       effect:  modal disappears
 *
 * @form .contact-modal form#contact
 *   - input[name="name"]    type=text     fill: "Jane Doe"
 *   - input[name="email"]   type=email    fill: "jane@test.com"
 *   - input[name="phone"]   type=tel      fill: "5551234567"  (numeric only)
 *   - select[name="topic"]  type=select   choose: "Sales"
 *   - textarea[name="msg"]  type=text     fill: "Hello there"
 *   submit: button.submit-btn → success .toast-success appears
 */
abTest('Homepage Contact Modal Submit', {
  startingPath: '/',
  options: { visreg: { selectors: ['.contact-modal'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  // ...test body...
});
```
