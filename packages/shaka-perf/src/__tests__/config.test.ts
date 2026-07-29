/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  DEFAULT_ACCESSIBILITY_TAGS,
  buildAbTestsConfig,
  resolvePlaywrightOptions,
  resolveViewports,
  viewportsByStageCategory,
  viewportsForCategory,
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
    const config = buildAbTestsConfig(baseConfig());

    // Unset by design — the category falls back to `shared.viewports`.
    expect(config.accessibility.viewports).toBeUndefined();
    expect(viewportsForCategory(config, 'accessibility').map((v) => v.label))
      .toEqual(['desktop', 'phone']);
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
    const config = buildAbTestsConfig(baseConfig({
      accessibility: { viewports: ['phone'] },
    }));

    expect(viewportsByStageCategory(config).accessibility.map((v) => v.label)).toEqual(['phone']);
  });

  it('validates accessibility viewport labels against shared viewportDefinitions', () => {
    expect(() => buildAbTestsConfig(baseConfig({
      accessibility: { viewports: ['watch'] },
    }))).toThrow('accessibility.viewports: unknown viewport label "watch"');
  });
});

describe('resolveViewports', () => {
  it('resolves labels to their shared.viewportDefinitions in list order', () => {
    const config = buildAbTestsConfig(baseConfig());

    const resolved = resolveViewports(['phone', 'desktop'], config.shared.viewportDefinitions);
    expect(resolved.map((v) => v.label)).toEqual(['phone', 'desktop']);
    expect(resolved[0].width).toBeGreaterThan(0);
  });

  it('throws on a label with no shared.viewportDefinitions entry (per-test typo)', () => {
    const config = buildAbTestsConfig(baseConfig());

    expect(() => resolveViewports(['phome'], config.shared.viewportDefinitions)).toThrow(
      "Unknown viewport label 'phome' — defined in shared.viewportDefinitions: 'desktop', 'tablet', 'phone'.",
    );
  });
});

describe('shared.viewports as the per-category default', () => {
  it('defaults to desktop + phone for every category', () => {
    const byCategory = viewportsByStageCategory(buildAbTestsConfig(baseConfig()));

    for (const category of ['visreg', 'perf', 'audit', 'accessibility'] as const) {
      expect(byCategory[category].map((v) => v.label)).toEqual(['desktop', 'phone']);
    }
  });

  it('feeds every category that did not set its own viewports', () => {
    const byCategory = viewportsByStageCategory(buildAbTestsConfig(baseConfig({
      shared: {
        ...baseConfig().shared,
        viewports: ['tablet'],
      },
      perf: { viewports: ['desktop'] },
    })));

    expect(byCategory.perf.map((v) => v.label)).toEqual(['desktop']);
    for (const category of ['visreg', 'audit', 'accessibility'] as const) {
      expect(byCategory[category].map((v) => v.label)).toEqual(['tablet']);
    }
  });

  // The registry stays wider than the run list on purpose: defining a viewport
  // must not run it, or `shared.viewports` would have nothing to narrow.
  it('does not run every defined viewport', () => {
    const config = buildAbTestsConfig(baseConfig());

    expect(config.shared.viewportDefinitions.map((v) => v.label))
      .toEqual(['desktop', 'tablet', 'phone']);
    expect(config.shared.viewports).toEqual(['desktop', 'phone']);
  });

  it('rejects a shared.viewports label that no definition covers', () => {
    expect(() => buildAbTestsConfig(baseConfig({
      shared: { ...baseConfig().shared, viewports: ['watch'] },
    }))).toThrow('shared.viewports: unknown viewport label "watch"');
  });
});

describe('perf config', () => {
  it('defaults to the documented practical timing regression threshold', () => {
    const config = buildAbTestsConfig(baseConfig());

    expect(config.perf.regressionThreshold).toBe(50);
  });
});

