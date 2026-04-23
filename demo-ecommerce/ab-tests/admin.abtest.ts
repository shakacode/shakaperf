import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Admin Dashboard - Cookie Login', {
  startingPath: '/admin',
  testTypes: [TestType.VisualRegression],
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
      cookiePath: 'visreg_data/cookies/admin-auth-cookie.json',
    },
  },
}, async ({ page, annotate, testType }) => {
  if (testType !== TestType.VisualRegression) {
    return
  }
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
  startingPath: '/admin/login',
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

  annotate('Click on the Orders list item to navigate to admin orders page');
  await page.locator('span.MuiTypography-root:has-text("Orders")').click();
  annotate('Wait for orders page to settle');
  await waitUntilPageSettled(page);
});
