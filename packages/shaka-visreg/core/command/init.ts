import path from 'node:path';
import { copy } from 'fs-extra';
import createLogger from '../util/logger';
import type { RuntimeConfig } from '../types';

const logger = createLogger('init');

/**
 * Copies boilerplate config, engine scripts, and ab-tests template to the project directory.
 */
export function execute (config: RuntimeConfig) {
  const promises = [];

  if (config.engine_scripts) {
    logger.log("Copying '" + config.engine_scripts_default + "' to '" + config.engine_scripts + "'");
    promises.push(copy(config.engine_scripts_default, config.engine_scripts));
  } else {
    logger.error('ERROR: Can\'t generate a scripts directory. No \'engine_scripts\' path property was found.');
  }

  // Copy boilerplate config file
  promises.push(copy(config.captureConfigFileNameDefault, config.configFileName).then(function () {
    logger.log("Configuration file written at '" + config.configFileName + "'");
  }, function (err: unknown) {
    throw err;
  }));

  // Copy ab-tests template
  const abTestsSrc = path.join(config.visregRoot, 'capture', 'ab-tests');
  const abTestsDest = path.join(config.projectPath, 'ab-tests');
  promises.push(copy(abTestsSrc, abTestsDest).then(function () {
    logger.log("Test templates written at '" + abTestsDest + "'");
  }));

  return Promise.all(promises);
}
