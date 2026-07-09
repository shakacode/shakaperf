/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  EXPERIMENT_CLONE_PATH, CONTROL_PORT, EXPERIMENT_PORT,
  run, stage, startServers, stopServers, waitForPort,
} from './helpers';

const HOME_PAGE_FILE = path.join(
  EXPERIMENT_CLONE_PATH,
  'demo-ecommerce/app/javascript/components/pages/HomePage.tsx',
);

test('modify experiment, rebuild, and verify servers diverge @twin-servers', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

  // Verify both servers initially serve the same content
  await stage(`Verifying experiment server (${EXPERIMENT_PORT}) has "Discover Your Style"`, async () => {
    await page.goto(`http://localhost:${EXPERIMENT_PORT}`);
    await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
  });

  await stage(`Verifying control server (${CONTROL_PORT}) has "Discover Your Style"`, async () => {
    await page.goto(`http://localhost:${CONTROL_PORT}`);
    await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
  });

  // Stop servers, modify experiment, sync, rebuild, restart
  stopServers();

  await stage('Modifying HomePage.tsx: "Discover Your Style" -> "Discover Your New Self"', () => {
    const homePageContent = fs.readFileSync(HOME_PAGE_FILE, 'utf-8');
    const updatedContent = homePageContent.replace(
      'Discover Your Style',
      'Discover Your New Self',
    );
    fs.writeFileSync(HOME_PAGE_FILE, updatedContent);
  });

  run('yarn shaka-perf servers sync-changes experiment');

  run('yarn shaka-perf servers run-cmd-parallel -- bundle exec rake assets:precompile', {
    timeout: 5 * 60 * 1000,
  });

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

  // Verify control still has original content
  await stage(`Verifying control (${CONTROL_PORT}) still has "Discover Your Style"`, async () => {
    await page.goto(`http://localhost:${CONTROL_PORT}`);
    await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
  });

  // Verify experiment has new content
  await stage(`Verifying experiment (${EXPERIMENT_PORT}) has "Discover Your New Self"`, async () => {
    await page.goto(`http://localhost:${EXPERIMENT_PORT}`);
    await expect(page.getByText('Discover Your New Self')).toBeVisible({ timeout: 30_000 });
  });

  // Restart containers to restore pristine state after modifications
  run('yarn shaka-perf servers start-containers', { timeout: 5 * 60 * 1000 });
});

test('run-cmd preserves single and double quotes @twin-servers', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);

  const HOMEPAGE_TSX = 'app/javascript/components/pages/HomePage.tsx';

  stopServers();

  // Use run-cmd with sed to replace text inside the container — tests double quotes
  await stage('Using run-cmd with sed to replace "Discover Your Style" with "It\'s a \\"quoted\\" world"', () => {
    run(`yarn shaka-perf servers run-cmd experiment "sed -i 's/Discover Your Style/It'\\''s a \\"quoted\\" world/' ${HOMEPAGE_TSX}"`);
  });

  run('yarn shaka-perf servers run-cmd experiment "bundle exec rake assets:precompile"', {
    timeout: 5 * 60 * 1000,
  });

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

  await stage(`Verifying control (${CONTROL_PORT}) still has "Discover Your Style"`, async () => {
    await page.goto(`http://localhost:${CONTROL_PORT}`);
    await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
  });

  await stage(`Verifying experiment (${EXPERIMENT_PORT}) has text with single and double quotes`, async () => {
    await page.goto(`http://localhost:${EXPERIMENT_PORT}`);
    await expect(page.getByText(`It's a "quoted" world`)).toBeVisible({ timeout: 30_000 });
  });

  // Restart containers to restore pristine state after modifications
  run('yarn shaka-perf servers start-containers', { timeout: 5 * 60 * 1000 });
});
