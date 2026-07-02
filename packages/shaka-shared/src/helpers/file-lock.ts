/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';

// The toolkit's one inter-process file lock, built on a PID-file: a holder
// creates the lock file with `O_CREAT|O_EXCL` and writes its PID; a holder that
// crashes leaves the file behind, but the next contender sees the dead PID
// (`kill -0`), clears it, and takes over — so a lock can never wedge forever.
//
// This module owns that subtle create/takeover/release core exactly once. On
// top of it sit two usage shapes, so callers never reimplement the primitive:
//   - `withFileLock` / `withFileLockAsync` — scoped, best-effort: try for a
//     bounded budget then run `fn` UNLOCKED rather than hang (e.g. the
//     ports.json read-modify-write at config-load, or serializing `say`).
//   - the exported primitives (`tryAcquireLock` / `releaseLock` /
//     `readLockHolderPid`) — for callers that need a different control flow,
//     e.g. an unbounded queue that waits its turn (the measurement lock).
//
// `fs` is the only dependency, so leaf modules can import this directly without
// pulling in the rest of the package.

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't kill — it just probes whether the PID is reachable.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The PID recorded in the lock file, or null if missing/unreadable/garbled. */
export function readLockHolderPid(lockPath: string): number | null {
  try {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'));
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Create the lock file atomically. True if we now hold it, false if it already
 *  exists. Any error other than EEXIST (e.g. ENOENT — the parent dir is
 *  missing) propagates. */
function createLockFile(lockPath: string): boolean {
  try {
    const fd = fs.openSync(
      lockPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    );
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return false;
  }
}

/**
 * One acquisition attempt. Returns true if we now hold the lock. A free lock is
 * taken; a lock held by a live process is left alone (returns false); a stale
 * lock (crashed/garbled holder) is cleared and re-taken in the same call. The
 * lock file's parent directory must already exist.
 */
export function tryAcquireLock(lockPath: string): boolean {
  if (createLockFile(lockPath)) return true;
  const holder = readLockHolderPid(lockPath);
  if (holder !== null && isProcessAlive(holder)) return false; // held by a live run
  // Stale (crashed/Ctrl-C'd holder, or a garbled PID file) — clear and retry once.
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Someone else cleared or re-took it between our read and unlink.
  }
  return createLockFile(lockPath);
}

/**
 * Release the lock, but only if we still hold it — so we never clobber a lock a
 * stale-takeover may have already handed to another run. Idempotent.
 */
export function releaseLock(lockPath: string): void {
  if (readLockHolderPid(lockPath) !== process.pid) return;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already gone — fine.
  }
}

export interface WithFileLockOptions {
  /** Milliseconds to wait between acquisition attempts. */
  retryMs?: number;
  /** Maximum attempts before giving up and running unlocked (degraded). */
  maxAttempts?: number;
  /**
   * Called once if the lock can't be acquired within the retry budget, right
   * before `fn` runs UNLOCKED. Lets the caller surface the lapse (e.g. warn the
   * user) instead of silently dropping the mutual-exclusion guarantee.
   */
  onLockTimeout?: () => void;
}

const DEFAULT_RETRY_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 50; // 50 * 100ms = 5s

/** Block the current thread for `ms` without yielding the event loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding an exclusive lock on `lockPath`, releasing it
 * afterwards (even if `fn` throws). If the lock can't be acquired within the
 * retry budget, `fn` still runs — unlocked — rather than hanging; pass
 * `onLockTimeout` to be notified when that happens. Synchronous: the retry
 * sleep blocks the thread (`Atomics.wait`), so this is usable in a sync call
 * path (e.g. while a config module is being evaluated).
 *
 * The directory containing `lockPath` must exist before calling.
 */
export function withFileLock<T>(
  lockPath: string,
  fn: () => T,
  options: WithFileLockOptions = {},
): T {
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let acquired = false;
  for (let attempt = 0; attempt < maxAttempts && !acquired; attempt++) {
    if (tryAcquireLock(lockPath)) acquired = true;
    else sleepSync(retryMs);
  }
  if (!acquired) options.onLockTimeout?.();

  try {
    return fn();
  } finally {
    if (acquired) releaseLock(lockPath);
  }
}

/**
 * Async sibling of {@link withFileLock}: same acquire/takeover protocol, but
 * the retry sleep yields the event loop (`setTimeout`) and `fn` may be async —
 * the lock is held until its promise settles. Use when the critical section
 * awaits (e.g. a child process). Same degraded-but-never-hang semantics.
 */
export async function withFileLockAsync<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: WithFileLockOptions = {},
): Promise<T> {
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let acquired = false;
  for (let attempt = 0; attempt < maxAttempts && !acquired; attempt++) {
    if (tryAcquireLock(lockPath)) acquired = true;
    else await new Promise((r) => setTimeout(r, retryMs));
  }
  if (!acquired) options.onLockTimeout?.();

  try {
    return await fn();
  } finally {
    if (acquired) releaseLock(lockPath);
  }
}
