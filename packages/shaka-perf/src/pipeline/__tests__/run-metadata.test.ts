/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DEFAULT_LH_CONFIG } from '../../bench/core/lighthouse-config';
import { measurementCommand, lighthouseThrottling } from '../run-metadata';

describe('saved measurement metadata', () => {
  it('records resolved Lighthouse defaults and only active network fields', () => {
    expect(lighthouseThrottling(DEFAULT_LH_CONFIG)).toEqual({ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 4, network: { rttMs: 150, throughputKbps: 1638.4 } });
  });

  it('records provided Lighthouse measurements without inventing emulation settings', () => {
    expect(lighthouseThrottling({ ...DEFAULT_LH_CONFIG, throttlingMethod: 'provided' })).toEqual({ engine: 'Lighthouse', method: 'provided', network: {} });
  });

  it('preserves command argument values, including URL credentials, query values and fragments', () => {
    expect(measurementCommand(['compare', '--filter', 'Homepage flow', '--token=demo-value', '--url', 'HTTPS://demo:demo-password@example.test/cart?mode=demo#anchor']))
      .toBe("shaka-perf compare --filter 'Homepage flow' --token=demo-value --url 'HTTPS://demo:demo-password@example.test/cart?mode=demo#anchor'");
  });

  it('keeps calibrated CPU and network overrides returned by Lighthouse', () => {
    expect(lighthouseThrottling({ throttlingMethod: 'simulate', throttling: { cpuSlowdownMultiplier: 7, rttMs: 42, throughputKbps: 800 } }))
      .toEqual({ engine: 'Lighthouse', method: 'simulate', cpuSlowdownMultiplier: 7, network: { rttMs: 42, throughputKbps: 800 } });
  });

  it('never substitutes CPU or method defaults when Lighthouse did not return them', () => {
    expect(lighthouseThrottling({})).toBeUndefined();
    expect(lighthouseThrottling({ throttlingMethod: 'devtools', throttling: { requestLatencyMs: 123 } }))
      .toEqual({ engine: 'Lighthouse', method: 'devtools', network: { requestLatencyMs: 123 } });
  });
});
