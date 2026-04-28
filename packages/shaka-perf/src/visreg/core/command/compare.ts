import { rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadTests } from 'shaka-shared';
import createComparisonBitmaps from '../util/createComparisonBitmaps';
import { slugifyForBench } from '../../../compare/harvest/perf';
import type { RuntimeConfig } from '../types';

/**
 * Run a visreg comparison.
 *
 * Wipes only the per-test subdirs `visreg-<viewport>/<slug>/` (under
 * htmlReportDir) for tests this run is about to measure, plus the
 * intermediate flat capture dirs. Sibling per-test dirs from other shards
 * or disjoint test selections are left intact so multi-shard runs against
 * a shared results root don't clobber each other's outputs. Stale dirs for
 * tests not in this run remain on disk; the harvester reads by current
 * test slug, so they're inert.
 */
export async function execute(config: RuntimeConfig) {
  const root = config.htmlReportDir;
  const tests = await loadTests({
    testPathPattern: config.args.testPathPattern as string | undefined,
    filter: config.args.filter as string | undefined,
    testType: 'visreg',
    log: () => undefined,
  });
  const slugs = tests.map((t) => slugifyForBench(t.name));

  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('visreg-')) continue;
      const viewportDir = path.join(root, entry);
      for (const slug of slugs) {
        rmSync(path.join(viewportDir, slug), { recursive: true, force: true });
      }
    }
    rmSync(path.join(root, 'control_screenshot'), { recursive: true, force: true });
    rmSync(path.join(root, 'experiment_screenshot'), { recursive: true, force: true });
  }

  // Imported dynamically to break the circular dependency:
  // index.js → compare.js → index.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const executeCommand = require('./index').default;
  return createComparisonBitmaps(config).then(function () {
    return executeCommand('_report', config);
  });
}
