import compareHashes from './compare-hash.js';
import compareResemble from './compare-resemble.js';
import storeFailedDiff from './store-failed-diff.js';
import type { TestPair, ResembleOutputOptions } from '../../types.js';

process.on('message', compare);

function compare (data: { referencePath: string; testPath: string; resembleOutputSettings: ResembleOutputOptions; pair: TestPair }) {
  const { referencePath, testPath, resembleOutputSettings, pair } = data;
  const promise = compareHashes(referencePath, testPath)
    .catch(() => compareResemble(referencePath, testPath, pair.misMatchThreshold, resembleOutputSettings, pair.requireSameDimensions));
  promise
    .then(function (data: any) {
      pair.diff = data;
      pair.status = 'pass';
      return sendMessage(pair);
    })
    .catch(function (data: any) {
      pair.diff = data;
      pair.status = 'fail';

      return storeFailedDiff(testPath, data).then(function (compare: unknown) {
        pair.diffImage = compare as string;
        return sendMessage(pair);
      });
    });
}

function sendMessage (data: TestPair) {
  process.send!(data);
}
