/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { chromium, firefox, webkit } from 'playwright-core';
import type { Browser, BrowserContextOptions, LaunchOptions } from 'playwright-core';
import type { FormFactor } from 'shaka-shared';
import type { PlaywrightOptions } from '../config';
import { applyRealChrome, realChromeMobileEmulation } from './real-chrome';

// The single browser launch shared by every audit stage that drives Playwright:
// engine selection (chromium/firefox/webkit) with the real-Chrome overrides
// applied on the chromium branch, and the `--headed` override folded in. Every
// key besides `browser` passes through to Playwright's `launch()` — the same
// contract as the visreg engine — so `proxy`, `executablePath`, etc. behave
// identically across stages. The Lighthouse worker is the deliberate
// exception — it launches Chrome via chrome-launcher and attaches Playwright
// over CDP, so it cannot go through here.
export function launchStageBrowser(
  options: PlaywrightOptions,
  headed = false,
): Promise<Browser> {
  const { browser, ...passthrough } = options;
  const launchOptions: LaunchOptions = {
    ...passthrough,
    headless: headed ? false : options.headless ?? true,
  };
  if (browser === 'firefox') return firefox.launch(launchOptions);
  if (browser === 'webkit') return webkit.launch(launchOptions);
  if (browser === 'chromium') return chromium.launch(applyRealChrome(launchOptions));
  // Unreachable via the zod-validated config (enum), but bridge/persisted
  // configs bypass zod — fail fast like the visreg engine does.
  throw new Error(
    `Unsupported Playwright browser "${String(browser)}" — use chromium, firefox, or webkit.`,
  );
}

// The viewport fields a stage's measured-page context is built from.
export interface StageContextViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
  formFactor: FormFactor;
}

// The shared `newContext` options for a stage's measured page: viewport, device
// scale, the mobile flag, and the real-Chrome mobile emulation. Keeps the
// accessibility and agent-readiness rendered contexts identical.
export function stageContextOptions(
  viewport: StageContextViewport,
): BrowserContextOptions {
  return {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.formFactor === 'mobile',
    // Real-Chrome only: serve the phone layout (no-op headless).
    ...realChromeMobileEmulation(viewport.formFactor),
  };
}
