import type { Page, BrowserContext } from 'playwright-core';
import type { Scenario, Viewport } from '../types';
import { waitUntilPageSettled } from './onReady';

/**
 * Custom onReady script for Products page with Electronics filter selected.
 * Opens the Category dropdown and selects "Electronics".
 */
async function onReadyElectronicsFilter(
  page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  _browserContext: BrowserContext
): Promise<void> {
  console.log('SCENARIO > ' + scenario.label);

  // Wait for page to load
  await page.waitForLoadState('networkidle');

  // Click on the Category dropdown
  await page.click('[data-cy="category-select"]');

  // Wait for dropdown menu to appear
  await page.waitForSelector('[data-cy="category-option-electronics"]', { state: 'visible' });

  // Click on Electronics option
  await page.click('[data-cy="category-option-electronics"]');

  // // Wait for the filter to apply and page to settle
  // await page.waitForLoadState('networkidle');

  // // Small delay to ensure any animations complete
  // await page.waitForTimeout(500);

  await waitUntilPageSettled(page);
}

export default onReadyElectronicsFilter;
module.exports = onReadyElectronicsFilter;
