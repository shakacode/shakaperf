/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { readFileSync } from 'node:fs';
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Admin Dashboard - Cookie Login', {
  startingPath: '/admin',
  testTypes: ['visreg'],
  config: {
    // Per-test viewports are per-category: `visreg` alone would leave the
    // audit pipeline running this test at its own default (desktop + phone).
    visreg: { viewports: ['desktop'] },
    audit: { viewports: ['desktop'] },
    // Seed the admin auth cookie before navigation, on the context, so the
    // first load is already authenticated. Overriding `shared.beforeNavigate`
    // per-test replaces the global hook for this test (this config has none).
    shared: {
      beforeNavigate: async ({ context }) => {
        const cookies = JSON.parse(
          readFileSync('visreg_data/cookies/admin-auth-cookie.json', 'utf-8'),
        );
        await context.addCookies(cookies);
      },
    },
  },
}, async ({ page, annotate, testType }) => {
  if (testType !== 'visreg') {
    return
  }
  annotate('Wait for page to fully load with cookie auth');
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/admin/login')) {
    throw new Error('Expected admin auth from the seeded cookie, but user was redirected to /admin/login.');
  }

  const loginFormVisible = await page.locator('[data-cy="admin-login-form"]').isVisible();
  if (loginFormVisible) {
    throw new Error('Expected authenticated admin session from the seeded cookie, but login form is visible.');
  }

  annotate('Wait for admin dashboard to settle');
  await waitUntilPageSettled(page);
});

abTest('Admin Orders - Form Login Interaction', {
  startingPath: '/admin/login',
  testTypes: ['visreg'],
  config: {
    // Phone-only in every pipeline that runs this test — see the note above.
    visreg: { viewports: ['phone'] },
    audit: { viewports: ['phone'] },
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

  annotate('Open admin orders page');
  await page.locator('span.MuiTypography-root:has-text("Orders")').click();
  annotate('Wait for orders page to settle');
  await waitUntilPageSettled(page);
});
