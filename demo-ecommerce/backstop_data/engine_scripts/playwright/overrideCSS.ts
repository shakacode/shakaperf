/**
 * OVERRIDE CSS
 * Apply this CSS to the loaded page, as a way to override styles.
 *
 * Use this in an onReady script E.G.
  ```
  module.exports = async function(page, scenario) {
    await require('./overrideCSS')(page, scenario);
  }
  ```
 *
 */

import type { Page } from 'playwright-core';
import type { Scenario } from '../types';

const BACKSTOP_TEST_CSS_OVERRIDE = `
  html {
    background-image: none;
  }
`;

module.exports = async (page: Page, scenario: Scenario): Promise<void> => {
  // inject arbitrary css to override styles
  await page.addStyleTag({
    content: BACKSTOP_TEST_CSS_OVERRIDE
  });

  console.log('BACKSTOP_TEST_CSS_OVERRIDE injected for: ' + scenario.label);
};
