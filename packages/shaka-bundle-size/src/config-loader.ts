/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';

// Tiny local copy of the loader that used to live in shaka-shared. Kept here
// so shaka-shared can stay loader-free (user projects that only consume the
// `abTest` API don't transitively pull tsx). shaka-perf has its own copy at
// `src/config-loader/`; if both diverge, reconcile via the matching file
// there.

let namespaceCounter = 0;

/**
 * Stands in for tsx's `tsImport()`, which is unusable on Node 24: it leaves the
 * CJS require-hook registered, and that hook's `?namespace=<id>` cache-key
 * reaches the ESM resolver percent-encoded *inside* the URL pathname, so the
 * resolver looks for a file literally named `index.js?namespace=<id>` and
 * throws. Any config importing anything from disk fails to load.
 * See privatenumber/tsx#801; still reproduces on tsx 4.23.6.
 *
 * `register({ namespace })` is the same namespaced ESM loader `tsImport()` uses
 * internally, without the stray CJS registration. Mirrors
 * `shaka-perf/src/config-loader/tsx-import.ts` — reconcile both if either moves.
 */
async function tsxImport(specifier: string, parentPath: string): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { register } = require('tsx/esm/api');
  const scoped = register({ namespace: `shaka-bundle-size-${++namespaceCounter}` });
  return scoped.import(specifier, pathToFileURL(parentPath).href);
}

export function findConfigFile(filenames: string[], cwd: string = process.cwd()): string | null {
  for (const filename of filenames) {
    const configPath = path.join(cwd, filename);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

export async function loadConfigFile(configPath: string): Promise<Record<string, unknown>> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath);

  if (ext !== '.js' && ext !== '.ts') {
    throw new Error(`Unsupported config file extension: ${ext}. Use .js or .ts`);
  }

  let configModule;

  if (ext === '.ts') {
    try {
      const tsModule = await tsxImport(absolutePath, __filename);
      configModule = tsModule.default?.default ?? tsModule.default ?? tsModule;
    } catch (esmError) {
      // Fallback to CJS API (e.g. Node 18 CommonJS context)
      console.log(`tsx ESM import failed, falling back to CJS API...`);
      console.log(esmError instanceof Error ? esmError.stack : esmError);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tsx = require('tsx/cjs/api');
      const tsModule = tsx.require(absolutePath, __filename);
      configModule = tsModule.default ?? tsModule;
    }
  } else {
    configModule = await import(absolutePath);
  }

  const config = configModule.default || configModule;

  if (!config || typeof config !== 'object') {
    throw new Error(`Config file must export a configuration object: ${absolutePath}`);
  }

  return config as Record<string, unknown>;
}
