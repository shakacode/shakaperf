import path from 'node:path';
import { copy } from 'fs-extra';
import createLogger from '../util/logger';
import type { RuntimeConfig } from '../types';

const logger = createLogger('init');

/**
 * Copies boilerplate config and ab-tests template to the project directory.
 */
export function execute (config: RuntimeConfig) {
  const promises = [];

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

  // Copy example cookies
  const cookiesSrc = path.join(config.visregRoot, 'capture', 'cookies');
  const cookiesDest = path.join(config.projectPath, 'visreg_data', 'cookies');
  promises.push(copy(cookiesSrc, cookiesDest).then(function () {
    logger.log("Example cookies written at '" + cookiesDest + "'");
  }));

  return Promise.all(promises);
}
