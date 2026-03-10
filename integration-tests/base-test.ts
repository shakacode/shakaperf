import { test as base } from '@playwright/test';
import { execSync } from 'child_process';
import { EXPERIMENT_CLONE_PATH, CONTROL_CLONE_PATH, loud, run } from './helpers';

// Use an auto-fixture so setup/teardown runs for every test that imports this
// `test` object, regardless of Node module caching across spec files.
export const test = base.extend<{ _containerLifecycle: void }>({
  _containerLifecycle: [async ({}, use, testInfo) => {
    // beforeEach: reset docker containers to their pristine state.
    run('yarn shaka-twin-servers start-containers', { timeout: 5 * 60 * 1000 });
    console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);
    console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>> TEST: ${testInfo.title}\x1b[0m`);
    console.log(`\n\x1b[1;31m>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\x1b[0m`);

    await use();

    // afterEach: reset git changes in temp clone
    loud('Resetting git changes in temp clone');
    execSync('git checkout .', { cwd: EXPERIMENT_CLONE_PATH, stdio: 'inherit' });
    execSync('git checkout .', { cwd: CONTROL_CLONE_PATH, stdio: 'inherit' });
  }, { auto: true }],
});

export { expect } from '@playwright/test';
