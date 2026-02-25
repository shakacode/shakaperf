import { test as base } from '@playwright/test';
import { execSync } from 'child_process';
import { TEMP_CLONE_PATH, loud, startServers, waitForPort, run } from './helpers';

export const test = base.extend({});

test.beforeEach(async ({}, testInfo) => {
  console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);
  console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>> TEST: ${testInfo.title}\x1b[0m\n`);
  console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);
});

test.afterEach(async () => {
  loud('Resetting git changes in temp clone');
  execSync('git checkout .', { cwd: TEMP_CLONE_PATH, stdio: 'inherit' });

  loud('Resetting containers and servers to initial state');
  run('yarn shaka-twin-servers start-containers', { timeout: 5 * 60 * 1000 });
  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([
    waitForPort(3020),
    waitForPort(3030),
  ]);
});

export { expect } from '@playwright/test';
