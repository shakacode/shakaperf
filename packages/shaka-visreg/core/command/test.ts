import createBitmaps from '../util/createBitmaps.js';
import { shouldRunDocker, runDocker } from '../util/runDocker.js';

// This task will generate a date-named directory with DOM screenshot files as specified in `./capture/config.json` followed by running a report.
// NOTE: If there is no bitmaps_reference directory or if the bitmaps_reference directory is empty then a new batch of reference files will be generated in the bitmaps_reference directory.  Reporting will be skipped in this case.
export async function execute (config) {
  const { default: executeCommand } = await import('./index.js');
  if (shouldRunDocker(config)) {
    return runDocker(config, 'test')
      .finally(() => {
        if (config.openReport && config.report && config.report.indexOf('browser') > -1) {
          executeCommand('_openReport', config);
        }
      });
  } else {
    return createBitmaps(config, false).then(function () {
      return executeCommand('_report', config);
    });
  }
}
