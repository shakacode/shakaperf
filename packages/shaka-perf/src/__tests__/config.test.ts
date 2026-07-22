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
  resolveViewports,
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

    expect(config.accessibility.viewports).toEqual(['desktop', 'phone']);
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

describe('resolveViewports', () => {
  it('resolves labels to their shared.viewports definitions in list order', () => {
    const config = parseAbTestsConfig(baseConfig());

    const resolved = resolveViewports(['phone', 'desktop'], config.shared.viewports);
    expect(resolved.map((v) => v.label)).toEqual(['phone', 'desktop']);
    expect(resolved[0].width).toBeGreaterThan(0);
  });

  it('throws on a label with no shared.viewports definition (per-test typo)', () => {
    const config = parseAbTestsConfig(baseConfig());

    expect(() => resolveViewports(['phome'], config.shared.viewports)).toThrow(
      "Unknown viewport label 'phome' — defined in shared.viewports: 'desktop', 'tablet', 'phone'.",
    );
  });
});

describe('perf config', () => {
  it('defaults to the documented practical timing regression threshold', () => {
    const config = parseAbTestsConfig(baseConfig());

    expect(config.perf.regressionThreshold).toBe(50);
  });
});

describe('visreg config', () => {
  it('parses mismatchThreshold with its 0.1 default', () => {
    expect(parseAbTestsConfig(baseConfig()).visreg.mismatchThreshold).toBe(0.1);
    expect(parseAbTestsConfig(baseConfig({
      visreg: { mismatchThreshold: 0.01 },
    })).visreg.mismatchThreshold).toBe(0.01);
  });

  it('rejects the renamed defaultMisMatchThreshold key loudly', () => {
    // Zod strips unknown keys, so without this check the old name would
    // silently fall back to the 0.1 default.
    expect(() => parseAbTestsConfig(baseConfig({
      visreg: { defaultMisMatchThreshold: 0.01 },
    }))).toThrow(/defaultMisMatchThreshold was renamed/);
  });
});

describe('bisect config', () => {
  it('defaults container rebuilding', () => {
    expect(parseAbTestsConfig(baseConfig()).bisect).toEqual({
      rebuildContainer: false,
    });
  });

  it('preserves explicit container rebuilding', () => {
    expect(parseAbTestsConfig(baseConfig({
      bisect: {
        rebuildContainer: true,
      },
    })).bisect).toEqual({
      rebuildContainer: true,
    });
  });

});
