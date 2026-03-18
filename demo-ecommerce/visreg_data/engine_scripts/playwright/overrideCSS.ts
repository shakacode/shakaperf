/**
 * OVERRIDE CSS
 * Apply this CSS to the loaded page, as a way to override styles.
 *
 * Usage in an abTest:
  ```
  import overrideCSS from '../visreg_data/engine_scripts/playwright/overrideCSS.ts';

  abTest('My Test', { startingPath: '/' }, async ({ page }) => {
    await overrideCSS(page);
  });
  ```
 */

import type { Page } from 'playwright-core';
import type { Scenario } from 'shaka-visreg/core/types';

const VISREG_TEST_CSS_OVERRIDE = `
  html {
    background-image: none;
  }
`;

export default async function overrideCSS(page: Page, scenario?: Scenario): Promise<void> {
  // inject arbitrary css to override styles
  await page.addStyleTag({
    content: VISREG_TEST_CSS_OVERRIDE
  });

  console.log('VISREG_TEST_CSS_OVERRIDE injected for: ' + (scenario?.label ?? page.url()));
}
