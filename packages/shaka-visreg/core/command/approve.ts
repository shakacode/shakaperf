import { readdir } from 'node:fs/promises';
import { copy } from 'fs-extra';
import path from 'node:path';
import map from 'p-map';
import type { RuntimeConfig } from '../types.js';

const FAILED_DIFF_RE = /^failed_diff_/;
const FILTER_DEFAULT = /\w+/;

// This task will copy ALL test bitmap files (from the most recent test directory) to the reference directory overwriting any existing files.
export async function execute (config: RuntimeConfig) {
  // TODO:  IF Exists config.bitmaps_test  &&  list.length > 0n  (otherwise throw)
  console.log('Copying from ' + config.bitmaps_test + ' to ' + config.bitmaps_reference + '.');
  const list = await readdir(config.bitmaps_test);
  const src = path.join(config.bitmaps_test, list[list.length - 1]);
  const files = await readdir(src);
  console.log('The following files will be promoted to reference...');

  return map(files, async (file: string) => {
    if (FAILED_DIFF_RE.test(file)) {
      file = file.replace(FAILED_DIFF_RE, '');

      let imageFilter = FILTER_DEFAULT;
      if (config.args && config.args.filter) {
        imageFilter = new RegExp(config.args.filter as string);
      }
      if (imageFilter.test(file)) {
        console.log('> ', file);
        await copy(path.join(src, file), path.join(config.bitmaps_reference, file));
      }
    }
  });
}
