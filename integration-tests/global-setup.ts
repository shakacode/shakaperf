import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  TMP_ROOT, EXPERIMENT_CLONE_PATH, CONTROL_CLONE_PATH, ORIGINAL_REPO, DEMO_CWD,
  env, loud, run, timed,
} from './helpers';

export default async function globalSetup() {
  if (process.env.SKIP_GLOBAL_SETUP === '1') {
    console.log('Skipping global setup (SKIP_GLOBAL_SETUP=1)');
    return;
  }
  // Clean previous temp directory
  if (fs.existsSync(TMP_ROOT)) {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  // Copy current working directory as the experiment repo (includes uncommitted changes)
  loud('Copying current directory as experiment repo');
  timed('rsync experiment', () => execSync(
    `rsync -a --exclude=node_modules "${ORIGINAL_REPO}/" "${EXPERIMENT_CLONE_PATH}/"`,
    { stdio: 'inherit' },
  ));

  // Commit any uncommitted changes in the copy so git checkout . works in afterEach
  // --no-verify: skip pre-commit hooks (they run typecheck via Yarn PnP, which
  // fails because the global cache paths in .pnp.cjs are relative and don't
  // resolve correctly in the temp directory — yarn install hasn't run yet)
  timed('git commit experiment', () => execSync('git add -A && git commit --no-verify --allow-empty -m "integration test snapshot"', {
    cwd: EXPERIMENT_CLONE_PATH,
    stdio: 'inherit',
  }));

  // Copy experiment as control (same codebase, no need to checkout main separately)
  loud('Copying experiment repo as control');
  timed('rsync control', () => execSync(
    `rsync -a --exclude=node_modules "${EXPERIMENT_CLONE_PATH}/" "${CONTROL_CLONE_PATH}/"`,
    { stdio: 'inherit' },
  ));

  
  // Replace <LazySection> with <div> in experiment so bench tests measure
  // the perf impact of lazy-loading vs eager rendering.
  // Also adjust hero padding so visreg tests detect a visual change.
  const homePagePath = path.join(
    EXPERIMENT_CLONE_PATH,
    'demo-ecommerce/app/javascript/components/pages/HomePage.tsx',
  );
  loud('Replacing <LazySection> with <div> and adjusting hero padding in experiment HomePage');
  const homePageContent = fs.readFileSync(homePagePath, 'utf-8');
  fs.writeFileSync(
    homePagePath,
    homePageContent
      .replace(/<LazySection>/g, '<div>')
      .replace(/<\/LazySection>/g, '</div>')
      .replace(/py: \{ xs: 6, md: 10 \}/, 'py: { xs: 6, md: 14 }'),
  );

  timed('git commit experiment changes', () => execSync('git add -A && git commit --no-verify --allow-empty -m "integration test snapshot"', {
    cwd: EXPERIMENT_CLONE_PATH,
    stdio: 'inherit',
  }));

  // Install and build in temp clone
  loud('Installing dependencies in temp clone');
  timed('yarn install', () => execSync('yarn install', {
    cwd: EXPERIMENT_CLONE_PATH,
    env,
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  }));

  loud('Building packages in temp clone');
  timed('yarn build', () => execSync('yarn build', {
    cwd: EXPERIMENT_CLONE_PATH,
    env,
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  }));

  // Build docker images and start containers
  run('yarn shaka-perf twin-servers build', { timeout: 15 * 60 * 1000 });
  run('yarn shaka-perf twin-servers start-containers', { timeout: 5 * 60 * 1000 });
}
