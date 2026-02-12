import type { Page, BrowserContext } from 'playwright-core';
import type { Scenario, Viewport } from '../types';
import clickAndHoverHelper from './clickAndHoverHelper';

async function onReady(
  page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  _browserContext: BrowserContext
): Promise<void> {
  console.log('SCENARIO > ' + scenario.label);
  await clickAndHoverHelper(page, scenario);

  // add more ready handlers here...
}

export default onReady;
module.exports = onReady;
