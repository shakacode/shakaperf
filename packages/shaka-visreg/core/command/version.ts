const packageJson = require('../../package.json');
const { version } = packageJson;

export function execute (_config: unknown) {
  return new Promise((resolve, _reject) => {
    console.log('shaka-visreg v' + version);
    resolve(version);
  });
}
