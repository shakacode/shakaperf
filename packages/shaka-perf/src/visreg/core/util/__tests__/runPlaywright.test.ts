/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';

jest.mock('playwright', () => ({
  __esModule: true,
  default: {
    chromium: { launch: jest.fn() },
    firefox: { launch: jest.fn() },
    webkit: { launch: jest.fn() },
  },
}));

import playwright from 'playwright';
import { createPlaywrightBrowser } from '../runPlaywright';
import type { DecoratedCompareConfig } from '../../types';

const launchMock = playwright.chromium.launch as jest.Mock;

function config (playwrightOptions: Record<string, unknown> = {}): DecoratedCompareConfig {
  return { playwrightOptions: { browser: 'chromium', ...playwrightOptions } } as unknown as DecoratedCompareConfig;
}

// Mirrors the real error thrown by browserType.launch when the browser build
// pinned by the installed Playwright version was never downloaded.
const MISSING_EXECUTABLE_MESSAGE = [
  "browserType.launch: Executable doesn't exist at /home/user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell",
  '╔════════════════════════════════════════════════════════════╗',
  '║ Looks like Playwright was just installed or updated.       ║',
  '║ Please run the following command to download new browsers: ║',
  '║                                                            ║',
  '║     npx playwright install                                 ║',
  '║                                                            ║',
  '║ <3 Playwright Team                                         ║',
  '╚════════════════════════════════════════════════════════════╝',
].join('\n');

beforeEach(() => {
  launchMock.mockReset();
});

describe('createPlaywrightBrowser', () => {
  it('rewrites the missing-executable error to target the bundled Playwright CLI', async () => {
    launchMock.mockRejectedValue(new Error(MISSING_EXECUTABLE_MESSAGE));

    const promise = createPlaywrightBrowser(config());
    // The suggested command must point into the Playwright package shaka-perf
    // itself resolves — the whole point is to not send users to `npx
    // playwright install`, which targets their project's Playwright instead.
    const playwrightDir = path.dirname(require.resolve('playwright/package.json'));
    await expect(promise).rejects.toThrow(path.join(playwrightDir, 'cli.js'));
    await expect(promise).rejects.toThrow('install chromium');
    await expect(promise).rejects.toThrow("Executable doesn't exist at /home/user/.cache/ms-playwright");
    // Playwright's boxed banner (whose advice the rewrite exists to replace)
    // must not survive — only the first line of the original error is kept.
    await expect(promise).rejects.not.toThrow('<3 Playwright Team');
  });

  it('passes launch errors through unchanged when the executable exists', async () => {
    launchMock.mockRejectedValue(new Error('browserType.launch: Timeout 180000ms exceeded'));

    await expect(createPlaywrightBrowser(config())).rejects.toThrow(
      'browserType.launch: Timeout 180000ms exceeded'
    );
  });

  it('returns the launched browser and defaults headless to true', async () => {
    const browser = { close: jest.fn() };
    launchMock.mockResolvedValue(browser);

    await expect(createPlaywrightBrowser(config())).resolves.toBe(browser);
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  });

  it('rejects unknown browser choices before launching', async () => {
    await expect(createPlaywrightBrowser(config({ browser: 'chrome' }))).rejects.toThrow(
      'Unsupported Playwright browser "chrome"'
    );
    expect(launchMock).not.toHaveBeenCalled();
  });
});
