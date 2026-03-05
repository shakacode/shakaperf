import path from 'node:path';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import createLogger from '../util/logger.js';
import getRemotePort from '../util/getRemotePort.js';

const _require = createRequire(import.meta.url);
const logger = createLogger('remote');
const ssws = _require.resolve('super-simple-web-server');

export function execute (config) {
  const MIDDLEWARE_PATH = path.resolve(config.backstop, 'remote', 'index.cjs');
  const projectPath = path.resolve(config.projectPath);

  return new Promise(function (resolve, reject) {
    const port = getRemotePort();
    const commandStr = `node ${ssws} ${projectPath} ${MIDDLEWARE_PATH} --config=${config.backstopConfigFileName}`;
    const env = { SSWS_HTTP_PORT: String(port) };

    logger.log(`Starting remote with: ${commandStr} with env ${JSON.stringify(env)}`);

    const child = exec(commandStr, { env: { ...env, PATH: process.env.PATH } }, (error) => {
      if (error) {
        logger.log('Error running backstop remote: ' + error);
      }
    });

    child.stdout.on('data', logger.log);

    child.stdout.on('close', data => {
      logger.log('Backstop remote connection closed. ' + data);
      resolve(data);
    });
  });
}
