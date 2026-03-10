import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
  // --no-verify: skip pre-commit hooks (they run typecheck via Yarn PnP, which
  // fails because the global cache paths in .pnp.cjs are relative and don't
  // resolve correctly in the temp directory — yarn install hasn't run yet)
  execSync('git add -A && git commit --no-verify --allow-empty -m "integration test snapshot"', {
    cwd: EXPERIMENT_CLONE_PATH,
    stdio: 'inherit',
  });

  // Copy experiment as control (same codebase, no need to checkout main separately)
  loud('Copying experiment repo as control');
  execSync(
    `rsync -a --exclude=node_modules "${EXPERIMENT_CLONE_PATH}/" "${CONTROL_CLONE_PATH}/"`,
    { stdio: 'inherit' },
  );

  
  // Replace <LazySection> with <div> in experiment so bench tests measure
  // the perf impact of lazy-loading vs eager rendering
  const homePagePath = path.join(
    EXPERIMENT_CLONE_PATH,
    'demo-ecommerce/app/javascript/components/pages/HomePage.tsx',
  );
  loud('Replacing <LazySection> with <div> in experiment HomePage');
  const homePageContent = fs.readFileSync(homePagePath, 'utf-8');
  fs.writeFileSync(
    homePagePath,
    homePageContent
      .replace(/<LazySection>/g, '<div>')
      .replace(/<\/LazySection>/g, '</div>'),
  );

  execSync('git add -A && git commit --no-verify --allow-empty -m "integration test snapshot"', {
    cwd: EXPERIMENT_CLONE_PATH,
    stdio: 'inherit',
  });

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
