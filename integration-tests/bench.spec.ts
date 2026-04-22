import { test } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD,
  loud, run, startServers, waitForPort,
} from './helpers';
import { captureReportScreenshots, prettifyJsonTree, screenshotAllHtml } from './report-capture';

const COMPARE_RESULTS_DIR = path.join(DEMO_CWD, 'compare-results');
const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'bench-results');

test('run shaka-perf compare --categories perf on twin servers @perf', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);

  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([
    waitForPort(3020),
    waitForPort(3030),
  ]);

  loud('Running shaka-perf compare --categories perf');
  // Expect a non-zero exit: the LazySection→div swap reliably regresses
  // HomePage perf. We still need the artifacts, so swallow the throw and
  // verify the report was produced below.
  let perfFailed = false;
  try {
    run(
      [
        'yarn shaka-perf compare',
        '--categories perf',
        '--testPathPattern "./ab-tests/shop-now.abtest.ts|./ab-tests/homepage.abtest.ts"',
      ].join(' '),
      { timeout: 20 * 60 * 1000 },
    );
  } catch (e) {
    perfFailed = true;
    if (e && typeof e === 'object') {
      const err = e as { stderr?: Buffer; stdout?: Buffer };
      if (err.stdout) console.log(err.stdout.toString());
      if (err.stderr) console.log(err.stderr.toString());
    }
  }
  if (!perfFailed) {
    throw new Error('Expected shaka-perf compare --categories perf to exit non-zero (HomePage regression), but it exited 0');
  }
  loud('Perf compare exited non-zero as expected (regression detected)');

  // Replace snapshot dir with fresh compare-results output.
  if (fs.existsSync(SNAPSHOT_DIR)) fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  fs.cpSync(COMPARE_RESULTS_DIR, SNAPSHOT_DIR, { recursive: true });
  loud(`Copied compare-results to ${SNAPSHOT_DIR}`);

  // Pretty-print JSON for readable diffs
  prettifyJsonTree(SNAPSHOT_DIR);

  // Screenshot every per-test HTML artifact (lighthouse reports, timeline
  // comparison, network/profile diffs, legacy bench report).
  await screenshotAllHtml(page, SNAPSHOT_DIR);

  // Interact with the unified report.html and capture every distinct state
  // (dialogs, expanded source, filtered grid, timeline preview, scrubber).
  await captureReportScreenshots({
    page,
    reportHtmlPath: path.join(SNAPSHOT_DIR, 'report.html'),
    outDir: SNAPSHOT_DIR,
    label: 'perf',
  });
});
