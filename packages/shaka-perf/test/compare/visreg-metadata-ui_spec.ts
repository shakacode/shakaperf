/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { renderReportHtml } from '../../src/pipeline/report';
import type { ArtifactPath } from '../../src/pipeline/artifact-store';
import { runDetailsFixture } from '../../src/pipeline/__tests__/fixtures/run-details';

jest.setTimeout(60_000);

const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="white"/></svg>');

function fixture() {
  const data = runDetailsFixture('compare');
  const test = data.tests[0]!;
  const saved = test.outcomes[0]!;
  test.controlUrl = 'http://new-control.example/';
  test.experimentUrl = 'http://new-experiment.example/';
  test.outcomes = [{
    ...saved,
    stage: 'visreg',
    recoveredAfterRetries: true,
    runMetadata: { ...saved.runMetadata!, taskRetries: 1, taskRetryLimit: 2 },
    measurement: [{
      selector: 'document', controlImage: image, experimentImage: image,
      diffImage: null, misMatchPercentage: 0, savedByRetries: true,
      compareAttempts: 2, compareRetries: 2,
    }],
  }, {
    ...saved,
    stage: 'perf',
    measurement: { metrics: [] },
    runMetadata: {
      ...saved.runMetadata!,
      measuredAt: '2026-10-21T20:54:53.891Z',
      command: 'shaka-perf compare --categories perf --filter Homepage',
      targets: saved.runMetadata!.targets.map((target) => ({
        ...target,
        commit: { sha: 'abcdef1234567890', message: 'Unrelated newer perf commit', source: 'fixture' },
      })),
    },
  }];
  data.tests = [test];
  return data;
}

describe('visual preview metadata', () => {
  let server: Server;
  let browser: Browser;
  let url: string;
  let data = fixture();

  beforeEach(() => { data = fixture(); });
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

  it('keeps saved visual command and retry provenance with current shared targets', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.locator('.artifact-card--single').getByRole('button').click();
      const metadata = page.getByRole('dialog').locator('.card__metadata');
      await metadata.getByRole('button', { name: 'command', exact: true }).click();
      expect(await metadata.getByLabel('Latest command').inputValue()).toBe(data.tests[0]!.outcomes[0]!.runMetadata!.command);
      expect(await metadata.locator('.card__targets a').allTextContents()).toEqual([
        'http://new-control.example/', 'http://new-experiment.example/',
      ]);
      await metadata.getByRole('button', { name: 'test source', exact: true }).click();
      expect(await metadata.locator('.card__code').textContent()).toContain("abTest('Homepage'");
      expect(await metadata.locator('.visreg-meta__retries dd').allTextContents()).toEqual([
        '2/3 · matched on retry', '1/2 · recovered',
      ]);
    } finally {
      await page.close();
    }
  });

  it('does not borrow a newer sibling result for a legacy visual artifact', async () => {
    delete data.tests[0]!.outcomes[0]!.runMetadata;
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.locator('.artifact-card--single').getByRole('button').click();
      const metadata = page.getByRole('dialog').locator('.card__metadata');
      expect(await metadata.getByRole('button', { name: 'command', exact: true }).count()).toBe(0);
      expect(await metadata.locator('.card__target-commits').allTextContents()).toEqual(['', '']);
      expect(await metadata.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(0);
      expect(await metadata.getByRole('button', { name: 'test source', exact: true }).isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('keeps failure screenshot commands scoped to the failed result', async () => {
    const outcome = data.tests[0]!.outcomes[0]!;
    outcome.kind = 'error';
    outcome.error = { message: 'Visual capture failed' };
    outcome.failure = { media: image as ArtifactPath };
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.locator('.slot-error__screenshot').click();
      const dialog = page.getByRole('dialog');
      const metadata = dialog.locator('.card__metadata');
      expect(await metadata.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(0);
      await metadata.getByRole('button', { name: 'command', exact: true }).click();
      expect(await metadata.getByLabel('Latest command').inputValue()).toContain('--categories perf,accessibility');
    } finally {
      await page.close();
    }
  });

  it('opens logs with the latest saved measurement command', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.getByRole('button', { name: 'logs', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const metadata = dialog.locator('.card__metadata');
      expect(await metadata.getByText('Unrelated newer perf commit', { exact: true }).count()).toBe(2);
      await metadata.getByRole('button', { name: 'command', exact: true }).click();
      expect(await metadata.getByLabel('Latest command').inputValue()).toBe('shaka-perf compare --categories perf --filter Homepage');
    } finally {
      await page.close();
    }
  });

});
