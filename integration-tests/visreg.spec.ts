import { test } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD,
  loud, run, startServers, waitForPort,
} from './helpers';

// Store visreg results in the REAL repo so they persist and can be committed
const VISREG_RESULTS_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'visreg-results');

test('run shaka-visreg liveCompare on twin servers', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([
    waitForPort(3020),
    waitForPort(3030),
  ]);

  // Clean previous results
  fs.rmSync(VISREG_RESULTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(VISREG_RESULTS_DIR, { recursive: true });

  // Patch visreg.config.ts to disable openReport so visreg doesn't launch a browser
  const visregConfigPath = path.join(DEMO_CWD, 'visreg.config.ts');
  let visregConfigContent = fs.readFileSync(visregConfigPath, 'utf-8');
  if (!visregConfigContent.includes('openReport')) {
    visregConfigContent = visregConfigContent.replace(
      /defaultMisMatchThreshold.*$/m,
      (match) => match + '\n  openReport: false,'
    );
    fs.writeFileSync(visregConfigPath, visregConfigContent);
  }

  // Run shaka-visreg liveCompare — expect it to fail (mismatches from padding change)
  loud('Running shaka-visreg liveCompare');
  let visregFailed = false;
  try {
    run('yarn shaka-visreg liveCompare --testFile ./ab-tests/index.abtest.ts --config visreg.config.ts', {
      timeout: 15 * 60 * 1000,
    });
  } catch (e: unknown) {
    visregFailed = true;
    if (e && typeof e === 'object' && 'stderr' in e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer };
      if (err.stderr) console.log(err.stderr.toString());
      if (err.stdout) console.log(err.stdout.toString());
    }
  }

  if (!visregFailed) {
    throw new Error('Expected shaka-visreg to fail with mismatch errors, but it succeeded');
  }
  loud('Visreg failed as expected (mismatches detected)');

  // Copy CI report to results dir
  const xunitSrc = path.join(DEMO_CWD, 'visreg_data', 'ci_report', 'xunit.xml');
  fs.copyFileSync(xunitSrc, path.join(VISREG_RESULTS_DIR, 'xunit.xml'));
  loud('Copied xunit.xml to results');

  // Verify xunit.xml contains failures
  const xunitContent = fs.readFileSync(path.join(VISREG_RESULTS_DIR, 'xunit.xml'), 'utf-8');
  if (!xunitContent.includes('<failure')) {
    throw new Error('Expected xunit.xml to contain <failure> elements');
  }

  // Copy visreg_data (html_report + bitmaps) to results dir, skip engine_scripts and ci_report
  const visregDataSrc = path.join(DEMO_CWD, 'visreg_data');
  for (const dir of ['html_report', 'bitmaps_reference', 'bitmaps_test']) {
    const src = path.join(visregDataSrc, dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(VISREG_RESULTS_DIR, dir), { recursive: true });
    }
  }
  loud('Copied visreg_data to results');

  // Screenshot the HTML report
  const htmlReportIndex = path.join(VISREG_RESULTS_DIR, 'html_report', 'index.html');
  await page.goto(`file://${htmlReportIndex}`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForSelector('#root div', { timeout: 10_000 });
  await page.screenshot({
    path: path.join(VISREG_RESULTS_DIR, 'html-report.screenshot.png'),
    fullPage: true,
  });
});
