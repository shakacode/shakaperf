/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  DEFAULT_ACCESSIBILITY_TAGS,
  parseAbTestsConfig,
  viewportsByStageCategory,
} from '../config';

function baseConfig(extra: Record<string, unknown> = {}) {
  return {
    shared: {
      controlURL: 'http://localhost:3020',
      experimentURL: 'http://localhost:3030',
      parallelism: 2,
    },
    ...extra,
  };
}

describe('accessibility config', () => {
  it('defaults accessibility to desktop and phone axe checks', () => {
    const config = parseAbTestsConfig(baseConfig());

    expect(config.accessibility.viewports.map((v) => v.label)).toEqual(['desktop', 'phone']);
    expect(config.accessibility.tags).toEqual([...DEFAULT_ACCESSIBILITY_TAGS]);
    expect(config.accessibility.disableRules).toEqual([]);
    expect(config.accessibility.includeRules).toBeUndefined();
    expect(config.accessibility.failOnViolation).toBe(true);
    expect(config.accessibility.engineOptions).toMatchObject({
      browser: 'chromium',
      args: ['--no-sandbox'],
    });
  });

  it('maps accessibility viewports into the pipeline stage categories', () => {
    const config = parseAbTestsConfig(baseConfig({
      accessibility: { viewports: ['phone'] },
    }));

    expect(viewportsByStageCategory(config).accessibility.map((v) => v.label)).toEqual(['phone']);
  });

  it('validates accessibility viewport labels against shared viewports', () => {
    expect(() => parseAbTestsConfig(baseConfig({
      accessibility: { viewports: ['watch'] },
    }))).toThrow('accessibility.viewports: unknown viewport label "watch"');
  });
});

describe('perf config', () => {
  it('defaults to the documented practical timing regression threshold', () => {
    const config = parseAbTestsConfig(baseConfig());

    expect(config.perf.regressionThreshold).toBe(50);
  });
});

describe('bisect config', () => {
  it('defaults rebuild commands and container rebuilding', () => {
    expect(parseAbTestsConfig(baseConfig()).bisect).toEqual({
      rebuildCommands: [],
      rebuildContainer: false,
    });
  });

  it('preserves explicit rebuild settings', () => {
    expect(parseAbTestsConfig(baseConfig({
      bisect: {
        rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
        rebuildContainer: true,
      },
    })).bisect).toEqual({
      rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
      rebuildContainer: true,
    });
  });
});
