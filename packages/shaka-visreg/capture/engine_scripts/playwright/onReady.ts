import clickAndHoverHelper from './clickAndHoverHelper.js';
import type { PlaywrightPage, Scenario, Viewport, BrowserContext } from '../../../core/types.js';

export default async (page: PlaywrightPage, scenario: Scenario, _viewport: Viewport, _isReference: boolean, _browserContext: BrowserContext) => {
  console.log('SCENARIO > ' + scenario.label);
  await clickAndHoverHelper(page, scenario);

  // add more ready handlers here...
};
