/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'path';
import { registerTsExtensionResolver } from './register-ts-extensions';
import { loadModule } from './load-module';

let loadCounter = 0;

export async function loadTestFile(testFilePath: string): Promise<void> {
  const absolutePath = path.resolve(testFilePath);

  // Bust the module cache so repeated loadTests() calls in the same process
  // (e.g. once per category in `compare`) actually re-execute the top-level
  // abTest() registrations instead of hitting cached no-op imports.
  const cacheBust = `?shaka-perf-load=${++loadCounter}`;

  // Let test files use extensionless / `.js` relative imports (see the hook).
  registerTsExtensionResolver();
  await loadModule(absolutePath, cacheBust);
}
