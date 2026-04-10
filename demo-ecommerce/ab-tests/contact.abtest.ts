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

// ============================================================================
// Pass 2: Interactive tests
// ============================================================================

/**
 * @section Contact page — "I'm a host" selected
 * @selector .contact-container
 * @viewports all
 * @waitFor   radio checked
 * @threshold 0.05
 * @probed    Pass 2 — radios have IDs (#contact-host-radio, #contact-guest-radio).
 *            Using direct input.click() via evaluate avoids label-click issues
 *            seen in the first pass.
 * @interactions
 *   - I'm a host
 *       trigger: input#contact-host-radio
 *       action:  .click() via evaluate
 *       effect:  radio checked; visible dot appears
 * @form No form found
 */
abTest('Contact Host Radio Selected', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('checking host radio via direct JS click');
  await page.locator('#contact-host-radio').evaluate((el: any) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
});

/**
 * @section Contact page — "I'm a guest" selected
 * @selector .contact-container
 * @viewports all
 * @waitFor   radio checked
 * @threshold 0.05
 * @probed    Pass 2 — same as host radio, different value.
 * @interactions
 *   - I'm a guest
 *       trigger: input#contact-guest-radio
 *       action:  .click() via evaluate
 *       effect:  radio checked
 * @form No form found
 */
abTest('Contact Guest Radio Selected', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('checking guest radio via direct JS click');
  await page.locator('#contact-guest-radio').evaluate((el: any) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
});

/**
 * @section Contact page — phone number link hover
 * @selector .contact-container
 * @viewports all
 * @waitFor   hover state applied
 * @threshold 0.05
 * @probed    Pass 2 — a[href="tel:18444632296"] exists; hovering could
 *            reveal an underline or styling change.
 * @interactions
 *   - Hover phone link
 *       trigger: a[href="tel:18444632296"]
 *       action:  hover
 * @form No form found
 */
abTest('Contact Phone Link Hover', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering phone link');
  await page.locator('a[href="tel:18444632296"]').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Contact — Host radio hover
 * @selector .contact-radio-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — hovering the label should show hover state.
 * @interactions
 *   - Hover I'm a host label
 * @form No form found
 */
abTest('Contact Host Radio Hover', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-radio-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering host radio label');
  await page.locator('label[for="contact-host-radio"]').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Contact — Guest radio hover
 * @selector .contact-radio-container
 * @viewports all
 * @waitFor   hover state
 * @threshold 0.05
 * @probed    Pass 2 — hovering the label should show hover state.
 * @interactions
 *   - Hover I'm a guest label
 * @form No form found
 */
abTest('Contact Guest Radio Hover', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-radio-container'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('hovering guest radio label');
  await page.locator('label[for="contact-guest-radio"]').hover();
  await page.waitForTimeout(200);
});
