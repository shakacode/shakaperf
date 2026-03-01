import fs from 'node:fs';
import fsExtra from 'fs-extra';
import promisify from './promisify.js';

const fsPromisified = {
  readdir: promisify(fs.readdir),
  createWriteStream: fs.createWriteStream,
  existsSync: fs.existsSync,
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile),
  ensureDir: promisify(fsExtra.ensureDir),
  unlink: promisify(fs.unlink),
  remove: promisify(fsExtra.remove),
  stat: promisify(fs.stat),
  copy: promisify(fsExtra.copy),
  exists: function exists (file) {
    return fsPromisified.stat(file)
      .then(function (args) {
        return args[0];
      })
      .catch(function () {
        return false;
      });
  }
};

export default fsPromisified;
