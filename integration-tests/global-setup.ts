import { execSync } from 'child_process';
import * as fs from 'fs';
import {
  TMP_ROOT, EXPERIMENT_CLONE_PATH, CONTROL_CLONE_PATH, ORIGINAL_REPO, DEMO_CWD,
  env, loud, run, startServers, waitForPort,
} from './helpers';

export default async function globalSetup() {
  // Clean previous temp directory
  if (fs.existsSync(TMP_ROOT)) {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  // Copy current working directory as the experiment repo (includes uncommitted changes)
  loud('Copying current directory as experiment repo');
  execSync(
    `rsync -a --exclude=node_modules "${ORIGINAL_REPO}/" "${EXPERIMENT_CLONE_PATH}/"`,
    { stdio: 'inherit' },
  );

  // Commit any uncommitted changes in the copy so git checkout . works in afterEach
  execSync('git add -A && git commit --allow-empty -m "integration test snapshot"', {
    cwd: EXPERIMENT_CLONE_PATH,
    stdio: 'inherit',
  });

  // Clone control copy (main branch) from local repo
  loud('Cloning control repo (branch: main)');
  execSync(
    `git clone --branch main "${ORIGINAL_REPO}" "${CONTROL_CLONE_PATH}"`,
    { stdio: 'inherit' },
  );

  // Install and build in temp clone
  loud('Installing dependencies in temp clone');
  execSync('yarn install', {
    cwd: EXPERIMENT_CLONE_PATH,
    env,
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  });

  loud('Building packages in temp clone');
  execSync('yarn build', {
    cwd: EXPERIMENT_CLONE_PATH,
    env,
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  });

  // Build docker images
  run('yarn shaka-twin-servers build', { timeout: 15 * 60 * 1000 });
}
