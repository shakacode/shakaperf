/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import {
  installNetworkTracking,
  waitForNetworkSettle,
} from '../packages/shaka-shared/src/page-helpers/waitForNetworkSettle';

for (const mode of ['standalone', 'tracked', 'tracked after prior idle'] as const) {
  test(`waits for a fetch started before the helper (${mode}) @perf`, async ({ context }) => {
    if (mode !== 'standalone') installNetworkTracking(context);
    const page = await context.newPage();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('https://example.test/data', async route => {
      await pending;
      await route.fulfill({ body: 'Loaded' });
    });
    await page.route('https://example.test/', route => route.fulfill({
      contentType: 'text/html', body: '<html><body>Loading</body></html>',
    }));
    await page.goto('https://example.test/');
    if (mode === 'tracked after prior idle') await waitForNetworkSettle(page);
    const requested = page.waitForEvent('request', request => request.url().endsWith('/data'));
    await page.evaluate(() => {
      void fetch('/data').then(response => response.text()).then(text => {
        document.body.textContent = text;
      });
    });
    await requested;
    let settled = false;
    const waiting = waitForNetworkSettle(page, { timeout: 5_000 }).then(() => { settled = true; });
    try {
      // Longer than the quiet window: the old implementation returned here.
      await page.waitForTimeout(800);
      expect(settled).toBe(false);
    } finally {
      release();
      await waiting;
    }
    await expect(page.locator('body')).toHaveText('Loaded');
  });
}
