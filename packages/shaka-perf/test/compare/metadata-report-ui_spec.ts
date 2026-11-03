/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { renderReportHtml } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';

jest.setTimeout(60_000);

describe.each(['compare', 'audit'] as const)('%s card metadata', (pipeline) => {
  let server: Server;
  let browser: Browser;
  let page: Page;
  let url: string;
  let data = runDetailsFixture(pipeline);

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(renderReportHtml(data));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(async () => {
    data = runDetailsFixture(pipeline);
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(url);
  });
  afterEach(async () => page.close());

  it('hides metadata by default and keeps nested source, paths and the modal usable', async () => {
    const card = page.locator('[data-report-test-id="homepage"]');
    const metadata = card.locator('.card__metadata');
    expect(await metadata.count()).toBe(1);
    expect(await metadata.getAttribute('open')).toBeNull();
    expect(await card.locator('.card__path').isVisible()).toBe(false);
    expect(await card.locator('.card__urls').isVisible()).toBe(false);
    await metadata.locator('summary').first().click();
    expect(await card.locator('.card__path').isVisible()).toBe(true);
    expect(await card.locator('.card__urls').isVisible()).toBe(true);
    expect(await metadata.getByText('1e04e038', { exact: true }).count()).toBe(1);
    const source = metadata.getByRole('button', { name: 'test source' });
    expect(await source.getAttribute('aria-expanded')).toBe('false');
    await source.click();
    expect(await metadata.getByText("abTest('Homepage'", { exact: false }).isVisible()).toBe(true);
    await metadata.getByRole('button', { name: 'artifact paths' }).click();
    expect(await metadata.getByText('desktop: results/homepage-desktop').isVisible()).toBe(true);
    expect(await card.locator('.card__body').getByRole('button', { name: /source|paths|troubleshoot/ }).count()).toBe(0);
    await card.getByRole('button', { name: 'Run details', exact: true }).click();
    expect(await page.getByRole('dialog').isVisible()).toBe(true);
    expect(await page.getByRole('dialog').getByRole('heading', { name: 'Applications' }).isVisible()).toBe(true);
    expect(await metadata.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth && Array.from(el.querySelectorAll('*')).every((child) => child.getBoundingClientRect().right <= window.innerWidth))).toBe(true);
  });

  it('copies the newest saved command even when outcomes arrive in reverse time order', async () => {
    const latest = data.tests[0]!.outcomes[1]!.runMetadata!;
    latest.command = `shaka-perf ${pipeline} --filter 'Homepage' --categories accessibility`;
    data.tests[0]!.outcomes.reverse();
    await page.reload();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { document.body.dataset.copied = value; } }, configurable: true });
    });
    const metadata = page.locator('[data-report-test-id="homepage"] .card__metadata');
    await metadata.locator('summary').first().click();
    expect(await metadata.getByLabel('Latest command').inputValue()).toBe(latest.command);
    await metadata.getByRole('button', { name: 'Copy command' }).click();
    await page.waitForFunction(() => document.body.dataset.copied !== undefined);
    expect(await page.locator('body').getAttribute('data-copied')).toBe(latest.command);
    const legacy = page.locator('[data-report-test-id="legacy"] .card__metadata');
    await legacy.locator('summary').first().click();
    expect(await legacy.getByText('Latest command unavailable').isVisible()).toBe(true);
    expect(await legacy.getByLabel('Latest command').count()).toBe(0);
  });

  it('selects the full command when clipboard access is unavailable', async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    });
    const metadata = page.locator('[data-report-test-id="homepage"] .card__metadata');
    await metadata.locator('summary').first().click();
    await metadata.getByRole('button', { name: 'Copy command' }).click();
    const field = metadata.getByLabel('Latest command');
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    expect(await field.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(await field.inputValue());
    expect(await metadata.getByRole('status').innerText()).toContain('copy manually');
  });
});
