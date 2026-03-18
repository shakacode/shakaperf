// @ts-expect-error no type declarations
import open from 'opn';
import path from 'node:path';
import http from 'node:http';
import createLogger from '../util/logger';
import getRemotePort from '../util/getRemotePort';
import type { RuntimeConfig } from '../types';

const logger = createLogger('openReport');
const REPORT_SIGNATURE_RE = /BackstopJS Report|shaka-visreg Report/i;

export function execute (config: RuntimeConfig) {
  const port = getRemotePort();
  const remoteReportUrl = `http://127.0.0.1:${port}/${config.compareReportURL}?remote`;
  return new Promise(function (resolve, _reject) {
    // would prefer to ping a http://127.0.0.1:${port}/remote with {visregRemote:ok} response
    logger.log('Attempting to ping ' + remoteReportUrl);
    http.get(remoteReportUrl, (resp: http.IncomingMessage) => {
      let data = '';
      resp.on('data', (chunk: string | Buffer) => { data += chunk; });
      resp.on('end', () => {
        if (REPORT_SIGNATURE_RE.test(data)) {
          logger.log('Remote found. Opening ' + remoteReportUrl);
          resolve(open(remoteReportUrl, { wait: false }));
        } else {
          logger.log('Remote not detected. Opening ' + config.compareReportURL);
          resolve(open(config.compareReportURL, { wait: false }));
        }
      });
    }).on('error', (err: Error) => {
      logger.log('Remote not found. Opening ' + config.compareReportURL + ' Error: ' + err.message);
      resolve(open(path.resolve(config.compareReportURL), { wait: false }));
    });
  });
}
