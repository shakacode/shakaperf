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
  resolvePlaywrightOptions,
  resolveViewports,
  viewportsByStageCategory,
} from '../config';

function baseConfig(extra: Record<string, unknown> = {}) {
  return {
    shared: {
      controlURL: 'http://localhost:3020',
      experimentURL: 'http://localhost:3030',
      parallelism: 2,
      playwrightOptions: { browser: 'chromium', args: ['--no-sandbox'], waitTimeout: 60_000 },
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
    // Launch options live on shared.playwrightOptions now — accessibility
    // resolves to them with no category override.
    expect(resolvePlaywrightOptions(config, 'accessibility')).toMatchObject({
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

  // Removed key: zod would strip it silently, and a user who relied on
  // `requireSameDimensions: false` would see previously-tolerated resizes fail
  // with an undiscoverable cause. Fail loudly instead, like its siblings.
  it('fails loudly on the removed requireSameDimensions key', () => {
    expect(() => parseAbTestsConfig(baseConfig({
      visreg: { requireSameDimensions: false },
    }))).toThrow(/requireSameDimensions was removed/);
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

describe('playwrightOptions', () => {
  it('is required on shared — no hidden launch defaults', () => {
    expect(() => parseAbTestsConfig({
      shared: {
        controlURL: 'http://localhost:3020',
        experimentURL: 'http://localhost:3030',
        parallelism: 2,
      },
    })).toThrow(/shared\.playwrightOptions/);
  });

  it('requires an explicit browser', () => {
    expect(() => parseAbTestsConfig(baseConfig({
      shared: {
        controlURL: 'http://localhost:3020',
        experimentURL: 'http://localhost:3030',
        parallelism: 2,
        playwrightOptions: { args: ['--no-sandbox'], waitTimeout: 60_000 },
      },
    }))).toThrow(/browser/);
  });

  it('defaults waitTimeout to 60s — the one wait cap every Playwright engine respects', () => {
    const config = parseAbTestsConfig(baseConfig({
      shared: {
        controlURL: 'http://localhost:3020',
        experimentURL: 'http://localhost:3030',
        parallelism: 2,
        playwrightOptions: { browser: 'chromium' },
      },
    }));
    expect(config.shared.playwrightOptions.waitTimeout).toBe(60_000);
  });

  it('resolves shared for every category exactly as written', () => {
    const config = parseAbTestsConfig(baseConfig());

    for (const category of ['visreg', 'perf', 'audit', 'accessibility'] as const) {
      expect(resolvePlaywrightOptions(config, category)).toEqual({
        browser: 'chromium',
        args: ['--no-sandbox'],
        waitTimeout: 60_000,
      });
    }
  });

  it('overrides per-key for visreg and perf, leaving the rest of shared intact', () => {
    const config = parseAbTestsConfig(baseConfig({
      shared: {
        controlURL: 'http://localhost:3020',
        experimentURL: 'http://localhost:3030',
        parallelism: 1,
        playwrightOptions: { browser: 'chromium', args: ['--no-sandbox'], headless: true, waitTimeout: 60_000 },
      },
      visreg: { playwrightOptions: { headless: false } },
      perf: { playwrightOptions: { args: ['--disable-gpu'] } },
    }));

    expect(resolvePlaywrightOptions(config, 'visreg')).toEqual({
      browser: 'chromium',
      args: ['--no-sandbox'],
      headless: false,
      waitTimeout: 60_000,
    });
    expect(resolvePlaywrightOptions(config, 'perf')).toEqual({
      browser: 'chromium',
      args: ['--disable-gpu'],
      headless: true,
      waitTimeout: 60_000,
    });
    // audit / accessibility have no category override — pure shared.
    expect(resolvePlaywrightOptions(config, 'audit')).toEqual({
      browser: 'chromium',
      args: ['--no-sandbox'],
      headless: true,
      waitTimeout: 60_000,
    });
  });

  it('fails loudly on the legacy engineOptions key in any section', () => {
    for (const section of ['shared', 'visreg', 'perf', 'accessibility', 'audit']) {
      expect(() => parseAbTestsConfig(baseConfig({
        [section]: { engineOptions: { browser: 'chromium' } },
      }))).toThrow(`${section}.engineOptions was renamed`);
    }
  });

  it('fails loudly on playwrightOptions in sections with no category override', () => {
    for (const section of ['accessibility', 'audit']) {
      expect(() => parseAbTestsConfig(baseConfig({
        [section]: { playwrightOptions: { headless: false } },
      }))).toThrow(`${section}.playwrightOptions is not supported`);
    }
  });
});
