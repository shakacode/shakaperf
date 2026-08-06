/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'path';
import { registerTsExtensionResolver } from './register-ts-extensions';
import { loadModule } from './load-module';

/**
 * Imports a test file for its side effect: the top-level `abTest()` calls that
 * register into the process-global registry.
 *
 * Fires only on the first import of a given file in this process — see
 * `loadModule`. `loadTests` is what makes repeated loads work, by remembering
 * each file's registrations rather than asking for them twice.
 */
export async function loadTestFile(testFilePath: string): Promise<void> {
  // Let test files use extensionless / `.js` relative imports (see the hook).
  registerTsExtensionResolver();
  await loadModule(path.resolve(testFilePath));
}
