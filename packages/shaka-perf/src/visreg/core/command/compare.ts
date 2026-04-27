import { rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import createComparisonBitmaps from '../util/createComparisonBitmaps';
import type { RuntimeConfig } from '../types';

/**
 * Run a visreg comparison.
 *
 * Wipes the per-test visreg subdirs (`<htmlReportDir>/visreg-*`) and the
 * intermediate flat capture dirs before running, so a fresh engine run
 * doesn't inherit stale screenshots from a renamed/removed test. Other
 * sibling content (perf-* dirs, top-level files) is left alone — the
 * caller may have written cross-engine state we don't own.
 */
export async function execute(config: RuntimeConfig) {
  const root = config.htmlReportDir;
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('visreg-')) {
        rmSync(path.join(root, entry), { recursive: true, force: true });
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
