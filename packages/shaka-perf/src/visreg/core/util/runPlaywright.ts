/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import playwright from 'playwright';
import chalk from 'chalk';
import type { Browser, DecoratedCompareConfig } from '../types';

type PlaywrightBrowserType = 'chromium' | 'firefox' | 'webkit';

export async function createPlaywrightBrowser (config: DecoratedCompareConfig) {
  console.log('Creating Browser');

  const { playwrightOptions: sanitizedPlaywrightOptions } = JSON.parse(JSON.stringify(config));
  let { browser: browserChoice } = sanitizedPlaywrightOptions;
  const { headless } = sanitizedPlaywrightOptions;

  if (!browserChoice) {
    console.warn(chalk.yellow('No Playwright browser specified, assuming Chromium.'));
    browserChoice = 'chromium';
  }

  // Fail fast on an unknown `browserChoice` — the bridge config is raw JSON
  // and per-test playwrightOptions overrides merge without zod re-validation,
  // so an unknown browser can reach the engine; returning undefined would only
  // crash later with an unrelated TypeError.
  if (!(playwright[browserChoice as PlaywrightBrowserType])) {
    throw new Error(`Unsupported Playwright browser "${browserChoice}" — use chromium, firefox, or webkit.`);
  }

  const playwrightArgs = Object.assign(
    {},
    sanitizedPlaywrightOptions,
    { headless: typeof headless === 'boolean' ? headless : true }
  );
  return await playwright[browserChoice as PlaywrightBrowserType].launch(playwrightArgs);
};

export async function disposePlaywrightBrowser (browser: Browser) {
  console.log('Disposing Browser');
  await browser.close();
};
