import createComparisonBitmaps from '../util/createComparisonBitmaps.js';
import { shouldRunDocker, runDocker } from '../util/runDocker.js';

export async function execute (config) {
  const { default: executeCommand } = await import('./index.js');
  if (shouldRunDocker(config)) {
    return runDocker(config, 'liveCompare')
      .then(function () {
        if (config.openReport && config.report && config.report.indexOf('browser') > -1) {
          executeCommand('_openReport', config);
        }
      });
  } else {
    return createComparisonBitmaps(config).then(function () {
      return executeCommand('_report', config);
    });
  }
}
