import open from 'opn';
import path from 'node:path';
import http from 'node:http';
import createLogger from '../util/logger.js';
import getRemotePort from '../util/getRemotePort.js';

const logger = createLogger('openReport');
const BACKSTOP_REPORT_SIGNATURE_RE = /BackstopJS Report/i;

export function execute (config) {
  const port = getRemotePort();
  const remoteReportUrl = `http://127.0.0.1:${port}/${config.compareReportURL}?remote`;
  return new Promise(function (resolve, reject) {
    // would prefer to ping a http://127.0.0.1:${port}/remote with {backstopRemote:ok} response
    logger.log('Attempting to ping ' + remoteReportUrl);
    http.get(remoteReportUrl, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        if (BACKSTOP_REPORT_SIGNATURE_RE.test(data)) {
          logger.log('Remote found. Opening ' + remoteReportUrl);
          resolve(open(remoteReportUrl, { wait: false }));
        } else {
          logger.log('Remote not detected. Opening ' + config.compareReportURL);
          resolve(open(config.compareReportURL, { wait: false }));
        }
      });
    }).on('error', (err) => {
      logger.log('Remote not found. Opening ' + config.compareReportURL + ' Error: ' + err.message);
      resolve(open(path.resolve(config.compareReportURL), { wait: false }));
    });
  });
}
