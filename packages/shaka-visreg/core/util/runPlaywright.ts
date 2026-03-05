import playwright from 'playwright';
import chalk from 'chalk';
import type { Browser } from '../types.js';

export async function createPlaywrightBrowser (config: any) {
  console.log('Creating Browser');

  let { engineOptions: sanitizedEngineOptions } = JSON.parse(JSON.stringify(config));
  let { browser: browserChoice, headless } = sanitizedEngineOptions;

  if (!browserChoice) {
    console.warn(chalk.yellow('No Playwright browser specified, assuming Chromium.'));
    browserChoice = 'chromium';
  }

  if (typeof headless === 'string' && headless !== 'new') {
    console.warn(chalk.yellow(`The headless mode, "${headless}", may not be supported by Playwright.`));
  }

  if (!(playwright as any)[browserChoice]) {
    console.error(chalk.red(`Unsupported Playwright browser "${browserChoice}"`));
    return;
  }

  // If headless is a string (e.g. 'new'), suppress Playwright's built-in --headless flag
  // via ignoreDefaultArgs and pass the custom --headless=<value> flag instead.
  // This allows forward-compatible headless modes that Playwright doesn't natively support yet.
  if (typeof headless !== 'undefined' && typeof headless !== 'boolean') {
    sanitizedEngineOptions = {
      ...sanitizedEngineOptions,
      ignoreDefaultArgs: sanitizedEngineOptions.ignoreDefaultArgs ? [...sanitizedEngineOptions.ignoredDefaultArgs, '--headless'] : ['--headless']
    };
    sanitizedEngineOptions.args.push(`--headless=${headless}`);
  }

  const playwrightArgs = Object.assign(
    {},
    sanitizedEngineOptions,
    {
      headless: config.debugWindow
        ? false
        : typeof headless === 'boolean' ? headless : typeof headless === 'string' ? headless === 'new' ? true : headless : true
    }
  );
  return await (playwright as any)[browserChoice].launch(playwrightArgs);
};

export async function disposePlaywrightBrowser (browser: Browser) {
  console.log('Disposing Browser');
  await browser.close();
};
