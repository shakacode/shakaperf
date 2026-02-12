import type { Page, BrowserContext } from 'playwright-core';
import type { Scenario, Viewport } from '../types';

module.exports = async (
  page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  _browserContext: BrowserContext
): Promise<void> => {
  console.log('SCENARIO > ' + scenario.label);
  await require('./clickAndHoverHelper')(page, scenario);

  // add more ready handlers here...
};
