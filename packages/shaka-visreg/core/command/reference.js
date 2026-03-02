import createBitmaps from '../util/createBitmaps.js';
import { remove } from 'fs-extra';
import createLogger from '../util/logger.js';
import { shouldRunDocker, runDocker } from '../util/runDocker.js';
import engineErrors from '../util/engineErrors.js';

const logger = createLogger('clean');

export function execute (config) {
  if (shouldRunDocker(config)) {
    return runDocker(config, 'reference');
  } else {
    let firstStep;
    // do not remove reference directory if we are in incremental mode
    if (config.args.filter || config.args.i) {
      firstStep = Promise.resolve();
    } else {
      firstStep = remove(config.bitmaps_reference).then(function () {
        logger.success(config.bitmaps_reference + ' was cleaned.');
      });
    }

    return firstStep.then(function () {
      return createBitmaps(config, true);
    }).then(function () {
      console.log('\nRun `$ backstop test` to generate diff report.\n');
      return engineErrors(config);
    });
  }
}
