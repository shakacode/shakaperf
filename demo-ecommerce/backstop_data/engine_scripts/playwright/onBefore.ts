import type { Page, BrowserContext } from 'playwright-core';
import type { Scenario, Viewport } from '../types';

module.exports = async (
  _page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  browserContext: BrowserContext
): Promise<void> => {
  await require('./loadCookies')(browserContext, scenario);
};
