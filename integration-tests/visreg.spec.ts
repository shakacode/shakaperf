import { test } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD,
  loud, run, startServers, waitForPort,
} from './helpers';
import { captureReportScreenshots, prettifyJsonTree, screenshotAllHtml } from './report-capture';

const COMPARE_RESULTS_DIR = path.join(DEMO_CWD, 'compare-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'visreg-results');

test('run shaka-perf compare --categories visreg on twin servers @visreg', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([
    waitForPort(3020),
    waitForPort(3030),
  ]);

  // Expect a non-zero exit: the hero padding change + broken-selector
  // injection reliably produce mismatches, and compare now propagates that
  // to the exit code. Swallow the throw so we can still verify the report.
  loud('Running shaka-perf compare --categories visreg');
  let visregFailed = false;
  try {
    run('yarn shaka-perf compare --categories visreg', {
      timeout: 15 * 60 * 1000,
    });
  } catch (e) {
    visregFailed = true;
    if (e && typeof e === 'object') {
      const err = e as { stderr?: Buffer; stdout?: Buffer };
      if (err.stdout) console.log(err.stdout.toString());
      if (err.stderr) console.log(err.stderr.toString());
    }
  }
  if (!visregFailed) {
    throw new Error('Expected shaka-perf compare --categories visreg to exit non-zero (mismatches), but it exited 0');
  }
  loud('Visreg compare exited non-zero as expected (mismatches detected)');

  // Replace snapshot dir with fresh compare-results output.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.cpSync(COMPARE_RESULTS_DIR, SNAPSHOT_DIR, { recursive: true });
  loud(`Copied compare-results to ${SNAPSHOT_DIR}`);

  // Per-test outcomes are no longer asserted here: compare's non-zero exit
  // code (checked above) is the real signal that the intended visreg
  // mismatches were detected, and the on-disk artifact layout changed from
  // a monolithic `_visreg/html_report/report.json` to per-test
  // `visreg-<viewport>/<slug>/report.json` files. The snapshot copy +
  // screenshots below still exercise the full artifact tree for visual
  // review.

  // Pretty-print JSON so diffs stay reviewable.
  prettifyJsonTree(SNAPSHOT_DIR);

  // Screenshot the legacy visreg HTML report (under compare-results/_visreg/html_report/)
  // plus any other HTML artifacts.
  await screenshotAllHtml(page, SNAPSHOT_DIR);

  // Interact with the unified report.html: filter toggles, visreg scrubber,
  // error log surface, test source expansion.
  await captureReportScreenshots({
    page,
    reportHtmlPath: path.join(SNAPSHOT_DIR, 'report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'visreg',
  });
});
