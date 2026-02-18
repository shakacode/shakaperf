import type { BrowserContext, Page } from 'playwright-core';
import type { Scenario, Viewport } from '../types';
import { waitUntilPageSettled } from './onReady';

async function onReadyAdminWithCookie(
  page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  _browserContext: BrowserContext
): Promise<void> {
  console.log('SCENARIO > ' + scenario.label);

  await page.waitForLoadState('networkidle');

  if (page.url().includes('/admin/login')) {
    throw new Error('Expected admin auth from cookiePath, but user was redirected to /admin/login.');
  }

  const loginFormVisible = await page.locator('[data-cy="admin-login-form"]').isVisible();
  if (loginFormVisible) {
    throw new Error('Expected authenticated admin session from cookiePath, but login form is visible.');
  }

  await waitUntilPageSettled(page);
}

export default onReadyAdminWithCookie;
module.exports = onReadyAdminWithCookie;
