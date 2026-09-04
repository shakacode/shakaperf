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
import { applyPerTestConfigOverrides } from '../effective-config';

function baseConfig(extra: Record<string, unknown> = {}) {
  const { shared, ...sections } = extra;
  return {
    shared: {
      controlURL: 'http://localhost:3020',
      experimentURL: 'http://localhost:3030',
      parallelism: 2,
      playwrightOptions: { browser: 'chromium', args: ['--no-sandbox'], waitTimeout: 60_000 },
      browserConsole: { failOn: ['error', 'warn'], allowList: [] },
      // Merged INTO the defaults so a caller can add one shared key without
      // restating the required ones.
      ...(shared as Record<string, unknown> | undefined),
    },
    ...sections,
  };
}

const withBrowserConsole = (browserConsole: unknown) =>
  baseConfig({ shared: { browserConsole } });

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

  const TABLET_ONLY = {
    label: 'tablet', width: 768, height: 1024,
    formFactor: 'mobile' as const, deviceScaleFactor: 2,
  };
  const everyCategoryPinnedToTablet = {
    shared: { ...baseConfig().shared, viewportDefinitions: [TABLET_ONLY] },
    visreg: { viewports: ['tablet'] },
    perf: { viewports: ['tablet'] },
    audit: { viewports: ['tablet'] },
    accessibility: { viewports: ['tablet'] },
  };

  it('leaves an unresolvable shared.viewports alone when no category reads it', () => {
    const config = buildAbTestsConfig(baseConfig(everyCategoryPinnedToTablet));

    expect(config.shared.viewports).toEqual(['desktop', 'phone']);
    for (const category of ['visreg', 'perf', 'audit', 'accessibility'] as const) {
      expect(viewportsForCategory(config, category).map((v) => v.label)).toEqual(['tablet']);
    }
  });

  it('rejects the same shared.viewports once a category falls back to it', () => {
    const { accessibility: _dropped, ...withAccessibilityUnset } = everyCategoryPinnedToTablet;

    expect(() => buildAbTestsConfig(baseConfig(withAccessibilityUnset)))
      .toThrow('shared.viewports: unknown viewport label "desktop"');
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

describe('codeCoverage config', () => {
  const plugin = { name: 'stamped', locate: (element: Element) => element.getAttribute('data-source') };

  it('defaults to no screenshot-coverage plugin', () => {
    expect(buildAbTestsConfig(baseConfig()).codeCoverage).toEqual({});
  });

  it("accepts the built-in 'react19' by name and a custom plugin by object", () => {
    expect(buildAbTestsConfig(baseConfig({ codeCoverage: { screenshotCoveragePlugin: 'react19' } }))
      .codeCoverage.screenshotCoveragePlugin).toBe('react19');
    expect(buildAbTestsConfig(baseConfig({ codeCoverage: { screenshotCoveragePlugin: plugin } }))
      .codeCoverage.screenshotCoveragePlugin).toBe(plugin);
  });

  it('rejects anything else, naming what it wanted', () => {
    expect(() => buildAbTestsConfig(baseConfig({ codeCoverage: { screenshotCoveragePlugin: 'react18' } })))
      .toThrow(/codeCoverage\.screenshotCoveragePlugin: expected 'react19' or a plugin object/);
    expect(() => buildAbTestsConfig(baseConfig({ codeCoverage: { screenshotCoveragePlugin: { name: 'x' } } })))
      .toThrow(/codeCoverage\.screenshotCoveragePlugin/);
  });
});

describe('shared.browserConsole config', () => {
  it('requires the section and both of its fields', () => {
    const base = baseConfig();
    const { browserConsole: _dropped, ...sharedWithout } = base.shared;
    expect(() => buildAbTestsConfig({ ...base, shared: sharedWithout }))
      .toThrow(/shared\.browserConsole: Required/);
    expect(() => buildAbTestsConfig(withBrowserConsole({ allowList: [] })))
      .toThrow(/shared\.browserConsole\.failOn: Required/);
    expect(() => buildAbTestsConfig(withBrowserConsole({ failOn: [] })))
      .toThrow(/shared\.browserConsole\.allowList: Required/);
  });

  it('parses what the config states', () => {
    expect(buildAbTestsConfig(withBrowserConsole({ failOn: ['error'], allowList: ['noise'] }))
      .shared.browserConsole).toEqual({ failOn: ['error'], allowList: ['noise'] });
  });

  it('rejects a level that is not a console method, and an unknown key', () => {
    expect(() => buildAbTestsConfig(withBrowserConsole({ failOn: ['warning'], allowList: [] })))
      .toThrow(/shared\.browserConsole\.failOn/);
    expect(() => buildAbTestsConfig(withBrowserConsole({
      failOn: [], allowList: [], allowlist: ['typo'],
    }))).toThrow(/shared\.browserConsole: Unrecognized key.*allowlist/);
  });

  it('lets a per-test override REPLACE the file allowList, not extend it', () => {
    const effective = applyPerTestConfigOverrides(
      buildAbTestsConfig(withBrowserConsole({ failOn: ['error', 'warn'], allowList: ['file'] })),
      {
        name: 'Cart',
        startingPath: '/cart',
        file: null,
        line: null,
        testTypes: null,
        testFn: async () => {},
        config: { shared: { browserConsole: { allowList: ['test'] } } },
      },
    );

    expect(effective.shared.browserConsole).toEqual({ failOn: ['error', 'warn'], allowList: ['test'] });
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
        playwrightOptions: { browser: 'chromium', args: ['--no-sandbox'], waitTimeout: 60_000 },
      },
      visreg: { playwrightOptions: { ignoreHTTPSErrors: false } },
      perf: { playwrightOptions: { args: ['--disable-gpu'] } },
    }));

    expect(resolvePlaywrightOptions(config, 'visreg')).toEqual({
      browser: 'chromium',
      args: ['--no-sandbox'],
      ignoreHTTPSErrors: false,
      waitTimeout: 60_000,
    });
    expect(resolvePlaywrightOptions(config, 'perf')).toEqual({
      browser: 'chromium',
      args: ['--disable-gpu'],
      waitTimeout: 60_000,
    });
    // audit / accessibility have no category override — pure shared.
    expect(resolvePlaywrightOptions(config, 'audit')).toEqual({
      browser: 'chromium',
      args: ['--no-sandbox'],
      waitTimeout: 60_000,
    });
  });

  // Visibility is the framework's, from `--headed`. A committed config used to
  // be able to beat the command line; now it can't set it at all.
  it('rejects headless in any section, naming the section', () => {
    for (const section of ['shared', 'visreg', 'perf'] as const) {
      const base = baseConfig() as Record<string, unknown>;
      base[section] = {
        ...(base[section] as object | undefined),
        playwrightOptions: { browser: 'chromium', headless: false },
      };
      expect(() => buildAbTestsConfig(base)).toThrow(
        new RegExp(`${section}\\.playwrightOptions\\.headless is not settable`),
      );
    }
  });

  // Visibility never reaches the resolved options at all — every launcher takes
  // `headed` as its own argument.
  it('never puts headless on the resolved options', () => {
    const config = buildAbTestsConfig(baseConfig());

    expect(resolvePlaywrightOptions(config, 'visreg')).not.toHaveProperty('headless');
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
