import path from 'node:path';
import fs from 'node:fs';

function ensureDirectoryPath (filePath: string) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return;
  }
  ensureDirectoryPath(dirname);
  fs.mkdirSync(dirname);
}

export default function (path: string) {
  return ensureDirectoryPath(path);
}
