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

// ============================================================================
// Pass 3: Sections found via staging cross-reference
// ============================================================================

/**
 * @section Contact radio wrapper (parent of radio container)
 * @selector .contact-radio-wrapper
 * @viewports all
 * @waitFor   networkidle
 * @threshold 0.01
 * @probed    Pass 3 — .contact-radio-wrapper (200px) wraps .contact-radio-container.
 *            Found via staging probe.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Contact Radio Wrapper', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-radio-wrapper'], misMatchThreshold: 0.01 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Contact layout left (contact info side)
 * @selector .contact-layout-left
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — found in initial DOM probe but never tested.
 *            Contact page has left/right layout split.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Contact Layout Left', {
  startingPath: '/contact',
  options: {
    visreg: {
      selectors: ['.contact-layout-left'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

/**
 * @section Contact layout right (radio buttons side)
 * @selector .contact-layout-right
 * @viewports desktop
 * @waitFor   networkidle
 * @threshold 0.05
 * @probed    Pass 3 — right side of contact page layout.
 * @interactions No interactions found
 * @form No form found
 */
abTest('Contact Layout Right', {
  startingPath: '/contact',
  options: {
    visreg: {
      selectors: ['.contact-layout-right'],
      misMatchThreshold: 0.05,
      viewports: [{ label: 'desktop', width: 1280, height: 800 }],
    },
  },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
});

// ============================================================================
// Pass 3: HUGE finding — selecting a contact radio reveals a full form!
// ============================================================================

/**
 * @section Contact form revealed after selecting "I'm a host"
 * @selector .contact-form
 * @viewports all
 * @waitFor   .contact-form visible
 * @threshold 0.05
 * @probed    Pass 3 — confirmed via staging probe (and verified on local):
 *            clicking the host radio reveals .contact-form (546px) with 6
 *            form fields: firstName, lastName, email, phone, propertyId,
 *            message + Cancel and Submit buttons. Pass 1 and Pass 2 missed
 *            this entirely.
 * @interactions
 *   - Select "I'm a host" radio
 *       trigger: input#contact-host-radio
 *       action:  click via JS (radio.click() actually fires React event here)
 *       effect:  .contact-form becomes visible with all fields
 * @form .contact-form
 *   - input[name="firstName"] type=text   placeholder="First Name"
 *   - input[name="lastName"]  type=text   placeholder="Last Name"
 *   - input[name="email"]     type=email  placeholder="Email Address"
 *   - input[name="phone"]     type=number placeholder="Phone"
 *   - input[name="propertyId"] type=text  placeholder="Property ID"
 *   - textarea[name="message"] type=text  placeholder="Message"
 *   submit: button "Submit"
 *   cancel: button "Cancel"
 */
abTest('Contact Form Revealed', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-form'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking host radio to reveal form');
  await page.locator('#contact-host-radio').evaluate((el: any) => { el.click(); });
  await page.waitForTimeout(400);
});

/**
 * @section Contact form — all fields filled
 * @selector .contact-form
 * @viewports all
 * @waitFor   all inputs populated
 * @threshold 0.05
 * @probed    Pass 3 — fills all 6 form fields after revealing the form.
 * @interactions
 *   - Select host radio then fill every field
 * @form See Contact Form Revealed test above
 */
abTest('Contact Form All Fields Filled', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-form'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('selecting host radio');
  await page.locator('#contact-host-radio').evaluate((el: any) => { el.click(); });
  await page.waitForTimeout(400);
  annotate('filling first name');
  await page.locator('input[name="firstName"]').fill('Jane');
  annotate('filling last name');
  await page.locator('input[name="lastName"]').fill('Doe');
  annotate('filling email');
  await page.locator('input[name="email"]').fill('jane@example.com');
  annotate('filling phone (numeric only for type=number)');
  await page.locator('input[name="phone"]').fill('5551234567');
  annotate('filling property ID');
  await page.locator('input[name="propertyId"]').fill('e2742');
  annotate('filling message');
  await page.locator('textarea[name="message"]').fill('Hi, I am interested in this property.');
  await page.waitForTimeout(300);
});

/**
 * @section Contact form — Submit button hover
 * @selector .contact-form
 * @viewports all
 * @waitFor   Submit visible
 * @threshold 0.05
 * @probed    Pass 3 — Submit button at the bottom of the form.
 * @interactions
 *   - Select radio then hover Submit
 * @form See Contact Form Revealed test
 */
abTest('Contact Form Submit Hover', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-form'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('selecting host radio');
  await page.locator('#contact-host-radio').evaluate((el: any) => { el.click(); });
  await page.waitForTimeout(400);
  annotate('hovering Submit button');
  await page.locator('.contact-form button:has-text("Submit")').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Contact form — Cancel button hover
 * @selector .contact-form
 * @viewports all
 * @waitFor   Cancel visible
 * @threshold 0.05
 * @probed    Pass 3 — Cancel button next to Submit.
 * @interactions
 *   - Select radio then hover Cancel
 * @form See Contact Form Revealed test
 */
abTest('Contact Form Cancel Hover', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-form'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('selecting host radio');
  await page.locator('#contact-host-radio').evaluate((el: any) => { el.click(); });
  await page.waitForTimeout(400);
  annotate('hovering Cancel button');
  await page.locator('.contact-form button:has-text("Cancel")').hover();
  await page.waitForTimeout(200);
});

/**
 * @section Contact form — guest variant revealed
 * @selector .contact-form
 * @viewports all
 * @waitFor   form visible
 * @threshold 0.05
 * @probed    Pass 3 — selecting "I'm a guest" also reveals the form
 *            (likely the same form).
 * @interactions
 *   - Select "I'm a guest" radio
 * @form See Contact Form Revealed test
 */
abTest('Contact Form Guest Revealed', {
  startingPath: '/contact',
  options: { visreg: { selectors: ['.contact-form'], misMatchThreshold: 0.05 } },
}, async ({ page, annotate }) => {
  annotate('waiting for page to settle');
  await waitUntilPageSettled(page);
  annotate('clicking guest radio');
  await page.locator('#contact-guest-radio').evaluate((el: any) => { el.click(); });
  await page.waitForTimeout(400);
});
