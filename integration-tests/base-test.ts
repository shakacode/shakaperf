/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test as base } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { EXPERIMENT_CLONE_PATH, CONTROL_CLONE_PATH, ORIGINAL_REPO, loud, timed } from './helpers';

// Use an auto-fixture so setup/teardown runs for every test that imports this
// `test` object, regardless of Node module caching across spec files.
export const test = base.extend<{ _containerLifecycle: void }>({
  _containerLifecycle: [async ({}, use, testInfo) => {
    console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);
    console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>> TEST: ${testInfo.title}\x1b[0m`);
    console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);

    await use();

    // afterEach: reset git changes in the temp clones the global setup
    // created. SKIP_GLOBAL_SETUP=1 retargets the clone paths at the
    // developer's live working tree (see helpers.ts) — DO NOT
    // `git checkout .` there, that would wipe in-flight work.
    if (EXPERIMENT_CLONE_PATH === ORIGINAL_REPO) {
      loud('Live-mode run — skipping git checkout reset of working tree');
      return;
    }
    loud('Resetting git changes in temp clone');
    if (fs.existsSync(EXPERIMENT_CLONE_PATH)) {
      timed('git checkout experiment', () => execSync('git checkout .', { cwd: EXPERIMENT_CLONE_PATH, stdio: 'inherit' }));
    }
    if (fs.existsSync(CONTROL_CLONE_PATH)) {
      timed('git checkout control', () => execSync('git checkout .', { cwd: CONTROL_CLONE_PATH, stdio: 'inherit' }));
    }
  }, { auto: true }],
});

export { expect } from '@playwright/test';
