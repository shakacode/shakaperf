import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const packageJson = _require('../../package.json');
const { version } = packageJson;

export function execute (config) {
  return new Promise((resolve, reject) => {
    console.log('BackstopJS v' + version);
    resolve(version);
  });
}
