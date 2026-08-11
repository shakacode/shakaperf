/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Page } from 'playwright-core';
import type { Viewport } from 'shaka-shared';
import type { Group } from '../pipeline/log-prefix-format';

/**
 * Position and size at launch, title once measurement is done — all
 * best-effort, none may fail a completed run.
 *
 * Size only reaches the perf path, and it has to: Lighthouse's
 * `screenEmulation` is a CDP metrics override that resizes the PAGE, and the
 * worker attaches to an already-launched Chrome over CDP, so Playwright never
 * sizes it either. Unsized, that Chrome opens at its fresh-profile default —
 * ~2000px tall on a large display, which dwarfs the viewport and is tall
 * enough that the window manager clamps the `top` offset away. visreg's
 * browser is Playwright-launched and already viewport-sized, so `placeWindow`
 * moves it without touching its size.
 */
export interface WindowPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Window bounds include the tab strip and toolbar; a viewport doesn't. Approximate. */
const CHROME_UI_HEIGHT = 90;
/**
 * Columns are the side, rows are the stage, so none of the four collide — on a
 * screen big enough for the grid. A smaller one clamps them back into overlap:
 * placement is a hint, not a guarantee.
 */
const WINDOW_GAP = 20;

/** `[PERF] cart-page @ desktop` — names the stage, not the side (the URL does that). */
export function formatWindowLabel(
  category: string,
  testName: string,
  viewportLabel: string,
): string {
  return `[${category.toUpperCase()}] ${testName} @ ${viewportLabel}`;
}

export function windowPlacementFor(
  category: 'visreg' | 'perf',
  group: Group,
  viewport: Viewport,
): WindowPlacement {
  const width = viewport.width;
  const height = viewport.height + CHROME_UI_HEIGHT;
  return {
    left: group === 'control' ? 0 : width + WINDOW_GAP,
    top: category === 'perf' ? height + WINDOW_GAP : 0,
    width,
    height,
  };
}

export function chromeWindowFlags(placement: WindowPlacement): string[] {
  return [
    `--window-position=${placement.left},${placement.top}`,
    `--window-size=${placement.width},${placement.height}`,
  ];
}

/**
 * Move an ALREADY-OPEN window — visreg's two sides share one browser, so a
 * launch flag is impossible. Position only: Playwright sized this window to the
 * context's viewport already. Chromium-only; others keep what the WM chose.
 */
export async function placeWindow(page: Page, placement: WindowPlacement): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    try {
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: placement.left, top: placement.top },
      });
    } finally {
      await session.detach().catch(() => undefined);
    }
  } catch {
    // Position must not fail the unit.
  }
}

/** Idempotent. Call ONLY once the window's measurement work is finished. */
export async function labelWindow(page: Page, label: string): Promise<void> {
  try {
    await page.evaluate((windowLabel: string) => {
      if (document.title.startsWith(windowLabel)) return;
      document.title = document.title ? `${windowLabel} — ${document.title}` : windowLabel;
    }, label);
  } catch {
    // The window is still there; only the caption isn't.
  }
}
