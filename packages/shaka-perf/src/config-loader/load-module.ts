/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'path';
import { pathToFileURL } from 'url';

// Node strips TypeScript itself from v22.18 / v23.6; `undefined` before that.
// Probing the capability keeps older Node off the native path entirely, where
// every attempt would fail identically and log for nothing.
const NATIVE_TS = typeof (process.features as { typescript?: string }).typescript === 'string';

// Built via `new Function` so Jest's transform leaves it alone — Jest rewrites
// `import()` to `require()`, which cannot take the `file://` URL we pass.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<Record<string, any>>;

/**
 * Loads a user `.ts` or `.js` file, preferring real ESM and dropping to CJS
 * (tsx for `.ts`) if that fails for any reason. Native stripping replaces types
 * with whitespace rather than rewriting the file, which is what keeps esbuild's
 * `__name` out of serialized functions (see pre-navigation's KEEP_NAMES_SHIM)
 * and `abTest()`'s stack-derived `file:line` honest.
 *
 * Evaluates a given file at most once per process — every loader here caches,
 * and none of them can be talked out of it (native stripping keys `.ts` by path
 * and ignores a query string; `require` keys by path). Callers that need a
 * module's side effects more than once must remember them; see
 * `load-tests.ts`'s `registrationsByFile`. Returns the module namespace —
 * callers unwrap `default`.
 */
export async function loadModule(absolutePath: string): Promise<Record<string, any>> {
  const isTypeScript = path.extname(absolutePath) === '.ts';

  if (!isTypeScript || NATIVE_TS) {
    try {
      return await dynamicImport(pathToFileURL(absolutePath).href);
    } catch (error) {
      // Every failure falls through, so the reason is printed raw rather than
      // classified: a genuine mistake in the file stays visible instead of being
      // replaced by whatever the retry goes on to say. If the retry fails too,
      // its error propagates and both are on screen.
      console.log(`[shaka-perf] native load failed for ${absolutePath}, falling back to cjs:`);
      console.log(error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return isTypeScript
    ? require('tsx/cjs/api').require(absolutePath, __filename)
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(absolutePath);
}
