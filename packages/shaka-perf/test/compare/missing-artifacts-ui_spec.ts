/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { renderReportHtml } from '../../src/pipeline/report';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';

jest.setTimeout(60_000);

const listingFile = 'tmp/twin-fixture-check-hej8a9mf/experiment/twin-servers/abtests/listing.abtest.ts';
const names = ["Listing (grid), user's $cart", 'Listing [detail]', 'Homepage'];

function fixture(pipeline: 'compare' | 'audit' = 'compare', mode: 'full' | 'self-contained' = 'full', bisect = false) {
  const data = runDetailsFixture(pipeline, mode, bisect);
  data.tests.push(...names.map((name, index) => ({
    ...data.tests[0]!, id: `missing-${index}`, name,
    filePath: index < 2 ? listingFile : 'ab-tests/other [v1](x).abtest.ts',
    measuredAt: null, runId: null, outcomes: [], chips: [], sorts: [],
  })));
  return data;
}

describe('missing-results disclosure', () => {
  let server: Server;
  let browser: Browser;
  let page: Page;
  let url: string;
  let data = fixture();

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
    data = fixture();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  });
  afterEach(async () => page.close());

  it.each([
    ['compare', 'full'], ['compare', 'self-contained'],
    ['audit', 'full'], ['audit', 'self-contained'],
  ] as const)('groups files and generates one name-filtered command in %s %s', async (pipeline, mode) => {
    data = fixture(pipeline, mode);
    await page.goto(url);
    const toggle = page.getByRole('button', { name: '3 tests missing', exact: true });
    await toggle.waitFor({ timeout: 3000 });
    expect(await toggle.getAttribute('aria-expanded')).toBe('false');
    expect(await page.locator('.grid > .card--missing-artifacts').count()).toBe(0);
    const search = await page.locator('.search').boundingBox();
    const oldRuns = await page.getByRole('checkbox', { name: 'Show old runs' }).boundingBox();
    const control = await toggle.boundingBox();
    expect(Math.abs(control!.y + control!.height / 2 - search!.y - search!.height / 2)).toBeLessThan(2);
    expect(control!.x).toBeGreaterThan(oldRuns!.x);
    await toggle.press('Enter');
    const details = page.getByRole('region', { name: 'Tests without saved results' });
    expect(await details.getByRole('heading', { name: 'no artifacts yet', exact: true }).isVisible()).toBe(true);
    expect(await details.locator('.missing-artifacts__summary').innerText()).toBe(
      `3 tests missing on-disk measurements — re-run shaka-perf ${pipeline} (or ship the shard that measures them)`,
    );
    expect(await details.getByText(listingFile, { exact: true }).count()).toBe(1);
    expect(await details.locator('.missing-artifacts__file-group').count()).toBe(2);
    expect(await details.locator('.missing-artifacts__file-group').first().getByRole('listitem').allTextContents()).toEqual(names.slice(0, 2));
    expect(await details.innerText()).not.toContain('Run only these tests.');
    const command = (await details.getByLabel('Recovery command').textContent())!;
    expect(command.split('\n')).toHaveLength(1);
    // Parse through the shell without executing the generated measurement command.
    const args = execFileSync('/bin/sh', ['-c', `set -- ${command}; printf '%s\\0' "$@"`]).toString().split('\0').slice(0, -1);
    expect(args).toEqual(['shaka-perf', pipeline, '--filter', expect.any(String), '--keep-old-results']);
    expect(args[3]).toMatch(/^\^\(\?:.*\)\$$/);
    const filters = args[3]!.split(',').map((pattern) => new RegExp(pattern));
    const definitions = [
      ...names.map((name, index) => ({ id: `missing-${index}`, name, filePath: listingFile })),
      { id: 'same-name-other-file', name: names[0]!, filePath: 'different.abtest.ts' },
      { id: 'extra', name: 'Listing [detail] extra', filePath: listingFile },
      { id: 'unescaped-regex', name: 'Listing detail', filePath: listingFile },
      { id: 'other', name: 'Unrelated', filePath: listingFile },
    ];
    // Name selection intentionally includes duplicate names in other files.
    expect(definitions.filter((test) => filters.some((filter) => filter.test(test.name))).map((test) => test.id))
      .toEqual(['missing-0', 'missing-1', 'missing-2', 'same-name-other-file']);
    await toggle.press('Space');
    expect(await details.isVisible()).toBe(false);
  });

  it('keeps the count and expanded list through search, status filters and old-run changes', async () => {
    await page.goto(url);
    const toggle = page.getByRole('button', { name: '3 tests missing', exact: true });
    await toggle.click();
    await page.locator('.filterbar').first().getByRole('button').last().click();
    await page.getByRole('checkbox', { name: 'Show old runs' }).check();
    await page.locator('input[type="search"]').fill('no matching saved result');
    expect(await toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await page.getByRole('region', { name: 'Tests without saved results' }).getByRole('listitem').allTextContents()).toEqual(names);
    await page.reload();
    expect(await toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('uses singular text, hides zero missing tests and handles a completely unmeasured report', async () => {
    data.tests = data.tests.filter((test) => test.measuredAt !== null || test.id === 'missing-0');
    await page.goto(url);
    expect(await page.getByRole('button', { name: '1 test missing', exact: true }).count()).toBe(1);
    data.tests = data.tests.filter((test) => test.measuredAt !== null);
    await page.reload();
    expect(await page.getByRole('button', { name: /tests? missing/ }).count()).toBe(0);
    data.tests = fixture().tests.filter((test) => test.measuredAt === null);
    await page.reload();
    await page.getByRole('button', { name: '3 tests missing', exact: true }).click();
    expect(await page.getByLabel('Recovery command').isVisible()).toBe(true);
    expect(await page.locator('.grid .card').count()).toBe(0);
  });

  it('preserves the bisect rule for persisted outcomes without measurement timestamps', async () => {
    data = fixture('compare', 'full', true);
    data.tests[0]!.measuredAt = null;
    await page.goto(url);
    expect(await page.getByRole('button', { name: '3 tests missing', exact: true }).count()).toBe(1);
    data.bisect = undefined;
    await page.reload();
    expect(await page.getByRole('button', { name: '4 tests missing', exact: true }).count()).toBe(1);
  });

  it('fits the command to wrapped content and copies or selects the complete command', async () => {
    await page.goto(url);
    await page.getByRole('button', { name: '3 tests missing', exact: true }).click();
    const field = page.getByLabel('Recovery command');
    const desktopHeight = (await field.boundingBox())!.height;
    await page.setViewportSize({ width: 320, height: 900 });
    await page.waitForFunction(() => {
      const field = document.querySelector<HTMLElement>('[aria-label="Recovery command"]')!;
      return field.clientHeight >= field.scrollHeight;
    });
    expect((await field.boundingBox())!.height).toBeGreaterThan(desktopHeight);
    expect((await field.boundingBox())!.width).toBeGreaterThan((await page.locator('.missing-artifacts').boundingBox())!.width * 0.75);
    expect(await field.evaluate((el) => getComputedStyle(el).resize)).toBe('none');
    expect(await field.evaluate((el) => el instanceof HTMLPreElement && !el.isContentEditable)).toBe(true);
    expect(await field.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // Existing performance tables can overflow at this width. Check the changed controls,
    // grouped paths and command field without changing unrelated artifact layouts.
    expect(await page.locator('.header__controls').evaluate((el) => Array.from(el.querySelectorAll('*'))
      .filter((child) => child.getClientRects().length > 0)
      .every((child) => child.getBoundingClientRect().right <= innerWidth))).toBe(true);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async (value: string) => { document.body.dataset.copied = value; } },
    }));
    const copy = page.getByRole('button', { name: 'Copy command', exact: true });
    await copy.click();
    expect(await page.locator('body').getAttribute('data-copied')).toBe(await field.textContent());
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
    }));
    await copy.click();
    expect(await field.evaluate((el) => document.activeElement === el && window.getSelection()?.toString() === el.textContent)).toBe(true);
    expect(await page.getByRole('status').innerText()).toContain('copy manually');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction((height) => document.querySelector<HTMLElement>('[aria-label="Recovery command"]')!.getBoundingClientRect().height <= height, desktopHeight);
  });
});
