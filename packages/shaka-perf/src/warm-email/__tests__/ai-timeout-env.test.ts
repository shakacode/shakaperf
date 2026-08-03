/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { resolveA11yTimeoutMs } from '../a11y-summary-ai';
import { resolveAgentTimeoutMs } from '../agent-ready-summary-ai';
import { resolveNarrativeTimeoutMs } from '../client-report-narrative-ai';

type TimeoutResolver = () => number;

const stages: { env: string; fallback: number; resolve: TimeoutResolver }[] = [
  { env: 'SHAKAPERF_NARRATIVE_TIMEOUT_MS', fallback: 90_000, resolve: resolveNarrativeTimeoutMs },
  { env: 'SHAKAPERF_A11Y_TIMEOUT_MS', fallback: 150_000, resolve: resolveA11yTimeoutMs },
  { env: 'SHAKAPERF_AGENT_TIMEOUT_MS', fallback: 150_000, resolve: resolveAgentTimeoutMs },
];

describe.each(stages)('$env', ({ env, fallback, resolve }) => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    process.env = savedEnv;
    jest.restoreAllMocks();
  });

  it('uses the existing default silently when unset or empty', () => {
    delete process.env[env];
    expect(resolve()).toBe(fallback);
    process.env[env] = '';
    expect(resolve()).toBe(fallback);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('uses a valid value set after the module was imported', () => {
    process.env[env] = '275000';
    expect(resolve()).toBe(275_000);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-5', 'Infinity'])('warns and falls back for %s', (raw) => {
    process.env[env] = raw;
    expect(resolve()).toBe(fallback);
    expect(console.warn).toHaveBeenCalledWith(`shaka-perf: ignoring ${env}="${raw}" (expected a positive number of milliseconds)`);
  });
});
