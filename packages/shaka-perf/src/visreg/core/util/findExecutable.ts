/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

export default function findExecutable (module: string, bin: string) {
  try {
    const pathToExecutableModulePackageJson = require.resolve(path.join(module, 'package.json'));
    const executableModulePackageJson = JSON.parse(readFileSync(pathToExecutableModulePackageJson, 'utf8'));
    const relativePathToExecutableBinary = executableModulePackageJson.bin[bin] || executableModulePackageJson.bin;
    const pathToExecutableModule = pathToExecutableModulePackageJson.replace('package.json', '');
    return path.join(pathToExecutableModule, relativePathToExecutableBinary);
  } catch (e: unknown) {
    throw new Error('Couldn\'t find executable for module "' + module + '" and bin "' + bin + '"\n' + (e instanceof Error ? e.message : String(e)));
  }
};
