/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from '../helpers/shell';
import { stopProjectBuildxBuilder } from '../helpers/docker';
import {
  withProjectBuildxOperation,
  stopProjectBuildxBuilderSafely,
  cancelProjectBuildxOperations,
} from '../helpers/buildx-lifecycle';
import type { ResolvedConfig } from '../types';

jest.mock('../helpers/docker', () => ({ stopProjectBuildxBuilder: jest.fn() }));
const stop = jest.mocked(stopProjectBuildxBuilder);
const config = { projectSlug: 'lifecycle-test' } as ResolvedConfig;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('Buildx operation ownership', () => {
  let dir: string;
  let previousRuntime: string | undefined;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildx-lifecycle-'));
    previousRuntime = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = dir;
    stop.mockReset().mockResolvedValue(undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previousRuntime;
    fs.rmSync(dir, { recursive: true, force: true });
    warn.mockRestore();
  });

  it('cleans up on success and failure without replacing the operation result', async () => {
    stop.mockRejectedValue(new Error('Docker unavailable'));
    const before = process.listenerCount('SIGINT');
    await expect(withProjectBuildxOperation(config, () => true, async () => 42)).resolves.toBe(42);
    const original = new Error('build failed');
    await expect(withProjectBuildxOperation(config, () => true, async () => { throw original; }))
      .rejects.toBe(original);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Docker unavailable'));
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('cancels a spawned build command without reporting success', async () => {
    const controller = new AbortController();
    const command = exec(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal, silent: true });
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      expect((await command).code).not.toBe(0);
    } finally {
      clearTimeout(timer);
    }
  });

  it('retains the builder when a session owns it', async () => {
    await withProjectBuildxOperation(config, () => false, async () => {});
    expect(stop).not.toHaveBeenCalled();
  });

  it('queues cleanup behind an active build and excludes another same-project operation', async () => {
    const entered = deferred();
    const finish = deferred();
    const first = withProjectBuildxOperation(config, () => false, async () => {
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    let secondEntered = false;
    const second = withProjectBuildxOperation(config, () => false, async () => { secondEntered = true; });
    const cleanup = stopProjectBuildxBuilderSafely(config);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(secondEntered).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    // An unrelated project does not wait for this project's build.
    await withProjectBuildxOperation({ projectSlug: 'other-project' } as ResolvedConfig, () => false, async () => {});
    finish.resolve();
    await Promise.all([first, second, cleanup]);
    expect(secondEntered).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('cancels the active operation before stopping the builder on menu exit', async () => {
    const entered = deferred();
    const operation = withProjectBuildxOperation(config, interrupted => interrupted, async signal => {
      entered.resolve();
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    });
    const rejected = expect(operation).rejects.toThrow('cancelled');
    await entered.promise;
    cancelProjectBuildxOperations(config);
    await rejected;
    expect(stop).toHaveBeenCalledWith(config);
  });
});
