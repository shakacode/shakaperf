import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from '../visreg_data/engine_scripts/playwright/onReady.ts';

abTest('Admin Dashboard - Cookie Login', {
  startingPath: '/admin',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
      cookiePath: 'visreg_data/engine_scripts/admin-auth-cookie.json',
      onBeforeScript: 'playwright/onBefore.ts',
    },
  },
}, async ({ page }) => {
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/admin/login')) {
    throw new Error('Expected admin auth from cookiePath, but user was redirected to /admin/login.');
  }

  const loginFormVisible = await page.locator('[data-cy="admin-login-form"]').isVisible();
  if (loginFormVisible) {
    throw new Error('Expected authenticated admin session from cookiePath, but login form is visible.');
  }

  await waitUntilPageSettled(page);
});

abTest('Admin Orders - Form Login Interaction', {
  startingPath: '/admin/orders',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, scenario }) => {
  await page.locator('[data-cy="admin-login-form"]')
    .waitFor({ state: 'visible', timeout: 4000 });

  await page.fill('[data-cy="admin-username-input"]', 'admin');
  await page.fill('[data-cy="admin-password-input"]', 'admin');
  await page.click('[data-cy="admin-login-submit"]');
  await page.waitForLoadState('networkidle');

  const url = page.url();
  if (url.includes('/admin/login')) {
    throw new Error('Admin login interaction did not navigate away from /admin/login.');
  }

  await page.goto(new URL(scenario.startingPath, url).href);
  await waitUntilPageSettled(page);
});
