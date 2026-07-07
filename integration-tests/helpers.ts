/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
// before any spec body runs. Falling back to ORIGINAL_REPO lets specs
// that just need a running demo-ecommerce (e.g. the audit spec) run
// against the developer's local twin-server containers in seconds.
// Specs that *modify* the clone (twin-servers.spec, bench.spec,
// visreg.spec) still need the full setup and should not be combined
// with SKIP_GLOBAL_SETUP=1.
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
