import { test as base } from '@playwright/test';
import { execSync } from 'child_process';
import { EXPERIMENT_CLONE_PATH, CONTROL_CLONE_PATH, loud, startServers, waitForPort, run } from './helpers';

export const test = base.extend({});

test.beforeEach(async ({}, testInfo) => {
  // This will reset docker containers to their pristine state.
  run('yarn shaka-twin-servers start-containers', { timeout: 5 * 60 * 1000 });
  console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);
  console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>> TEST: ${testInfo.title}\x1b[0m`);
  console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);
});

test.afterEach(async ({ page }, testInfo) => {
  loud('Resetting git changes in temp clone');
  execSync('git checkout .', { cwd: EXPERIMENT_CLONE_PATH, stdio: 'inherit' });
  execSync('git checkout .', { cwd: CONTROL_CLONE_PATH, stdio: 'inherit' });
});

export { expect } from '@playwright/test';
