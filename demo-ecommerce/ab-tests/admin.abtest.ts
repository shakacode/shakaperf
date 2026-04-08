import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Admin Dashboard - Cookie Login', {
  startingPath: '/admin',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
      cookiePath: 'visreg_data/cookies/admin-auth-cookie.json',
    },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for page to fully load with cookie auth');
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/admin/login')) {
    throw new Error('Expected admin auth from cookiePath, but user was redirected to /admin/login.');
  }

  const loginFormVisible = await page.locator('[data-cy="admin-login-form"]').isVisible();
  if (loginFormVisible) {
    throw new Error('Expected authenticated admin session from cookiePath, but login form is visible.');
  }

  annotate('Wait for admin dashboard to settle');
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
}, async ({ page, scenario, annotate }) => {
  annotate('Wait for admin login form to appear');
  await page.locator('[data-cy="admin-login-form"]')
    .waitFor({ state: 'visible', timeout: 4000 });

  annotate('Fill in admin credentials');
  await page.fill('[data-cy="admin-username-input"]', 'admin');
  await page.fill('[data-cy="admin-password-input"]', 'admin');
  annotate('Submit login form');
  await page.click('[data-cy="admin-login-submit"]');
  annotate('Wait for login to complete');
  await page.waitForLoadState('networkidle');

  const url = page.url();
  if (url.includes('/admin/login')) {
    throw new Error('Admin login interaction did not navigate away from /admin/login.');
  }

  annotate('Navigate to admin orders page');
  await page.goto(new URL(scenario.startingPath, url).href);
  annotate('Wait for orders page to settle');
  await waitUntilPageSettled(page);
});
