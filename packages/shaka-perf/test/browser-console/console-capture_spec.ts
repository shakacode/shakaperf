/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { chromium, type Browser } from 'playwright';
import { assertConsoleClean, installConsoleCapture } from '../../src/browser-console';

// Pins what Playwright actually delivers, which the mocked unit tests can't:
// first-script-tick output is seen, console.warn arrives as type `warning`.
jest.setTimeout(60_000);

const BOTH = { failOn: ['error', 'warn'] as const, allowList: [] };
const url = (html: string) => `data:text/html,${encodeURIComponent(html)}`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); });
afterAll(async () => { await browser?.close(); });

async function load(html: string) {
  const context = await browser.newContext();
  installConsoleCapture(context, BOTH, 'x');
  const page = await context.newPage();
  await page.goto(url(html));
  return { context, page };
}

it('catches first-script-tick output, ignores log, maps warning to warn', async () => {
  const { context } = await load('<script>console.log("quiet");console.warn("careful")</script>');
  try {
    expect(() => assertConsoleClean(context)).toThrow('console.warn on x: careful');
  } finally { await context.close(); }
});

it('keeps recording across a navigation', async () => {
  const { context, page } = await load('<p>clean</p>');
  try {
    await page.goto(url('<script>console.error("after nav")</script>'));
    expect(() => assertConsoleClean(context)).toThrow('console.error on x: after nav');
  } finally { await context.close(); }
});
