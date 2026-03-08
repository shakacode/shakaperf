import createComparisonBitmaps from '../util/createComparisonBitmaps.js';
import type { RuntimeConfig } from '../types.js';

export async function execute (config: RuntimeConfig) {
  // Imported dynamically to break the circular dependency:
  // index.js → liveCompare.js → index.js  const { default: executeCommand } = await import('./index.js');
  const { default: executeCommand } = await import('./index.js');
  return createComparisonBitmaps(config).then(function () {
    return executeCommand('_report', config);
  });
}
