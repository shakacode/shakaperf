/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { pathToFileURL } from 'node:url';

let namespaceCounter = 0;

/**
 * Loads a `.ts` file through tsx's ESM loader. Stands in for tsx's own
 * `tsImport()`, which is unusable on Node 24.
 *
 * `tsImport()` registers the CJS require-hook before it picks an import path,
 * and leaves it registered when it takes the ESM one. That hook appends
 * `?namespace=<id>` to resolved paths to key its `Module._cache`. Up to Node 22
 * `require(esm)` stayed inside CJS code paths and the query never escaped; from
 * Node 24 it dispatches through the module customization hooks, where
 * `pathToFileURL()` encodes the `?` as `%3F` *inside the URL pathname*. A
 * percent-encoded `?` is a literal character, not a query delimiter, so the ESM
 * resolver stats a file actually named `index.js?namespace=<id>` and throws
 * ERR_MODULE_NOT_FOUND. Any config or test file importing anything from disk —
 * relative or bare — fails to load; only builtins and import-free files survive.
 *
 * Upstream: privatenumber/tsx#801, open since 2026-05-22. Fix PR #802 is
 * mergeable but unreviewed; still reproduces on tsx 4.23.6.
 *
 * `register({ namespace })` returns the same namespaced ESM loader `tsImport()`
 * drives internally, minus the stray CJS registration — so resolution works and
 * each call still gets its own module registry (repeated loads re-execute the
 * file rather than hitting a cached no-op).
 *
 * Registrations are deliberately not unregistered, matching `tsImport()`, which
 * never did either. They are cheap: 40 sequential loads stay linear at ~2ms
 * each with no accumulation.
 *
 * @param specifier  Absolute path or `file:` URL of the file to load.
 * @param parentPath Importing module's path — pass `__filename`.
 */
export async function tsxImport(
  specifier: string,
  parentPath: string,
): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { register } = require('tsx/esm/api');
  const scoped = register({ namespace: `shaka-perf-${++namespaceCounter}` });
  return scoped.import(specifier, pathToFileURL(parentPath).href);
}
