import type { Page, BrowserContext } from 'playwright-core';
import type { Scenario, Viewport } from 'shaka-visreg/core/types';
import loadCookies from './loadCookies.js';

async function onBefore(
  _page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  browserContext: BrowserContext
): Promise<void> {
  await loadCookies(browserContext, scenario);
}

export default onBefore;
