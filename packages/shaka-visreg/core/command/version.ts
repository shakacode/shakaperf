import packageJson from '../../package.json' with { type: 'json' };

const { version } = packageJson;

export function execute (config) {
  return new Promise((resolve, reject) => {
    console.log('BackstopJS v' + version);
    resolve(version);
  });
}
