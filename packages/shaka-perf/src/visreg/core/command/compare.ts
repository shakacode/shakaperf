import createComparisonBitmaps from '../util/createComparisonBitmaps';
import type { RuntimeConfig } from '../types';

export async function execute (config: RuntimeConfig) {
  // Imported dynamically to break the circular dependency:
  // index.js → compare.js → index.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const executeCommand = require('./index').default;
  return createComparisonBitmaps(config).then(function () {
    return executeCommand('_report', config);
  });
}
