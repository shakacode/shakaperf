import * as path from 'path';
import { pathToFileURL } from 'url';

let loadCounter = 0;

export async function loadTestFile(testFilePath: string): Promise<void> {
  const absolutePath = path.resolve(testFilePath);
  const ext = path.extname(absolutePath);

  // Bust the ESM / tsx module cache so repeated loadTests() calls in the same
  // process (e.g. once per category in `compare`) actually re-execute the
  // top-level abTest() registrations instead of hitting cached no-op imports.
  const cacheBust = `?shaka-perf-load=${++loadCounter}`;

  if (ext === '.ts') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tsImport } = require('tsx/esm/api');
      const specifier = pathToFileURL(absolutePath).href + cacheBust;
      await tsImport(specifier, __filename);
    } catch (esmError) {
      // Fallback to CJS API (e.g. Node 18 CommonJS context).
      // The CJS require-cache is keyed by absolute path with no query-string
      // support, so we invalidate it explicitly before re-requiring.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tsx = require('tsx/cjs/api');
      delete require.cache[absolutePath];
      tsx.require(absolutePath, __filename);
    }
  } else {
    const specifier = pathToFileURL(absolutePath).href + cacheBust;
    await import(specifier);
  }
}
