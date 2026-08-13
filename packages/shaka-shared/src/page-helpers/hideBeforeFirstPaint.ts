/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';

/**
 * Hide every element matching `selector` before page scripts and first paint.
 *
 * Call this from `beforeNavigate`. The context init script applies to the first
 * navigation, subframes, and every page the context opens afterward.
 */
export async function hideBeforeFirstPaint(
  context: BrowserContext,
  selector: string,
): Promise<void> {
  await context.addInitScript((hiddenSelector) => {
    const style = document.createElement('style');
    style.textContent = `${hiddenSelector} { display: none !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
  }, selector);
}
