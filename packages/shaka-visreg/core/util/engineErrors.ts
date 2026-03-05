import { readFileSync } from 'node:fs';
import type { RuntimeConfig, TestPair } from '../types.js';

export default function engineErrors (config: RuntimeConfig) {
  const compareConfig = JSON.parse(readFileSync(config.tempCompareConfigFileName, 'utf8')).compareConfig;
  const error = compareConfig.testPairs.find((testPair: TestPair) => {
    return !!testPair.engineErrorMsg;
  });

  if (error) {
    return Promise.reject(error);
  }
  return Promise.resolve();
};
