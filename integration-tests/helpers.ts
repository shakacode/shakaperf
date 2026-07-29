/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { assignPortsAutomatically } from '../packages/shaka-shared/src/assign-ports';

export const TMP_ROOT = '/tmp/temp-shaka-perf-repos-for-tests';
export const ORIGINAL_REPO = path.resolve(__dirname, '..');

// Live-mode escape hatch. When SKIP_GLOBAL_SETUP=1 is set the global
// setup never creates the /tmp temp clones, so the helpers would point
// every cwd at a non-existent path and execSync would throw ENOENT
// before any spec body runs. Falling back to ORIGINAL_REPO lets a spec
// that just needs a running demo-ecommerce (the OCR audit spec) run
// against the developer's local twin-server containers in seconds.
// Specs that DEPEND ON the changes global setup bakes into the clone —
// twin-servers.spec, bench.spec, visreg.spec (LazySection swap, hero
// padding, broken products selector), and client-report.spec (its audit
// must exit non-zero via that broken selector; it self-skips in live
// mode) — cannot run with SKIP_GLOBAL_SETUP=1.
const TMP_EXPERIMENT = path.join(TMP_ROOT, 'shaka-perf');
const TMP_CONTROL = path.join(TMP_ROOT, 'shaka-perf-control');
export const EXPERIMENT_CLONE_PATH = (process.env.SKIP_GLOBAL_SETUP === '1' && !fs.existsSync(TMP_EXPERIMENT))
  ? ORIGINAL_REPO
  : TMP_EXPERIMENT;
export const CONTROL_CLONE_PATH = (process.env.SKIP_GLOBAL_SETUP === '1' && !fs.existsSync(TMP_CONTROL))
  ? path.resolve(ORIGINAL_REPO, '..', 'shaka-perf-control')
  : TMP_CONTROL;
export const DEMO_CWD = path.join(EXPERIMENT_CLONE_PATH, 'demo-ecommerce');

// Resolve the same auto-assigned pair that demo-ecommerce/abtests.config.ts
// would pick, using DEMO_CWD as the sticky assignment key because every
// shaka-perf child process below runs from that directory. Then pin the pair
// into the child env so config evaluation, waitForPort(), and page.goto() all
// agree even if the allocator shifts away from the preferred ports.
const ASSIGNED_PORTS = assignPortsAutomatically({
  control: 3060,
  experiment: 3090,
  key: DEMO_CWD,
}, {
  settingsPath: path.join(os.tmpdir(), 'shaka-perf-integration-ports.json'),
});
export const CONTROL_PORT = ASSIGNED_PORTS.control;
export const EXPERIMENT_PORT = ASSIGNED_PORTS.experiment;

export const env: Record<string, string> = {
  ...process.env as Record<string, string>,
  DEMO_CONTROL_PORT: String(CONTROL_PORT),
  DEMO_EXPERIMENT_PORT: String(EXPERIMENT_PORT),
  CONTROL_REPO_DIR: path.join(CONTROL_CLONE_PATH, 'demo-ecommerce'),
};


// The global setup injects a broken selector into the experiment clone's
// products.abtest.ts (and COMMITS it) so visreg exercises the engine-error
// path. The audit OCR spec needs that flow working again — this rewrites the
// selector back as an UNCOMMITTED change, which base-test's afterEach
// `git checkout .` reverts, so later suites still see the sabotage.
export function restoreProductsSelector(): void {
  const abtestPath = path.join(
    EXPERIMENT_CLONE_PATH,
    'demo-ecommerce/ab-tests/products.abtest.ts',
  );
  const content = fs.readFileSync(abtestPath, 'utf-8');
  const restored = content.replace(
    'category-option-electronics-fake-broken-selector',
    'category-option-electronics',
  );
  if (restored !== content) {
    fs.writeFileSync(abtestPath, restored);
    loud('Restored working products.abtest.ts selector for this spec');
  }
}

