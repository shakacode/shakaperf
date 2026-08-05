/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { registerTsExtensionResolver } from './register-ts-extensions';
import { tsxImport } from './tsx-import';

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
    // Let the config use extensionless / `.js` relative imports (see the hook).
    registerTsExtensionResolver();
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

