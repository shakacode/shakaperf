import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const packageJson = _require('../../package.json');
const { version } = packageJson;

export function execute (_config: unknown) {
  return new Promise((resolve, _reject) => {
    console.log('BackstopJS v' + version);
    resolve(version);
  });
}
