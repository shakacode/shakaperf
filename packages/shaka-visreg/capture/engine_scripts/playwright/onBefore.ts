import loadCookies from './loadCookies.js';
import type { PlaywrightPage, Scenario, Viewport, BrowserContext } from '../../../core/types.js';

export default async (_page: PlaywrightPage, scenario: Scenario, _viewport: Viewport, _isReference: boolean, browserContext: BrowserContext) => {
  await loadCookies(browserContext, scenario);
};
