import http from 'node:http';
import createLogger from '../util/logger.js';
import getRemotePort from '../util/getRemotePort.js';

const logger = createLogger('stop');

export function execute () {
  const port = getRemotePort();
  const stopUrl = `http://127.0.0.1:${port}/stop`;
  return new Promise((resolve, reject) => {
    logger.log('Attempting to ping ', stopUrl);
    http.get(stopUrl, (resp) => {
      resp.on('end', () => {
        logger.log('Stopping backstop remote: success');
        process.exit(0);
      });
    }).on('error', (error: any) => {
      // ECONNRESET is expected if the stop command worked correctly
      if (error.code === 'ECONNRESET') {
        logger.log('Stopping backstop remote: success');
        return process.exit(0);
      }
      logger.log('Stopping backstop remote: error');
      reject(error);
    });
  });
}
