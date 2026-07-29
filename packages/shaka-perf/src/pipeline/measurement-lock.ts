/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';
// Reuse the toolkit's one PID-file lock core (fs-only; imported directly rather
// than via the 'shaka-shared' barrel to avoid pulling its chalk/page-helper
// graph). Here we drive it as an UNBOUNDED queue — wait our turn — rather than
// the bounded best-effort `withFileLock` wrapper.
import { tryAcquireLock, releaseLock, readLockHolderPid } from 'shaka-shared/dist/helpers/file-lock';

// A machine-wide queue for measurement runs. Two measurement sessions running
// at once contend for CPU/disk and corrupt each other's timings, so every
// shaka-perf run holds this lock for the duration of its measurements and any
// other instance waits its turn behind it.
//
// The lock is a single per-OS-user file (distinct users on a shared host don't
// block each other). The holder writes its PID; a holder that crashes or is
// Ctrl-C'd leaves the file behind, but the next waiter sees the dead PID
// (`kill -0`), clears it, and proceeds — so the queue can't wedge.

function defaultLockPath(): string {
  return path.join(
    os.tmpdir(),
    `shaka-perf-measure-${process.env.USER ?? process.env.USERNAME ?? 'shared'}.lock`,
  );
}

const DEFAULT_POLL_MS = 1000;
const STILL_WAITING_MS = 30_000;

export interface AcquireMeasurementLockOptions {
  /** Lock file path. Defaults to a per-user file in the OS temp dir. */
  lockPath?: string;
  /** How often to re-check a held lock, in ms. */
  pollMs?: number;
  /** Suppress the "waiting…" / "queue clear" log lines (tests). */
  quiet?: boolean;
}

export interface MeasurementLock {
  /** Release the lock so the next queued run can start. Idempotent. */
  release(): void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire the machine-wide measurement lock, waiting indefinitely for any other
 * run to finish first. Resolves with a handle whose `release()` frees the lock
 * for the next queued run.
 */
export async function acquireMeasurementLock(
  options: AcquireMeasurementLockOptions = {},
): Promise<MeasurementLock> {
  const lockPath = options.lockPath ?? defaultLockPath();
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  let announced = false;
  let lastNudge = 0;
  while (!tryAcquireLock(lockPath)) {
    const now = Date.now();
    if (!options.quiet && !announced) {
      announced = true;
      lastNudge = now;
      const holder = readLockHolderPid(lockPath);
      console.log(
        chalk.yellow(
          `⏳ Another shaka-perf measurement run is in progress${holder ? ` (pid ${holder})` : ''} — ` +
            'waiting for it to finish before starting measurements…',
        ),
      );
    } else if (!options.quiet && now - lastNudge >= STILL_WAITING_MS) {
      lastNudge = now;
      console.log(chalk.yellow('  …still waiting for the measurement queue.'));
    }
    await delay(pollMs);
  }
  if (!options.quiet && announced) {
    console.log(chalk.green('▶ Measurement queue clear — starting.'));
  }

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      // `releaseLock` only removes the file if it's still ours, so we never
      // clobber a lock a stale-takeover may have already handed to another run.
      releaseLock(lockPath);
    },
  };
}
