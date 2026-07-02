/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// At runtime this file is at dist/visreg/core/command/, package.json is 4 levels up
const packageJson = require('../../../../package.json');
const { version } = packageJson;

export function execute (_config: unknown) {
  return new Promise((resolve, _reject) => {
    console.log('shaka-perf v' + version);
    resolve(version);
  });
}
