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

// Cast: `features.typescript` is absent from @types/node 20, which this package
// still builds against, and the field is a runtime probe either way.
const NATIVE_TS = typeof (process.features as { typescript?: string }).typescript === 'string';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<Record<string, any>>;

/** Mirrors shaka-perf's `load-module.ts` — reconcile both if either changes. */
async function loadModule(absolutePath: string): Promise<Record<string, any>> {
  const isTypeScript = path.extname(absolutePath) === '.ts';
  if (!isTypeScript || NATIVE_TS) {
    try {
      return await dynamicImport(pathToFileURL(absolutePath).href);
    } catch (error) {
      console.log(
        `[shaka-bundle-size] native load failed for ${absolutePath}, falling back to tsx:`,
      );
      console.log(error);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return isTypeScript
    ? require('tsx/cjs/api').require(absolutePath, __filename)
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(absolutePath);
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

  const configModule = await loadModule(absolutePath);
  const config = configModule.default || configModule;

  if (!config || typeof config !== 'object') {
    throw new Error(`Config file must export a configuration object: ${absolutePath}`);
  }

  return config as Record<string, unknown>;
}
