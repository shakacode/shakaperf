/**
 * OVERRIDE CSS
 * Apply this CSS to the loaded page, as a way to override styles.
 *
 * Use this in an onReady script E.G.
  ```
  import overrideCSS from './overrideCSS';

  export default async function onReady(page, scenario) {
    await overrideCSS(page, scenario);
  }
  ```
 */

import type { Page } from 'puppeteer-core';
import type { Scenario } from '../types';

declare global {
  interface Window {
    _styleData: string;
  }
}

const BACKSTOP_TEST_CSS_OVERRIDE = 'html {background-image: none;}';

export default async function overrideCSS(page: Page, scenario: Scenario): Promise<void> {
  // inject arbitrary css to override styles
  await page.evaluate(`window._styleData = '${BACKSTOP_TEST_CSS_OVERRIDE}'`);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.type = 'text/css';
    const styleNode = document.createTextNode(window._styleData);
    style.appendChild(styleNode);
    document.head.appendChild(style);
  });

  console.log('BACKSTOP_TEST_CSS_OVERRIDE injected for: ' + scenario.label);
}
