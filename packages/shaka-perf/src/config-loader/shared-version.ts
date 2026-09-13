/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// The exact dependency pin is the minimum shared version this runner supports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requiredShared: string = require('../../package.json').dependencies['shaka-shared'];

const install =
  `yarn add --exact shaka-shared@${requiredShared} ` +
  `(or: npm install --save-exact shaka-shared@${requiredShared})`;

/**
 * Throws unless the `shaka-shared` a user file would import (resolved from the
 * file's own location, like its `import` will be) is at least this runner's
 * pin. Runs before the file is evaluated, so the mismatch is reported instead
 * of whatever a too-old `abTest()` would do with newer options.
 */
export function assertCompatibleSharedVersion(userFilePath: string): void {
  let sharedPackage: string;
  try {
    sharedPackage = createRequire(userFilePath).resolve('shaka-shared/package.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
    throw new Error(
      `shaka-shared is not installed for ${userFilePath}. ` +
      `This shaka-perf requires shaka-shared >= ${requiredShared}. Install it: ${install}.`,
    );
  }
  const installed: string = JSON.parse(readFileSync(sharedPackage, 'utf8')).version;
  const required = requiredShared.split('-', 1)[0].split('.').map(Number);
  const actual = installed.split('-', 1)[0].split('.').map(Number);
  if ((actual.map((part, i) => part - required[i]).find((n) => n !== 0) ?? 0) < 0) {
    throw new Error(
      `${userFilePath} uses shaka-shared ${installed}, but this shaka-perf requires >= ${requiredShared}. ` +
      `Upgrade it: ${install}.`,
    );
  }
}
