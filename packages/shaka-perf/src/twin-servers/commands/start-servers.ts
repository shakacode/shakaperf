/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess, type StdioOptions } from 'child_process';
import type { ResolvedConfig } from '../types';
import { requireCommand } from '../helpers/shell';
import { dockerComposeExec } from '../helpers/docker';
import { printBanner, printError } from '../helpers/ui';

export interface StartServersOptions {
  verbose?: boolean;
}

export interface OvermindHandle {
  child: ChildProcess;
  /** Resolves when overmind exits (any reason). */
  done: Promise<void>;
  /** Send SIGTERM + run the in-container PID cleanup; safe to call repeatedly. */
  stop: () => Promise<void>;
}

export interface SpawnOvermindOptions {
  /**
   * - `'inherit'` (default for `startServers`): overmind owns the TTY directly.
   * - `'pipe'`: stdin is ignored, stdout/stderr are piped so a parent process
   *   can multiplex overmind's output with its own UI (used by the servers
   *   menu).
   */
  stdio: 'inherit' | 'pipe';
}

/**
 * Kill any overmind-tracked PIDs lingering inside both containers and delete
 * their `/tmp/overmind-pid.*` marker files, leaving a clean slate for the next
 * overmind spawn. Best-effort: failures warn but never throw, so callers tearing
 * down on Ctrl+C aren't blocked and a cold start isn't aborted just because a
 * container isn't up yet.
 *
 * Run both at teardown (`stop`) and before a cold start: `stop` only fires on a
 * graceful exit, so a session killed with SIGKILL — or a hard terminal close, or
 * a crash — leaves puma alive inside the `sleep infinity` containers, still
 * holding the ports. Without this pre-start sweep the next overmind spawn dies
 * with "address already in use".
 */
export async function cleanupContainerPids(config: ResolvedConfig): Promise<void> {
  for (const server of ['experiment-server', 'control-server']) {
    const result = await dockerComposeExec(
      config,
      server,
      "cat /tmp/overmind-pid.* | xargs -i bash -c 'echo Interrupting session {} && kill $(ps -s {} -o pid=) || true'; rm -f /tmp/overmind-pid.*",
    );
    if (result.code !== 0) {
      // Don't throw — callers may be Ctrl+C and need to keep tearing down, or
      // cold-starting before containers are up — but surface so a stale puma in
      // the container isn't completely silent.
      process.stderr.write(
        `warning: overmind cleanup in ${server} exited ${result.code}` +
          (result.stderr ? `: ${result.stderr.trim()}` : '') + '\n',
      );
    }
  }
}

/**
 * Spawn overmind against the configured Procfile and return a handle that
 * lets callers either wait for it to exit (`done`) or stop it cleanly
 * (`stop`). `stop` also kills lingering overmind-tracked PIDs inside both
 * containers so a follow-up spawn starts from a clean slate.
 */
export function spawnOvermind(
  config: ResolvedConfig,
  options: SpawnOvermindOptions,
): OvermindHandle {
  if (!fs.existsSync(config.procfile)) {
    printError(`Procfile not found: ${config.procfile}`);
    process.exit(1);
  }
  requireCommand('overmind', 'brew install overmind (Mac) or go install github.com/DarthSim/overmind/ (Linux)');

  const stdio: StdioOptions = options.stdio === 'inherit'
    ? 'inherit'
    : ['ignore', 'pipe', 'pipe'];

  // Remove any stale socket from a previous run — if it sticks around,
  // overmind refuses to start with "address already in use". (The path is
  // also in rebuild-check's ALWAYS_IGNORE so the live socket's mtime churn
  // doesn't keep flipping the rebuild signal.)
  fs.rmSync(path.join(config.projectDir, '.overmind.sock'), { force: true });

  const child = spawn('overmind', [
    'start',
    '-f', config.procfile,
    '-d', config.projectDir,
  ], {
    cwd: config.projectDir,
    stdio,
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR || '1',
      CLICOLOR_FORCE: process.env.CLICOLOR_FORCE || '1',
      TERM: process.env.TERM || 'xterm-256color',
    },
  });

  let cleanupDone = false;
  const stop = async (): Promise<void> => {
    if (cleanupDone) return;
    cleanupDone = true;

    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
      const exited = await new Promise<boolean>((res) => {
        const timeout = setTimeout(() => res(false), 5000);
        child.once('close', () => {
          clearTimeout(timeout);
          res(true);
        });
      });
      if (!exited && child.exitCode === null) {
        // Overmind ignored SIGTERM for 5 s — escalate. A hung overmind
        // holds the .overmind.sock and keeps puma alive in the
        // container, so leaving it running corrupts the next session.
        process.stderr.write('warning: overmind did not exit on SIGTERM; sending SIGKILL\n');
        child.kill('SIGKILL');
        await new Promise<void>((res) => {
          const timeout = setTimeout(() => res(), 2000);
          child.once('close', () => { clearTimeout(timeout); res(); });
        });
      }
    }

    await cleanupContainerPids(config);
  };

  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => {
      reject(new Error(`Failed to start overmind: ${error.message}`));
    });
    child.on('close', () => {
      resolve();
    });
  });

  return { child, done, stop };
}

/**
 * Non-interactive entry point: spawn overmind with full TTY ownership and
 * wait for it to exit. Used by `servers start-servers` and as the fallback
 * for environments where the interactive menu can't run.
 */
export async function startServers(
  config: ResolvedConfig,
  _options: StartServersOptions = {},
): Promise<void> {
  printBanner('Starting Rails Servers');
  console.log('Starting servers via Overmind...');
  console.log('');

  // Sweep stale PIDs from any session that died without running stop().
  await cleanupContainerPids(config);

  const handle = spawnOvermind(config, { stdio: 'inherit' });

  let isExiting = false;
  const signalHandler = async (signal: NodeJS.Signals) => {
    if (isExiting) return;
    isExiting = true;
    console.log(`\nReceived ${signal}, cleaning up...`);
    await handle.stop();
    process.exit(0);
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  try {
    await handle.done;
  } finally {
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    if (!isExiting) await handle.stop();
  }
}
