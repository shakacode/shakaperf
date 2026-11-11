/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { withFileLock } from '../file-lock';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('kernel file lock', () => {
  let dir: string;
  let filename: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-flock-'));
    filename = path.join(dir, 'operation.lock');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('preserves results and errors, and releases the lock after either', async () => {
    await expect(withFileLock(filename, async () => 42)).resolves.toBe(42);
    const error = new Error('operation failed');
    await expect(withFileLock(filename, async () => { throw error; })).rejects.toBe(error);
    await expect(withFileLock(filename, async () => 'released')).resolves.toBe('released');
  });

  it('queues another caller without blocking a different file', async () => {
    const entered = deferred();
    const finish = deferred();
    const owner = withFileLock(filename, async () => { entered.resolve(); await finish.promise; });
    await entered.promise;
    const waiting = deferred();
    let ran = false;
    const next = withFileLock(filename, async () => { ran = true; }, { onWait: waiting.resolve });
    await waiting.promise;
    expect(ran).toBe(false);
    await withFileLock(path.join(dir, 'other.lock'), async () => {});
    finish.resolve();
    await Promise.all([owner, next]);
    expect(ran).toBe(true);
  });

  it('cancels a waiter without releasing the active owner', async () => {
    const entered = deferred();
    const finish = deferred();
    const owner = withFileLock(filename, async () => { entered.resolve(); await finish.promise; });
    await entered.promise;
    const controller = new AbortController();
    const waiting = deferred();
    const run = jest.fn();
    const waiter = withFileLock(filename, run, { signal: controller.signal, onWait: waiting.resolve });
    const rejected = expect(waiter).rejects.toThrow();
    await waiting.promise;
    controller.abort();
    await rejected;
    expect(run).not.toHaveBeenCalled();
    const stillWaiting = deferred();
    const next = withFileLock(filename, async () => {}, { onWait: stillWaiting.resolve });
    await stillWaiting.promise;
    finish.resolve();
    await Promise.all([owner, next]);
  });

  it('releases a crashed owner automatically, even while its child remains alive', async () => {
    const binding = require.resolve('../../../build/Release/shaka_perf_socketpair.node');
    // The regular file descriptor must not leak into spawned build children.
    const script = `
      const fs = require('fs');
      const { spawn } = require('child_process');
      const fd = fs.openSync(process.argv[1], 'a');
      if (!require(process.argv[2]).tryFileLock(fd)) process.exit(2);
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.stdout.write(String(child.pid));
      setInterval(() => {}, 1000);
    `;
    const owner = spawn(process.execPath, ['-e', script, filename, binding], { stdio: ['ignore', 'pipe', 'pipe'] });
    let childPid: number | undefined;
    try {
      const [chunk] = await Promise.race([
        once(owner.stdout!, 'data'),
        once(owner, 'exit').then(([code]) => { throw new Error(`Lock owner exited before acquiring: ${code}`); }),
      ]);
      childPid = Number(String(chunk));
      const exited = once(owner, 'exit');
      owner.kill('SIGKILL');
      await exited;
      process.kill(childPid, 0);
      await withFileLock(filename, async () => {}, { signal: AbortSignal.timeout(2000) });
    } finally {
      owner.kill('SIGKILL');
      if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
    }
  });
});
