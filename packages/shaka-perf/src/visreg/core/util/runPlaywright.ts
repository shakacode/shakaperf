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

  const { engineOptions: sanitizedEngineOptions } = JSON.parse(JSON.stringify(config));
  let { browser: browserChoice } = sanitizedEngineOptions;
  const { headless } = sanitizedEngineOptions;

  if (!browserChoice) {
    console.warn(chalk.yellow('No Playwright browser specified, assuming Chromium.'));
    browserChoice = 'chromium';
  }

  // Error when using unknown `browserChoice`
  if (!(playwright[browserChoice as PlaywrightBrowserType])) {
    console.error(chalk.red(`Unsupported Playwright browser "${browserChoice}"`));
    return;
  }

  const playwrightArgs = Object.assign(
    {},
    sanitizedEngineOptions,
    { headless: typeof headless === 'boolean' ? headless : true }
  );
  return await playwright[browserChoice as PlaywrightBrowserType].launch(playwrightArgs);
};

export async function disposePlaywrightBrowser (browser: Browser) {
  console.log('Disposing Browser');
  await browser.close();
};
