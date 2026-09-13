/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { abTest, clearRegistry, getRegisteredTests } from '../ab-test-registry';

jest.mock('../../package.json', () => ({ version: '0.10.4' }));

describe('ShakaPerf minimum version', () => {
  const savedVersion = process.env.SHAKA_PERF_VERSION;
  const savedMarker = process.env.IS_SHAKA_PERF_PROCESS;

  afterEach(() => {
    if (savedVersion === undefined) delete process.env.SHAKA_PERF_VERSION;
    else process.env.SHAKA_PERF_VERSION = savedVersion;
    if (savedMarker === undefined) delete process.env.IS_SHAKA_PERF_PROCESS;
    else process.env.IS_SHAKA_PERF_PROCESS = savedMarker;
    clearRegistry();
  });

  it('rejects a runner that marks its process but reports no version', () => {
    delete process.env.SHAKA_PERF_VERSION;
    process.env.IS_SHAKA_PERF_PROCESS = 'true';
    expect(() => abTest('test', { startingPath: '/' }, async () => {})).toThrow(
      'shaka-shared 0.10.4 requires shaka-perf >= 0.10.4, but the running shaka-perf is too old to report its version. Upgrade shaka-perf',
    );
    expect(getRegisteredTests()).toHaveLength(0);
  });

  it.each(['0.9.99', '0.10.3'])('rejects older runner %s before registering a test', (version) => {
    process.env.SHAKA_PERF_VERSION = version;
    expect(() => abTest('test', { startingPath: '/' }, async () => {})).toThrow(
      `shaka-shared 0.10.4 requires shaka-perf >= 0.10.4, but ${version} is running. Upgrade shaka-perf`,
    );
    expect(getRegisteredTests()).toHaveLength(0);
  });

  it.each([undefined, '0.10.4', '0.10.4-rc.1', '0.10.5', '0.11.0', '1.0.0'])(
    'allows an absent, equal, or newer runner (%s)',
    (version) => {
      if (version === undefined) delete process.env.SHAKA_PERF_VERSION;
      else process.env.SHAKA_PERF_VERSION = version;
      // Outside a shaka-perf process (plain node, an editor) nothing is checked.
      delete process.env.IS_SHAKA_PERF_PROCESS;
      abTest('test', { startingPath: '/' }, async () => {});
      expect(getRegisteredTests()).toHaveLength(1);
    },
  );
});
