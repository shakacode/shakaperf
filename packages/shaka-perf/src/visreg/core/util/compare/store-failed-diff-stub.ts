import fs from 'node:fs';
import path from 'node:path';

// BASE64_PNG_STUB is 1x1 white pixel
const BASE64_PNG_STUB = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

// Utility to ensure the approve step finds a diff image
// call when no reference image exists.
export default function storeFailedDiffStub (testPath: string) {
  fs.writeFileSync(getFailedDiffFilename(testPath), BASE64_PNG_STUB, 'base64');
}

function getFailedDiffFilename (testPath: string) {
  const lastSlash = testPath.lastIndexOf(path.sep);
  return testPath.slice(0, lastSlash + 1) + 'failed_diff_' + testPath.slice(lastSlash + 1, testPath.length);
}