describe('visreg config', () => {
  it('parses mismatchThreshold with its 0.1 default', () => {
    expect(buildAbTestsConfig(baseConfig()).visreg.mismatchThreshold).toBe(0.1);
    expect(buildAbTestsConfig(baseConfig({
      visreg: { mismatchThreshold: 0.01 },
    })).visreg.mismatchThreshold).toBe(0.01);
  });

  // The schema is `.strict()`, so a renamed key is rejected by name instead of
  // being stripped into a silent fall back to the 0.1 default.
  it('rejects the renamed defaultMisMatchThreshold key loudly', () => {
    expect(() => buildAbTestsConfig(baseConfig({
      visreg: { defaultMisMatchThreshold: 0.01 },
    }))).toThrow(/Unrecognized key.*defaultMisMatchThreshold/);
  });

  // Removed key: without strictness a user who relied on
  // `requireSameDimensions: false` would see previously-tolerated resizes fail
  // with an undiscoverable cause.
  it('fails loudly on the removed requireSameDimensions key', () => {
    expect(() => buildAbTestsConfig(baseConfig({
      visreg: { requireSameDimensions: false },
    }))).toThrow(/Unrecognized key.*requireSameDimensions/);
  });
});

describe('bisect config', () => {
  it('defaults container rebuilding', () => {
    expect(buildAbTestsConfig(baseConfig()).bisect).toEqual({
      rebuildContainer: false,
    });
  });

  it('preserves explicit container rebuilding', () => {
    expect(buildAbTestsConfig(baseConfig({
      bisect: {
        rebuildContainer: true,
      },
    })).bisect).toEqual({
      rebuildContainer: true,
    });
  });

});

describe('agentReadiness config', () => {
  it('defaults agent-readiness to disabled', () => {
    expect(buildAbTestsConfig(baseConfig()).agentReadiness).toEqual({ enabled: false });
  });

  it('preserves an explicit enable', () => {
    expect(buildAbTestsConfig(baseConfig({
      agentReadiness: { enabled: true },
    })).agentReadiness).toEqual({ enabled: true });
  });
});

describe('playwrightOptions', () => {
  it('is required on shared — no hidden launch defaults', () => {
    expect(() => buildAbTestsConfig({
      shared: {
        controlURL: 'http://localhost:3020',
        experimentURL: 'http://localhost:3030',
        parallelism: 2,
      },
    })).toThrow(/shared\.playwrightOptions/);
  });

  it('requires an explicit browser', () => {
    expect(() => buildAbTestsConfig(baseConfig({
      shared: {
        controlURL: 'http://localhost:3020',
        experimentURL: 'http://localhost:3030',
        parallelism: 2,
        playwrightOptions: { args: ['--no-sandbox'], waitTimeout: 60_000 },
      },
    }))).toThrow(/browser/);
  });

  it('defaults waitTimeout to 60s — the one wait cap every Playwright engine respects', () => {
    const config = buildAbTestsConfig(baseConfig({
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
    const config = buildAbTestsConfig(baseConfig());

    for (const category of ['visreg', 'perf', 'audit', 'accessibility'] as const) {
      expect(resolvePlaywrightOptions(config, category)).toEqual({
        browser: 'chromium',
        args: ['--no-sandbox'],
        waitTimeout: 60_000,
      });
    }
  });

  it('overrides per-key for visreg and perf, leaving the rest of shared intact', () => {
    const config = buildAbTestsConfig(baseConfig({
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
      const base = baseConfig() as Record<string, unknown>;
      // Merge into the section rather than replacing it, so `shared` keeps its
      // required fields and the stale key is the only thing wrong.
      expect(() => buildAbTestsConfig({
        ...base,
        [section]: { ...(base[section] as object), engineOptions: { browser: 'chromium' } },
      })).toThrow(new RegExp(`${section}: Unrecognized key.*engineOptions`));
    }
  });

  // Only visreg/perf have a category override; on accessibility/audit the key
  // is the natural wrong guess after the engineOptions rename, and would
  // otherwise be stripped and silently ignored.
  it('fails loudly on playwrightOptions in sections with no category override', () => {
    for (const section of ['accessibility', 'audit']) {
      expect(() => buildAbTestsConfig(baseConfig({
        [section]: { playwrightOptions: { headless: false } },
      }))).toThrow(new RegExp(`${section}: Unrecognized key.*playwrightOptions`));
    }
  });
});