/**
 * Guard for commands whose non-zero exit is the EXPECTED outcome. Call from
 * the catch block: rethrows anything that is NOT a plain non-zero exit —
 * timeout kills (signal), OOM kills, spawn failures (code) — so "failed as
 * designed" can't be conflated with "crashed or timed out".
 */
export function assertPlainNonZeroExit(e: unknown, what: string): void {
  const err = e as { status?: number | null; signal?: string | null; code?: string };
  if (typeof err.status === 'number' && err.status !== 0 && !err.signal) return;
  throw new Error(
    `${what} was expected to fail with a plain non-zero exit, but got `
    + `status=${err.status ?? 'null'} signal=${err.signal ?? 'none'} code=${err.code ?? 'none'} — `
    + 'that is a crash/timeout/spawn failure, not the engineered failure',
    { cause: e },
  );
}

// Child processes emit chalk colors through pipes, and chalk re-opens the style
// after every newline — so a line inside a multi-line colored block starts mid
// escape sequence. Strip before matching on line content.
export const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

const GREEN_BOLD = '\x1b[1;32m';
const RESET = '\x1b[0m';

export function loud(msg: string): void {
  console.log(`\n${GREEN_BOLD}>>> ${msg}${RESET}\n`);
}

export function timed(label: string, fn: () => void): void {
  const start = Date.now();
  fn();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ⏱ ${label}: ${elapsed}s`);
}

// Like `timed`, but prints the `>>>` stage banner first and awaits an
// async body — so every spec stage emits both its banner and a `⏱` marker
// even when its work is a `run()` that throws (a compare/audit expected to
// exit non-zero never reaches run()'s own trailing timer). Returns the
// body's value so a stage can hand back what it produced.
export async function stage<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  loud(label);
  const start = Date.now();
  const result = await fn();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ⏱ ${label}: ${elapsed}s`);
  return result;
}

export function run(cmd: string, opts: { cwd?: string; timeout?: number } = {}): string {
  const { cwd = DEMO_CWD, timeout = 10 * 60 * 1000 } = opts;
  loud(`run: ${cmd}`);
  const start = Date.now();
  const output = execSync(cmd, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
  });
  const text = output.toString();
  if (text) console.log(text);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ⏱ ${elapsed}s`);
  return text;
}

export function waitForPort(port: number, timeout = 180_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - start > timeout) {
        return reject(new Error(`Port ${port} did not respond within ${timeout}ms`));
      }
      const req = http.get(`http://localhost:${port}/up`, (res) => {
        if (res.statusCode === 200) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`  ⏱ waitForPort(${port}): ${elapsed}s`);
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

function portIsResponding(port: number): boolean {
  try {
    execSync(`curl -sf -o /dev/null --max-time 2 http://localhost:${port}/`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function startServers(): void {
  // Skip puma startup when servers already respond — protects the
  // live-mode integration runs (SKIP_GLOBAL_SETUP=1) where the
  // developer's containers already have puma listening on the
  // mapped host ports. Starting it again would fail port-bind in
  // the container and noisily abort the spec.
  if (portIsResponding(CONTROL_PORT) && portIsResponding(EXPERIMENT_PORT)) {
    loud(`Skipping startServers — ports ${CONTROL_PORT} + ${EXPERIMENT_PORT} already respond`);
    return;
  }
  loud('Starting puma in both containers');
  run(`yarn shaka-perf servers run-cmd control "${PUMA_CMD} > /tmp/puma.log 2>&1 &"`);
  run(`yarn shaka-perf servers run-cmd experiment "${PUMA_CMD} > /tmp/puma.log 2>&1 &"`);
}

export function stopServers(): void {
  loud('Stopping puma in both containers');
  try { run('yarn shaka-perf servers run-cmd control "pkill -f puma || true"'); } catch { /* ignore */ }
  try { run('yarn shaka-perf servers run-cmd experiment "pkill -f puma || true"'); } catch { /* ignore */ }
}
