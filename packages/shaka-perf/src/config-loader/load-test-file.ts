/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'path';
import { pathToFileURL } from 'url';
import { registerTsExtensionResolver } from './register-ts-extensions';
import { tsxImport } from './tsx-import';

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
    // Let test files use extensionless / `.js` relative imports (see the hook).
    registerTsExtensionResolver();
    try {
      const specifier = pathToFileURL(absolutePath).href + cacheBust;
      await tsxImport(specifier, __filename);
    } catch (esmError) {
      // Fallback to CJS API (e.g. Node 18 CommonJS context, or newer Node
      // where the ESM path rejects the file — e.g. native type-stripping
      // chokes on a type imported without `import type`).
      // tsx's CJS api caches under `<path>?namespace=<id>` keys (and a plain
      // require under the bare path), so drop every cache entry for this
      // file before re-requiring — `delete require.cache[absolutePath]`
      // alone leaves the namespaced entry behind and the re-require would
      // silently be a no-op, registering zero tests.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tsx = require('tsx/cjs/api');
      for (const key of Object.keys(require.cache)) {
        if (key === absolutePath || key.startsWith(`${absolutePath}?`)) {
          delete require.cache[key];
        }
      }
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
