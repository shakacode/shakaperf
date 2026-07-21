/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext, Page } from 'playwright-core';

type BrowserContextWithCDP = BrowserContext & {
  newCDPSession?: (page: Page) => Promise<{
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    detach(): Promise<void>;
  }>;
};

/**
 * Clears browser data without disabling the cache for the measured navigation.
 * These CDP commands need a page-level session; browser-level sessions reject
 * them in Chromium.
 */
export async function clearBrowserData(context: BrowserContext, url: string): Promise<void> {
  const newCDPSession = (context as BrowserContextWithCDP).newCDPSession;
  if (!newCDPSession) return;

  const page = await context.newPage();
  try {
    const session = await newCDPSession.call(context, page);
    try {
      const origin = new URL(url).origin;
      await Promise.all([
        session.send('Network.clearBrowserCache'),
        session.send('Network.clearBrowserCookies'),
        session.send('Storage.clearDataForOrigin', {
          origin,
          storageTypes: 'all',
        }),
      ]);
    } finally {
      await session.detach().catch(() => undefined);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}
