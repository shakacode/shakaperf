/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// ESM `resolve` loader hook. Node's ESM resolver requires explicit file
// extensions on relative imports, and tsx does not add them for the external
// `.ts` config / `.abtest.ts` files we load via `tsImport`. That makes a
// perfectly normal `import './foo'` (or the TS "NodeNext" `import './foo.js'`)
// in a user's `abtests.config.ts` fail with ERR_MODULE_NOT_FOUND — most
// painfully inside the forked Lighthouse worker, which re-loads the config and
// then silently runs without the user's `beforeNavigate`.
//
// This hook chains with tsx: when the default resolution of a RELATIVE
// specifier fails as "not found", it retries with real on-disk TypeScript
// extensions appended (and, for `./x.js`, the `./x.ts` source). It never
// touches bare package specifiers or already-resolvable paths, so it can't
// change any currently-working resolution — it only rescues ones that error.
const SUFFIXES = ['.ts', '.tsx', '.mts', '.cts', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const code = err && err.code;
    const rescuable = code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNSUPPORTED_DIR_IMPORT';
    if (!specifier.startsWith('.') || !rescuable) throw err;

    // `./x.js` / `.jsx` / `.mjs` / `.cjs` (NodeNext-style) → also try `./x.ts`.
    const stem = specifier.replace(/\.[cm]?jsx?$/, '');
    const candidates = new Set();
    for (const s of SUFFIXES) candidates.add(specifier + s);
    for (const s of SUFFIXES) candidates.add(stem + s);

    for (const candidate of candidates) {
      if (candidate === specifier) continue;
      try {
        return await nextResolve(candidate, context);
      } catch {
        // keep trying the remaining candidates
      }
    }
    throw err;
  }
}
