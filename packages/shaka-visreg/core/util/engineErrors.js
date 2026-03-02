import { readFileSync } from 'node:fs';

export default function engineErrors (config) {
  const compareConfig = JSON.parse(readFileSync(config.tempCompareConfigFileName, 'utf8')).compareConfig;
  const error = compareConfig.testPairs.find(testPair => {
    return !!testPair.engineErrorMsg;
  });

  if (error) {
    return Promise.reject(error);
  }
  return Promise.resolve();
};
