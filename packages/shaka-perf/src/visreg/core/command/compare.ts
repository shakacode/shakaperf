import { rmSync, existsSync } from 'node:fs';
import createComparisonBitmaps from '../util/createComparisonBitmaps';
import type { RuntimeConfig } from '../types';

/**
 * Run a visreg comparison.
 *
 * NOTE: This wipes `config.htmlReportDir` before running so the output
 * directory always reflects exactly the current run. Screenshots for tests
 * that were renamed or removed since the previous run will NOT linger.
 * Do not point `htmlReportDir` at a directory containing files you care about.
 */
export async function execute (config: RuntimeConfig) {
  if (existsSync(config.htmlReportDir)) {
    console.log('[shaka-perf visreg] Cleaning previous report at ' + config.htmlReportDir);
    rmSync(config.htmlReportDir, { recursive: true, force: true });
  }

  // Imported dynamically to break the circular dependency:
  // index.js → compare.js → index.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const executeCommand = require('./index').default;
  return createComparisonBitmaps(config).then(function () {
    return executeCommand('_report', config);
  });
}
