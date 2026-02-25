import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const TMP_ROOT = '/tmp/temp-shaka-perf-repos-for-tests';
const TEMP_CLONE_PATH = path.join(TMP_ROOT, 'shaka-perf');
const CONTROL_CLONE_PATH = path.join(TMP_ROOT, 'shaka-perf-control');
const ORIGINAL_REPO = path.resolve(__dirname, '..');
const DEMO_CWD = path.join(TEMP_CLONE_PATH, 'demo-ecommerce');

const HOME_PAGE_FILE = path.join(
  TEMP_CLONE_PATH,
  'demo-ecommerce/app/javascript/components/pages/HomePage.tsx',
);

const env: Record<string, string> = {
  ...process.env as Record<string, string>,
  CONTROL_REPO_DIR: path.join(CONTROL_CLONE_PATH, 'demo-ecommerce'),
};

const composeEnv: Record<string, string> = {
  ...env,
  CI_IMAGE_NAME: 'demo-ecommerce:experiment',
  CI_CONTROL_IMAGE_NAME: 'demo-ecommerce:control',
  USER: process.env.USER || 'user',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GREEN_BOLD = '\x1b[1;32m';
const RESET = '\x1b[0m';

function loud(msg: string): void {
  console.log(`\n${GREEN_BOLD}>>> ${msg}${RESET}\n`);
}

function run(cmd: string, opts: { cwd?: string; timeout?: number } = {}): string {
  const { cwd = DEMO_CWD, timeout = 10 * 60 * 1000 } = opts;
  loud(`run: ${cmd}`);
  const output = execSync(cmd, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
  });
  const text = output.toString();
  if (text) console.log(text);
  return text;
}

function waitForPort(port: number, timeout = 180_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - start > timeout) {
        return reject(new Error(`Port ${port} did not respond within ${timeout}ms`));
      }
      const req = http.get(`http://localhost:${port}/up`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(attempt, 2000);
        }
        res.resume();
      });
      req.on('error', () => setTimeout(attempt, 2000));
      req.setTimeout(5000, () => {
        req.destroy();
        setTimeout(attempt, 2000);
      });
    };
    attempt();
  });
}

const PUMA_CMD = 'bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000';

function dockerCompose(args: string, opts: { timeout?: number } = {}): string {
  const cmd = `docker compose -f docker-compose.yml ${args}`;
  const output = execSync(cmd, {
    cwd: DEMO_CWD,
    env: composeEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: opts.timeout ?? 60_000,
  });
  const text = output.toString();
  if (text) console.log(text);
  return text;
}

function startServers(): void {
  loud('Starting puma in both containers (detached)');
  dockerCompose(`exec -d -T control-server bash -c '${PUMA_CMD}'`);
  dockerCompose(`exec -d -T experiment-server bash -c '${PUMA_CMD}'`);
}

function stopServers(): void {
  loud('Stopping puma in both containers');
  for (const container of ['control-server', 'experiment-server']) {
    try {
      dockerCompose(`exec -T ${container} bash -c "pkill -f puma || true"`);
    } catch {
      // ignore — container may already be stopped
    }
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests (serial — each step depends on the previous one)
// ---------------------------------------------------------------------------

test.describe.serial('twin-servers lifecycle', () => {
  test.beforeAll(async () => {
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
  });

  test.afterAll(async () => {
    // Tear down docker compose (only if the clone exists)
    if (fs.existsSync(DEMO_CWD)) {
      try {
        loud('RUNNING DOCKER COMPOSE DOWN');
        execSync('docker compose down --remove-orphans', {
          cwd: DEMO_CWD,
          env: composeEnv,
          stdio: 'inherit',
          timeout: 2 * 60 * 1000,
        });
      } catch (e) {
        console.error('docker compose down failed:', e);
      }
    }

    // Leave /tmp/shaka-perf/ for debugging
  });

  test.beforeEach(async ({}, testInfo) => {
    loud(`TEST: ${testInfo.title}`);
  });

  test('build docker images', async () => {
    test.setTimeout(15 * 60 * 1000);
    run('yarn shaka-twin-servers build', { timeout: 15 * 60 * 1000 });
  });

  test('start containers', async () => {
    test.setTimeout(5 * 60 * 1000);
    run('yarn shaka-twin-servers start-containers', { timeout: 5 * 60 * 1000 });
  });

  test('start servers and verify initial content', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    startServers();

    loud('Waiting for ports 3020 + 3030');
    await Promise.all([
      waitForPort(3020),
      waitForPort(3030),
    ]);

    loud('Verifying experiment server has "Discover Your Style"');
    await page.goto('http://localhost:3030');
    await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
  });

  test('modify, sync, rebuild, verify diverged content', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);

    // 1. Stop servers
    stopServers();

    // 2. Modify HomePage.tsx in the temp clone
    loud('Modifying HomePage.tsx: "Discover Your Style" -> "Discover Your New Self"');
    const homePageContent = fs.readFileSync(HOME_PAGE_FILE, 'utf-8');
    const updatedContent = homePageContent.replace(
      'Discover Your Style',
      'Discover Your New Self',
    );
    fs.writeFileSync(HOME_PAGE_FILE, updatedContent);

    // 3. Sync changes to experiment container
    run('yarn shaka-twin-servers sync-changes experiment');

    // 4. Rebuild assets in both containers
    run('yarn shaka-twin-servers run-cmd-parallel -- bundle exec rake assets:precompile', {
      timeout: 5 * 60 * 1000,
    });

    // 5. Restart servers
    startServers();
    loud('Waiting for ports 3020 + 3030');
    await Promise.all([
      waitForPort(3020),
      waitForPort(3030),
    ]);

    // 6. Verify experiment has new content
    loud('Verifying experiment (3030) has "Discover Your New Self"');
    await page.goto('http://localhost:3030');
    await expect(page.getByText('Discover Your New Self')).toBeVisible({ timeout: 30_000 });

    // 7. Verify control still has original content
    loud('Verifying control (3020) still has "Discover Your Style"');
    await page.goto('http://localhost:3020');
    await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
  });
});
