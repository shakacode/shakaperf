import streamToPromise from './../streamToPromise';
import fs from 'node:fs';
import path from 'node:path';

interface ResembleDiffData {
  getDiffImage: () => { pack: () => NodeJS.ReadableStream };
  getDiffImageAsJPEG: (quality: number) => Buffer;
}

export default function storeFailedDiff (testPath: string, data: ResembleDiffData) {
  const failedDiffFilename = getFailedDiffFilename(testPath);
  console.log('   See:', failedDiffFilename);

  const failedDiffStream = fs.createWriteStream(failedDiffFilename);
  const ext = failedDiffFilename.substring(failedDiffFilename.lastIndexOf('.') + 1);

  if (ext === 'png') {
    const storageStream = data.getDiffImage()
      .pack()
      .pipe(failedDiffStream);
    return streamToPromise(storageStream, failedDiffFilename);
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    fs.writeFileSync(failedDiffFilename, data.getDiffImageAsJPEG(85));
    return Promise.resolve(failedDiffFilename);
  }

  return Promise.resolve(failedDiffFilename);
}

function getFailedDiffFilename (testPath: string) {
  const lastSlash = testPath.lastIndexOf(path.sep);
  return testPath.slice(0, lastSlash + 1) + 'failed_diff_' + testPath.slice(lastSlash + 1, testPath.length);
}
