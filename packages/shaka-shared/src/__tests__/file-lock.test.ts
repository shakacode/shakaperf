/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withFileLock, withFileLockAsync } from '../helpers/file-lock';

describe('withFileLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-lock-'));
    lockPath = path.join(dir, 'test.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs fn and returns its value', () => {
    expect(withFileLock(lockPath, () => 42)).toBe(42);
  });

  it('holds the lock during fn and releases it after', () => {
    expect(fs.existsSync(lockPath)).toBe(false);
    withFileLock(lockPath, () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('releases the lock even if fn throws', () => {
    expect(() => withFileLock(lockPath, () => { throw new Error('boom'); })).toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('takes over a stale lock left by a dead PID', () => {
    // A PID well above any Linux pid_max — never alive.
    fs.writeFileSync(lockPath, String(2147483646), 'utf8');
    expect(withFileLock(lockPath, () => 'ok', { retryMs: 5, maxAttempts: 3 })).toBe('ok');
    expect(fs.existsSync(lockPath)).toBe(false); // taken over, then released
  });

  it('runs unlocked (degraded) without removing a live holder\'s lock', () => {
    // Our own PID is alive, so we can't take over: give up after the budget,
    // run unlocked, and leave the holder's lock untouched.
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
    let ran = false;
    const result = withFileLock(lockPath, () => { ran = true; return 7; }, { retryMs: 1, maxAttempts: 2 });
    expect(ran).toBe(true);
    expect(result).toBe(7);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
  });

  it('calls onLockTimeout once when it can\'t take a live holder\'s lock', () => {
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
    const onLockTimeout = jest.fn();
    withFileLock(lockPath, () => 1, { retryMs: 1, maxAttempts: 2, onLockTimeout });
    expect(onLockTimeout).toHaveBeenCalledTimes(1);
  });
});

describe('withFileLockAsync', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-lock-'));
    lockPath = path.join(dir, 'test.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('holds the lock during fn (awaiting it) and releases after', async () => {
    expect(fs.existsSync(lockPath)).toBe(false);
    const result = await withFileLockAsync(lockPath, async () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
      return 42;
    });
    expect(result).toBe(42);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('releases the lock even if the awaited fn rejects', async () => {
    await expect(
      withFileLockAsync(lockPath, async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('runs unlocked and calls onLockTimeout against a live holder', async () => {
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
    const onLockTimeout = jest.fn();
    const result = await withFileLockAsync(
      lockPath,
      async () => 7,
      { retryMs: 1, maxAttempts: 2, onLockTimeout },
    );
    expect(result).toBe(7);
    expect(onLockTimeout).toHaveBeenCalledTimes(1);
    // The live holder's lock is left untouched.
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
  });
});
