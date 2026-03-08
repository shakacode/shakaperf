import type { BrowserContext, Page } from 'playwright-core';
import type { Scenario, Viewport } from 'shaka-visreg/core/types';
import { waitUntilPageSettled } from './onReady';

async function onReadyAdminWithInteraction(
  page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  browserContext: BrowserContext
): Promise<void> {
  console.log('SCENARIO > ' + scenario.label);

  await browserContext.clearCookies();
  await page.goto(scenario.url);
  await page.waitForLoadState('networkidle');

  const loginFormVisible = await page.locator('[data-cy="admin-login-form"]').isVisible();
  if (!loginFormVisible) {
    throw new Error('Expected admin login form to be visible for interaction-based login scenario.');
  }

  await page.fill('[data-cy="admin-username-input"]', 'admin');
  await page.fill('[data-cy="admin-password-input"]', 'admin');
  await page.click('[data-cy="admin-login-submit"]');

  await page.waitForLoadState('networkidle');

  if (page.url().includes('/admin/login')) {
    throw new Error('Admin login interaction did not navigate away from /admin/login.');
  }

  await page.goto(scenario.url);
  await waitUntilPageSettled(page);
}

export default onReadyAdminWithInteraction;
module.exports = onReadyAdminWithInteraction;
