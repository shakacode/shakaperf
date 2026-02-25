import { execSync } from 'child_process';
import * as fs from 'fs';
import {
  TMP_ROOT, TEMP_CLONE_PATH, CONTROL_CLONE_PATH, ORIGINAL_REPO, DEMO_CWD,
  env, loud, run, startServers, waitForPort,
} from './helpers';

export default async function globalSetup() {
  // Clean previous temp directory
  if (fs.existsSync(TMP_ROOT)) {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  // Detect current branch
  const branch = execSync('git branch --show-current', {
    cwd: ORIGINAL_REPO,
  }).toString().trim();
  loud(`Current branch: ${branch}`);

  // Ensure working tree is clean and all commits are pushed to origin
  const dirty = execSync('git status --porcelain', {
    cwd: ORIGINAL_REPO,
  }).toString().trim();
  if (dirty) {
    throw new Error(
      'Working tree has uncommitted changes. Commit and push your changes before running integration tests.\n' +
      `Dirty files:\n${dirty}`,
    );
  }

  const localSha = execSync(`git rev-parse ${branch}`, {
    cwd: ORIGINAL_REPO,
  }).toString().trim();
  let remoteSha: string;
  try {
    remoteSha = execSync(`git rev-parse origin/${branch}`, {
      cwd: ORIGINAL_REPO,
    }).toString().trim();
  } catch {
    throw new Error(
      `Branch "${branch}" does not exist on origin. Push your branch before running integration tests:\n` +
      `  git push -u origin ${branch}`,
    );
  }
  if (localSha !== remoteSha) {
    throw new Error(
      `Branch "${branch}" has unpushed commits (local: ${localSha.slice(0, 8)}, origin: ${remoteSha.slice(0, 8)}). ` +
      `Push your changes before running integration tests:\n` +
      `  git push origin ${branch}`,
    );
  }

  // Clone experiment copy (current branch)
  loud(`Cloning experiment repo (branch: ${branch})`);
  execSync(
    `git clone --branch ${branch} "${ORIGINAL_REPO}" "${TEMP_CLONE_PATH}"`,
    { stdio: 'inherit' },
  );

  // Clone control copy (main branch)
  loud('Cloning control repo (branch: main)');
  execSync(
    `git clone --branch main "${ORIGINAL_REPO}" "${CONTROL_CLONE_PATH}"`,
    { stdio: 'inherit' },
  );

  // Install and build in temp clone
  loud('Installing dependencies in temp clone');
  execSync('yarn install', {
    cwd: TEMP_CLONE_PATH,
    env,
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  });

  loud('Building packages in temp clone');
  execSync('yarn build', {
    cwd: TEMP_CLONE_PATH,
    env,
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  });

  // Build docker images
  run('yarn shaka-twin-servers build', { timeout: 15 * 60 * 1000 });

  // Start containers
  run('yarn shaka-twin-servers start-containers', { timeout: 5 * 60 * 1000 });

  // Start servers
  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([
    waitForPort(3020),
    waitForPort(3030),
  ]);
}
