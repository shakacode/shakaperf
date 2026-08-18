/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';

import playwright from 'playwright';
import chalk from 'chalk';
import type { Browser, EngineBrowserConfig } from '../types';

type PlaywrightBrowserType = 'chromium' | 'firefox' | 'webkit';

// Playwright's own "Executable doesn't exist" error suggests `npx playwright
// install`, which resolves whatever Playwright the current project has — not
// the one bundled with shaka-perf. Browsers downloaded that way land under a
// different build number and leave this error in place, so the hint must name
// this package's CLI by path. (`cli.js` is not in Playwright's `exports` map,
// so it is reachable only relative to the package root.)
function buildMissingBrowserError (browserChoice: string, originalMessage: string): Error {
  const playwrightDir = path.dirname(require.resolve('playwright/package.json'));
  const { version } = require('playwright/package.json') as { version: string };
  const installCommand = `node "${path.join(playwrightDir, 'cli.js')}" install ${browserChoice}`;
  return new Error([
    originalMessage.split('\n')[0],
    '',
    `The "${browserChoice}" build for the Playwright bundled with shaka-perf (v${version})`,
    'has not been downloaded yet — this happens after shaka-perf is installed or updated.',
    'Download it with:',
    '',
    `    ${installCommand}`,
    '',
    "Note: `npx playwright install` run from a project installs browsers for that",
    "project's own Playwright version and will NOT fix this error.",
  ].join('\n'));
}

export async function createPlaywrightBrowser (config: EngineBrowserConfig) {
  console.log('Creating Browser');

  const { playwrightOptions: sanitizedPlaywrightOptions } = JSON.parse(JSON.stringify(config));
  let { browser: browserChoice } = sanitizedPlaywrightOptions;

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

  // Visibility comes from `--headed` alone — `playwrightOptions.headless` is
  // rejected by the config schema, so there is nothing here to reconcile.
  const playwrightArgs = Object.assign(
    {},
    sanitizedPlaywrightOptions,
    { headless: !config.headed }
  );
  try {
    return await playwright[browserChoice as PlaywrightBrowserType].launch(playwrightArgs);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      throw buildMissingBrowserError(browserChoice, error.message);
    }
    throw error;
  }
};

export async function disposePlaywrightBrowser (browser: Browser) {
  console.log('Disposing Browser');
  await browser.close();
};
