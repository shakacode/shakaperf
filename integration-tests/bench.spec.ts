import { test } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO,
  loud, run, startServers, waitForPort,
} from './helpers';

// Store bench results in the REAL repo so they persist and can be committed
const BENCH_RESULTS_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'bench-results');

test('run shaka-bench compare on twin servers', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([
    waitForPort(3020),
    waitForPort(3030),
  ]);

  // Run shaka-bench compare with minimal measurements for speed
  loud('Running shaka-bench compare');
  fs.rmSync(BENCH_RESULTS_DIR, {
    recursive: true,
    force: true,
  });
  run(
    [
      'yarn shaka-bench compare',
      '--testFile ./ab-tests/shop-now.bench.ts',
      '--numberOfMeasurements 5',
      '--report',
      `--resultsFolder ${BENCH_RESULTS_DIR}`,
    ].join(' '),
    { timeout: 15 * 60 * 1000 },
  );

  // Results land in a per-test subdirectory; move them up for snapshot compatibility
  const testSubdir = fs.readdirSync(BENCH_RESULTS_DIR, { withFileTypes: true })
    .find(d => d.isDirectory());
  if (testSubdir) {
    const subPath = path.join(BENCH_RESULTS_DIR, testSubdir.name);
    for (const file of fs.readdirSync(subPath)) {
      fs.renameSync(path.join(subPath, file), path.join(BENCH_RESULTS_DIR, file));
    }
    fs.rmdirSync(subPath);
  }

  // Pretty-print JSON results for readable diffs
  for (const file of ['compare.json', 'report.json', 'localhost_3020____performance_profile.json']) {
    const filePath = path.join(BENCH_RESULTS_DIR, file);
    const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
  }

  // Screenshot HTML artifacts for visual diffing
  const htmlFiles = fs.readdirSync(BENCH_RESULTS_DIR).filter(f => f.endsWith('.html'));
  for (const file of htmlFiles) {
    const filePath = path.join(BENCH_RESULTS_DIR, file);
    const screenshotPath = filePath.replace(/\.html$/, '.screenshot.png');
    await page.goto(`file://${filePath}`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }

});
