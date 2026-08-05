/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { registerTsExtensionResolver } from './register-ts-extensions';
import { loadModule } from './load-module';

export async function loadConfigFile(configPath: string): Promise<Record<string, unknown>> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath);

  if (ext !== '.js' && ext !== '.ts') {
    throw new Error(`Unsupported config file extension: ${ext}. Use .js or .ts`);
  }

  // Let the config use extensionless / `.js` relative imports (see the hook).
  registerTsExtensionResolver();
  const configModule = await loadModule(absolutePath);
  const config = configModule.default || configModule;

  if (!config || typeof config !== 'object') {
    throw new Error(`Config file must export a configuration object: ${absolutePath}`);
  }

  return config as Record<string, unknown>;
}

