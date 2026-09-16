/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { markCurrentProcess, PROCESS_MARKER_ENV_VAR, VERSION_ENV_VAR } from '../program';

describe('markCurrentProcess', () => {
  const saved = {
    marker: process.env[PROCESS_MARKER_ENV_VAR],
    version: process.env[VERSION_ENV_VAR],
  };

  afterEach(() => {
    if (saved.marker === undefined) delete process.env[PROCESS_MARKER_ENV_VAR];
    else process.env[PROCESS_MARKER_ENV_VAR] = saved.marker;
    if (saved.version === undefined) delete process.env[VERSION_ENV_VAR];
    else process.env[VERSION_ENV_VAR] = saved.version;
  });

  // shaka-shared's abTest() rejects a process that carries the marker but no
  // version as "too old to report its version" — so the two must be set together,
  // whichever entry point (bin/shaka-perf.js, the dev wrapper, node dist/cli.js) ran.
  it('publishes the process marker and the runner version together', () => {
    delete process.env[PROCESS_MARKER_ENV_VAR];
    delete process.env[VERSION_ENV_VAR];

    markCurrentProcess('0.3.1');

    expect(process.env[PROCESS_MARKER_ENV_VAR]).toBe('true');
    expect(process.env[VERSION_ENV_VAR]).toBe('0.3.1');
  });

  it('uses the env var name shaka-shared reads', () => {
    expect(VERSION_ENV_VAR).toBe('SHAKA_PERF_VERSION');
  });
});
