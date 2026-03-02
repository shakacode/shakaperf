import crypto from 'node:crypto';
import fs from 'node:fs';

function getFileHash (filename) {
  if (!filename) {
    return '';
  }
  return new Promise(resolve => {
    const md5sum = crypto.createHash('md5');
    const stream = fs.ReadStream(filename);

    stream.on('data', d => md5sum.update(d));
    stream.on('end', () => resolve(md5sum.digest('hex')));
  });
}

export default function compareHashes (refImage, testImage) {
  return Promise.all([getFileHash(refImage), getFileHash(testImage)])
    .then(hashes => {
      if (hashes[0] !== hashes[1]) {
        throw new Error('Images do not match');
      }
      return {
        isSameDimensions: true,
        dimensionDifference: { width: 0, height: 0 },
        misMatchPercentage: '0.00'
      };
    });
}
