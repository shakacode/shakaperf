import * as path from 'path';
import { pathToFileURL } from 'url';

let loadCounter = 0;

// Built via `new Function` so Jest's `import()` transform leaves it alone —
// otherwise Jest's resolver chokes on the `?shaka-perf-load=N` cache-bust
// query string and treats the whole URL as a literal file path.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

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
    try {
      const specifier = pathToFileURL(absolutePath).href + cacheBust;
      await dynamicImport(specifier);
    } catch (esmError) {
      // CJS fallback for environments without ESM dynamic import (e.g. Jest's
      // default VM without --experimental-vm-modules). Mirrors the .ts branch.
      delete require.cache[absolutePath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(absolutePath);
    }
  }
}
