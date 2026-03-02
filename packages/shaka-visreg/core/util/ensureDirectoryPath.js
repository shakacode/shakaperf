import path from 'node:path';
import fs from 'node:fs';

function ensureDirectoryPath (filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryPath(dirname);
  fs.mkdirSync(dirname);
}

export default function (path) {
  return ensureDirectoryPath(path);
}
