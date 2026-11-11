/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface FileLockOptions {
  signal?: AbortSignal;
  onWait?: () => void;
}

/** Hold a kernel file lock on a host-local file while running an operation. The OS releases it on
 * close or process death. Keep the file: unlinking it could give waiters different locks. */
export async function withFileLock<T>(
  filename: string,
  run: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  options.signal?.throwIfAborted();
  // Reuse the package's existing N-API addon.
  const native = require('../../build/Release/shaka_perf_socketpair.node') as {
    tryFileLock(fd: number): boolean;
  };
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const fd = fs.openSync(filename, 'a', 0o600);
  try {
    let waiting = false;
    while (!native.tryFileLock(fd)) {
      options.signal?.throwIfAborted();
      if (!waiting) {
        options.onWait?.();
        waiting = true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    options.signal?.throwIfAborted();
    return await run();
  } finally {
    fs.closeSync(fd);
  }
}
