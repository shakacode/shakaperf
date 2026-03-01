import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { version } = _require('../../package.json');

export function execute (config) {
  return new Promise((resolve, reject) => {
    console.log('BackstopJS v' + version);
    resolve(version);
  });
}
