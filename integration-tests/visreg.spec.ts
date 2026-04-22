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

  // Verify report.json records the expected visreg outcomes: homepage mismatches
  // (hero padding change) and the products selector-timeout also surfaces as a
  // visual_change (the harvester folds pair-level engine errors into the
  // "changed" set so these tests flag).
  const report = JSON.parse(
    fs.readFileSync(path.join(SNAPSHOT_DIR, 'report.json'), 'utf-8'),
  );
  const byName = new Map<string, string>(
    report.tests.map((t: { name: string; status: string }) => [t.name, t.status]),
  );
  for (const expected of ['Homepage', 'Products - Electronics Filter']) {
    if (byName.get(expected) !== 'visual_change') {
      throw new Error(
        `Expected "${expected}" to have status "visual_change", got ${byName.get(expected) ?? 'undefined'}`,
      );
    }
  }
  loud(`Confirmed visual_change for Homepage and Products - Electronics Filter`);

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
