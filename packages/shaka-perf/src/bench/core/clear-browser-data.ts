/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Browser } from 'playwright-core';

export async function clearBrowserData(browser: Browser, url: string): Promise<void> {
  const newBrowserCDPSession = (browser as unknown as {
    newBrowserCDPSession?: () => Promise<{
      send(method: string, params?: Record<string, unknown>): Promise<unknown>;
      detach(): Promise<void>;
    }>;
  }).newBrowserCDPSession;
  if (!newBrowserCDPSession) return;

  const session = await newBrowserCDPSession.call(browser);
  try {
    const origin = new URL(url).origin;
    await Promise.allSettled([
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
}
