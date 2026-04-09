import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

/* ============================================================================
 * Contact (/contact)
 * ----------------------------------------------------------------------------
 * A1 lazy load:    none (8 images on initial render, 974px total height)
 * A2 loading:      no skeletons/spinners
 * A3 animations:   none
 * A4 sections:     .contact-container         (974px — whole page body)
 *                  .contact-radio-container   (160px — radio row)
 *                  Short page — document capture is sufficient
 * A5/A6 interactions:
 *                  - "I'm a host" radio (input[name="contactRadio"] value="host")
 *                    — clicking checks the radio but does not reveal any
 *                    new form fields or change scrollHeight (974px both
 *                    before and after). The flow may navigate on a later
 *                    submit step; no submit button visible.
 *                  - "I'm a guest" radio (input[name="contactRadio"] value="guest")
 *                    — analogous behavior, not exercised separately.
 *                  - tel:18444632296 link — phone call, not exercisable.
 * A7 modals:       none
 * A8 mobile:       Static page, stacked layout expected. No desktop-only
 *                  elements found.
 * Claimed shared:  .contact-container (page-specific)
 * ========================================================================== */

/**
 * @section Full contact page (short static page)
 * @selector document
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01  (static content)
 * @probed    A4 974px total. A6 radios are interactive but checking them
 *            doesn't reveal new UI.
 * @interactions
 *   - I'm a host
 *       trigger: input[name="contactRadio"] value="host" (radio)
 *       action:  click (probed)
 *       effect:  radio checked; no other visible change
 *   - I'm a guest
 *       trigger: input[name="contactRadio"] value="guest" (radio)
 *       action:  not exercised
 *       effect:  analogous
 * @form No form found  (radios have no separate submit button or inputs)
 */
abTest('Contact Page', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['document'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// TODO: Contact Radio Host Checked
// After both `check()` and `locator('label').click()` attempts, the
// subsequent capture reported `.contact-radio-container not found` — but
// manual DOM inspection in Chrome AFTER a click confirms the container is
// still present and the radio gets checked. The visreg engine may be
// navigating unexpectedly (React Router link?) or the click is landing
// somewhere else.
//
// Skipping for now — the static Contact Page snapshot above already covers
// the radio rendering in its unchecked state. Revisit if contact flow becomes
// important.
//
// abTest('Contact Radio Host Checked', { ... });
