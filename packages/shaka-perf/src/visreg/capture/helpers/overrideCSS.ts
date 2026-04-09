/**
 * OVERRIDE CSS
 * Apply this CSS to the loaded page, as a way to override styles.
 *
 * Usage in an abTest:
  ```
  import { overrideCSS } from 'shaka-perf/visreg/helpers';

  abTest('My Test', { startingPath: '/' }, async ({ page }) => {
    await overrideCSS(page);
  });
  ```
 */

import type { Page } from 'playwright';
import type { Scenario } from '../../core/types';

const VISREG_TEST_CSS_OVERRIDE = `
  html {
    background-image: none;
  }
`;

export async function overrideCSS(page: Page, scenario?: Scenario): Promise<void> {
  // inject arbitrary css to override styles
  await page.addStyleTag({
    content: VISREG_TEST_CSS_OVERRIDE
  });

  console.log('VISREG_TEST_CSS_OVERRIDE injected for: ' + (scenario?.label ?? page.url()));
}
