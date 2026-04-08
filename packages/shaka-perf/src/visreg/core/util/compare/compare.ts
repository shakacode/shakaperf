import compareHashes from './compare-hash';
import compareResemble from './compare-resemble';
import storeFailedDiff from './store-failed-diff';
import type { TestPair, ResembleOutputOptions, DiffResult } from '../../types';

interface ResembleDiffData extends DiffResult {
  getDiffImage: () => { pack: () => NodeJS.ReadableStream };
  getDiffImageAsJPEG: (quality: number) => Buffer;
}

process.on('message', compare);

function compare (data: { referencePath: string; testPath: string; resembleOutputSettings: ResembleOutputOptions; pair: TestPair }) {
  const { referencePath, testPath, resembleOutputSettings, pair } = data;
  const promise = compareHashes(referencePath, testPath)
    .catch(() => compareResemble(referencePath, testPath, pair.misMatchThreshold, resembleOutputSettings, pair.requireSameDimensions));
  promise
    .then(function (result: unknown) {
      pair.diff = result as DiffResult;
      pair.status = 'pass';
      return sendMessage(pair);
    })
    .catch(function (result: unknown) {
      const diffData = result as ResembleDiffData;
      pair.diff = diffData;
      pair.status = 'fail';

      return storeFailedDiff(testPath, diffData).then(function (compare: unknown) {
        pair.diffImage = compare as string;
        return sendMessage(pair);
      });
    });
}

function sendMessage (data: TestPair) {
  process.send!(data);
}
