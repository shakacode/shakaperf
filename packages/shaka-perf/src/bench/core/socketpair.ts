/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Native AF_LOCAL socketpair() — wraps the in-tree N-API binding at
// `<package>/build/Release/shaka_perf_socketpair.node`. Returns a pair of
// non-blocking, close-on-exec fds usable for the per-worker barrier-sync
// channel in `lighthouse-sampling-worker-pool.ts`.
//
// The relative path resolves identically from `src/bench/core/socketpair.ts`
// (ts-jest, dev) and from `dist/bench/core/socketpair.js` (built output).
//
// The native binding is derived from `unix-socketpair` by Maarten de Vries
// <maarten@de-vri.es> (https://github.com/de-vri-es/node-unix-socketpair),
// BSD-3-Clause. See `../../../native/socketpair.cpp`.

interface NativeBinding {
  socketpair(): [number, number];
}

const native = require('../../../build/Release/shaka_perf_socketpair.node') as NativeBinding;

export function socketpair(): [number, number] {
  return native.socketpair();
}
