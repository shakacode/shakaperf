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

// Built via `new Function` so Jest's `import()` transform leaves it alone —
// otherwise Jest treats the `?shaka-perf-load=N` cache-bust as part of the path.
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
 * Pass `cacheBust` to force re-execution on a repeated load; omit it to let the
 * module cache stand. Returns the module namespace — callers unwrap `default`.
 */
export async function loadModule(
  absolutePath: string,
  cacheBust = '',
): Promise<Record<string, any>> {
  const isTypeScript = path.extname(absolutePath) === '.ts';

  if (!isTypeScript || NATIVE_TS) {
    try {
      return await dynamicImport(pathToFileURL(absolutePath).href + cacheBust);
    } catch (error) {
      // Every failure falls through, so the reason is printed raw rather than
      // classified: a genuine mistake in the file stays visible instead of being
      // replaced by whatever the retry goes on to say. If the retry fails too,
      // its error propagates and both are on screen.
      console.log(`[shaka-perf] native load failed for ${absolutePath}, falling back to cjs:`);
      console.log(error);
    }
  }

  // tsx's CJS api caches under `<path>?namespace=<id>` keys as well as the bare
  // path, so drop every entry for this file or the re-require is a silent no-op.
  if (cacheBust) {
    for (const key of Object.keys(require.cache)) {
      if (key === absolutePath || key.startsWith(`${absolutePath}?`)) delete require.cache[key];
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return isTypeScript
    ? require('tsx/cjs/api').require(absolutePath, __filename)
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(absolutePath);
}
