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

  it('uses one collapsed-by-default content area with keyboard disclosures', async () => {
    const metadata = page.locator('[data-report-test-id="homepage"] .card__metadata');
    await metadata.locator('summary').first().click();
    const buttons = metadata.locator('.card__metadata-controls button');
    expect(await buttons.count()).toBe(4);
    const positions = await buttons.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
    expect(new Set(positions).size).toBe(1);
    expect(await buttons.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('aria-expanded') === 'false'))).toBe(true);
    const command = metadata.getByRole('button', { name: 'command', exact: true });
    await command.press('Enter');
    expect(await metadata.getByText('Latest command', { exact: true }).isVisible()).toBe(true);
    const panelId = await command.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    for (const name of ['test source', 'troubleshoot', 'artifact paths']) {
      const button = metadata.getByRole('button', { name, exact: true });
      expect(await button.getAttribute('aria-controls')).toBe(panelId);
      await button.press('Space');
      expect(await metadata.locator('.card__metadata-controls button[aria-expanded="true"]').count()).toBe(1);
      expect(await metadata.getByLabel('Latest command').count()).toBe(0);
    }
    await metadata.getByRole('button', { name: 'artifact paths', exact: true }).press('Enter');
    expect(await metadata.locator('.card__metadata-controls button[aria-expanded="true"]').count()).toBe(0);
    expect(await metadata.locator('.card__metadata-panel').isVisible()).toBe(false);
  });

  it('hides metadata by default and keeps nested source, paths and the modal usable', async () => {
    const card = page.locator('[data-report-test-id="homepage"]');
    const metadata = card.locator('.card__metadata');
    expect(await metadata.count()).toBe(1);
    expect(await metadata.getAttribute('open')).toBeNull();
    expect(await card.locator('.card__path').isVisible()).toBe(false);
    expect(await card.getByLabel('URLs', { exact: true }).isVisible()).toBe(false);
    await metadata.locator('summary').first().click();
    expect(await card.locator('.card__path').isVisible()).toBe(true);
    expect(await card.getByLabel('URLs', { exact: true }).isVisible()).toBe(true);
    expect(await metadata.getByText('1e04e038', { exact: true }).count()).toBe(pipeline === 'compare' ? 2 : 1);
    expect(await metadata.locator('.card__targets dt').allTextContents()).toEqual(pipeline === 'compare' ? ['control', 'experiment'] : ['url']);
    const source = metadata.getByRole('button', { name: 'test source' });
    expect(await source.getAttribute('aria-expanded')).toBe('false');
    await source.click();
    await metadata.getByText("abTest('Homepage'", { exact: false }).waitFor({ state: 'visible' });
    await metadata.getByRole('button', { name: 'artifact paths' }).click();
    expect(await metadata.getByText('desktop: results/homepage-desktop').isVisible()).toBe(true);
    expect(await card.locator('.card__body').getByRole('button', { name: /source|paths|troubleshoot/ }).count()).toBe(0);
    await card.getByRole('button', { name: 'Metadata details', exact: true }).click();
    expect(await page.getByRole('dialog').isVisible()).toBe(true);
    expect(await page.getByRole('dialog').getByRole('heading', { name: 'Applications' }).isVisible()).toBe(true);
    expect(await metadata.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth && Array.from(el.querySelectorAll('*')).every((child) => child.getBoundingClientRect().right <= window.innerWidth))).toBe(true);
  });

  it.each([1440, 1050, 390])('groups target details by card width at %i px', async (width) => {
    await page.setViewportSize({ width, height: 1100 });
    const card = page.locator('[data-report-test-id="homepage"]');
    const metadata = card.locator('.card__metadata');
    await metadata.locator('summary').first().click();
    const rows = metadata.locator('.card__targets > div');
    const verifyLayout = async () => {
      const wide = (await card.boundingBox())!.width >= 900;
      const label = (await rows.first().locator('dt').boundingBox())!;
      const value = (await rows.first().locator('dd').boundingBox())!;
      if (wide) {
        expect(value.y).toBeGreaterThan(label.y);
        expect(Math.abs(value.x - label.x)).toBeLessThan(1);
        if (pipeline === 'compare') {
          const second = (await rows.nth(1).boundingBox())!;
          expect(second.x).toBeGreaterThan(value.x);
          expect(Math.abs(second.y - label.y)).toBeLessThan(1);
        }
      } else {
        expect(value.x).toBeGreaterThan(label.x);
        expect(Math.abs(value.y - label.y)).toBeLessThan(1);
      }
      expect(await metadata.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    };
    await verifyLayout();
    // Exercise both layouts in the same viewport: the container controls the choice.
    await card.evaluate((el) => { (el.parentElement as HTMLElement).style.gridTemplateColumns = 'minmax(0, 1fr)'; });
    await verifyLayout();
  });

  it('preserves saved commit variants, their scopes, and expandable messages', async () => {
    const old = data.tests[0]!.outcomes[0]!.runMetadata!.targets[0]!;
    old.commit = { ...old.commit!, sha: 'abcdef1234567890', message: 'Earlier subject\n\nEarlier body' };
    await page.reload();
    const metadata = page.locator('[data-report-test-id="homepage"] .card__metadata');
    await metadata.locator('summary').first().click();
    const target = metadata.locator('.card__targets > div').first();
    expect(await target.getByText('abcdef12', { exact: true }).count()).toBe(1);
    expect(await target.getByText('1e04e038', { exact: true }).count()).toBe(1);
    expect(await target.locator('.run-details__scope').first().textContent()).toContain('Run 1');
    await target.locator('.run-details__commit summary').press('Enter');
    expect(await target.getByText('Earlier body', { exact: true }).isVisible()).toBe(true);
    await metadata.getByRole('button', { name: 'command', exact: true }).click();
    await metadata.getByRole('button', { name: 'test source', exact: true }).click();
    expect(await target.getByText('Earlier body', { exact: true }).isVisible()).toBe(true);
  });

  it.each([1280, 390])('collapses all cards from a title and preserves nested state at %i px', async (width) => {
    await page.setViewportSize({ width, height: 900 });
    const card = page.locator('[data-report-test-id="homepage"]');
    const title = card.getByRole('button', { name: 'Homepage', exact: true });
    expect(await title.count()).toBe(1);
    expect(await title.getAttribute('aria-expanded')).toBe('true');
    const contentId = await title.getAttribute('aria-controls');
    expect(contentId).toBeTruthy();
    expect(await page.locator('[id]').evaluateAll((nodes, id) => nodes.filter((node) => node.id === id).length, contentId)).toBe(1);
    const tags = card.locator('.card__tags');
    const metadata = card.locator('.card__metadata');
    await tags.locator('summary').click();
    await metadata.locator('summary').first().click();
    await metadata.getByRole('button', { name: 'test source' }).click();
    const expandedHeight = (await card.boundingBox())!.height;
    await title.click();
    expect(await title.getAttribute('aria-expanded')).toBe('false');
    expect(await tags.isVisible()).toBe(false);
    expect(await metadata.isVisible()).toBe(false);
    expect(await card.locator('.card__body').isVisible()).toBe(false);
    expect((await card.boundingBox())!.height).toBeLessThan(expandedHeight / 2);
    expect(await page.locator('[data-report-test-id="legacy"] .card__body').isVisible()).toBe(false);
    const reviewed = card.getByRole('checkbox', { name: 'reviewed', exact: true });
    expect(await reviewed.isVisible()).toBe(true);
    expect(await reviewed.isChecked()).toBe(false);
    await title.press('Space');
    expect(await title.getAttribute('aria-expanded')).toBe('true');
    expect(await tags.getAttribute('open')).toBeNull();
    expect(await metadata.getAttribute('open')).not.toBeNull();
    expect(await metadata.getByRole('button', { name: 'test source' }).getAttribute('aria-expanded')).toBe('true');
    expect(await metadata.locator('.card__code').isVisible()).toBe(true);
    await title.press('Enter');
    expect(await title.getAttribute('aria-expanded')).toBe('false');
    await reviewed.check();
    expect(await title.getAttribute('aria-expanded')).toBe('false');
    await title.click();
    expect(await title.getAttribute('aria-expanded')).toBe('true');
    expect(await reviewed.isChecked()).toBe(true);
    expect(await card.locator('.card__body').count()).toBe(0);
    await reviewed.uncheck();
    expect(await card.locator('.card__body').isVisible()).toBe(true);
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
    await metadata.getByRole('button', { name: 'command', exact: true }).click();
    expect(await metadata.getByLabel('Latest command').inputValue()).toBe(latest.command);
    await metadata.getByRole('button', { name: 'Copy command' }).click();
    await page.waitForFunction(() => document.body.dataset.copied !== undefined);
    expect(await page.locator('body').getAttribute('data-copied')).toBe(latest.command);
    const legacy = page.locator('[data-report-test-id="legacy"] .card__metadata');
    await legacy.locator('summary').first().click();
    expect(await legacy.getByText('Latest command', { exact: true }).count()).toBe(0);
    expect(await legacy.getByText('Latest command unavailable').count()).toBe(0);
    expect(await legacy.getByLabel('Latest command').count()).toBe(0);
  });

  it('selects the full command when clipboard access is unavailable', async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    });
    const metadata = page.locator('[data-report-test-id="homepage"] .card__metadata');
    await metadata.locator('summary').first().click();
    await metadata.getByRole('button', { name: 'command', exact: true }).click();
    await metadata.getByRole('button', { name: 'Copy command' }).click();
    const field = metadata.getByLabel('Latest command');
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    expect(await field.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(await field.inputValue());
    expect(await metadata.getByRole('status').innerText()).toContain('copy manually');
  });
});
