/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('reconstructEffectiveConfig', function () {
  const envKey = 'SHAKA_PERF_ABTESTS_CONFIG_PATH';

  function writeConfig(tmpDirPrefix: string, marker: string) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), tmpDirPrefix));
    const configPath = path.join(tmpDir, 'abtests.config.js');
    fs.writeFileSync(
      configPath,
      [
        'module.exports = {',
        '  shared: {',
        "    controlURL: 'http://localhost:3011/',",
        "    experimentURL: 'http://localhost:3012/',",
        '    parallelism: 1,',
        "    playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 },",
        '    beforeNavigate: async ({ context }) => {',
        `      context.loadedFromConfig = ${JSON.stringify(marker)};`,
        '    },',
        '  },',
        '};',
        '',
      ].join('\n'),
    );
    return configPath;
  }

  afterEach(function () {
    delete process.env[envKey];
    jest.resetModules();
  });

  it('resolves the hook from the explicit CLI config path', async function () {
    const configPath = writeConfig('shaka-perf-config-', 'explicit');
    process.env[envKey] = configPath;
    jest.resetModules();

    const { reconstructEffectiveConfig } = await import('../src/effective-config');
    const context = {};

    const hook = (await reconstructEffectiveConfig(undefined))?.shared.beforeNavigate;
    await hook?.({
      context,
      url: 'http://localhost:3012/',
      viewport: { label: 'desktop' },
      isControl: false,
      testType: 'visreg',
    } as any);

    assert.equal((context as { loadedFromConfig?: string }).loadedFromConfig, 'explicit');
  });

  it('re-resolves the hook when the explicit config path changes', async function () {
    const firstConfigPath = writeConfig('shaka-perf-config-first-', 'first');
    const secondConfigPath = writeConfig('shaka-perf-config-second-', 'second');
    process.env[envKey] = firstConfigPath;
    jest.resetModules();

    const { reconstructEffectiveConfig } = await import('../src/effective-config');
    const firstContext = {};
    const secondContext = {};

    const firstHook = (await reconstructEffectiveConfig(undefined))?.shared.beforeNavigate;
    await firstHook?.({
      context: firstContext,
      url: 'http://localhost:3012/',
      viewport: { label: 'desktop' },
      isControl: false,
      testType: 'visreg',
    } as any);

    process.env[envKey] = secondConfigPath;

    const secondHook = (await reconstructEffectiveConfig(undefined))?.shared.beforeNavigate;
    await secondHook?.({
      context: secondContext,
      url: 'http://localhost:3012/',
      viewport: { label: 'desktop' },
      isControl: false,
      testType: 'visreg',
    } as any);

    assert.equal((firstContext as { loadedFromConfig?: string }).loadedFromConfig, 'first');
    assert.equal((secondContext as { loadedFromConfig?: string }).loadedFromConfig, 'second');
  });

  it('lets a per-test config.shared.beforeNavigate override the file hook', async function () {
    const configPath = writeConfig('shaka-perf-config-override-', 'file');
    process.env[envKey] = configPath;
    jest.resetModules();

    const { reconstructEffectiveConfig } = await import('../src/effective-config');
    const context = {};

    const testDef = {
      config: {
        shared: {
          beforeNavigate: async ({ context: c }: { context: Record<string, unknown> }) => {
            c.loadedFromConfig = 'per-test';
          },
        },
      },
    };

    const hook = (await reconstructEffectiveConfig(testDef as any))?.shared.beforeNavigate;
    await hook?.({
      context,
      url: 'http://localhost:3012/',
      viewport: { label: 'desktop' },
      isControl: false,
      testType: 'visreg',
    } as any);

    assert.equal((context as { loadedFromConfig?: string }).loadedFromConfig, 'per-test');
  });

  it('throws when no config file resolves — abtests.config.ts is mandatory', async function () {
    // No env path; run from a dir with no abtests.config.* anywhere above it.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-noconfig-'));
    const savedCwd = process.cwd();
    process.chdir(emptyDir);
    jest.resetModules();
    try {
      const { reconstructEffectiveConfig } = await import('../src/effective-config');
      await assert.rejects(
        () => reconstructEffectiveConfig(undefined),
        /no abtests\.config\.ts found/,
      );
    } finally {
      process.chdir(savedCwd);
    }
  });

  it('throws (not warns) when the config file fails to parse', async function () {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-badconfig-'));
    const configPath = path.join(tmpDir, 'abtests.config.js');
    // Stale key → the strict schema rejects it; a unit that rebuilds the
    // effective config must FAIL, not degrade to no-config.
    fs.writeFileSync(
      configPath,
      "module.exports = { shared: { controlURL: 'http://localhost:1/', experimentURL: 'http://localhost:2/', parallelism: 1, playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 } }, visreg: { defaultMisMatchThreshold: 0.1 } };\n",
    );
    process.env[envKey] = configPath;
    jest.resetModules();

    const { reconstructEffectiveConfig } = await import('../src/effective-config');
    await assert.rejects(
      () => reconstructEffectiveConfig(undefined),
      /Unrecognized key.*defaultMisMatchThreshold/,
    );
  });

  it('restores the explicit config path after a scoped config run', async function () {
    const configPath = writeConfig('shaka-perf-config-scoped-', 'scoped');
    process.env[envKey] = '/tmp/original-abtests.config.js';
    jest.resetModules();

    const { withAbTestsConfigPath } = await import('../src/effective-config');

    await withAbTestsConfigPath(configPath, async () => {
      assert.equal(process.env[envKey], path.resolve(configPath));
    });

    assert.equal(process.env[envKey], '/tmp/original-abtests.config.js');
  });

  it('preserves an existing config path when no scoped path is provided', async function () {
    process.env[envKey] = '/tmp/original-abtests.config.js';
    jest.resetModules();

    const { withAbTestsConfigPath } = await import('../src/effective-config');

    await withAbTestsConfigPath(undefined, async () => {
      assert.equal(process.env[envKey], '/tmp/original-abtests.config.js');
    });

    assert.equal(process.env[envKey], '/tmp/original-abtests.config.js');
  });
});

// `.abtest.ts` files load through tsx (transpile-only), so TypeScript never
// sees a per-test `config` for anyone who doesn't typecheck ab-tests/. These
// cover what only runtime validation can catch: a key that merges cleanly,
// is then ignored, and leaves the test silently running at the file default.
describe('applyPerTestConfigOverrides validation', function () {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildAbTestsConfig, viewportsForCategory } = require('../src/config');
  const { applyPerTestConfigOverrides } = require('../src/effective-config');

  const fileConfig = () =>
    buildAbTestsConfig({
      shared: {
        controlURL: 'http://localhost:3011/',
        experimentURL: 'http://localhost:3012/',
        parallelism: 1,
        playwrightOptions: { browser: 'chromium' },
      },
      visreg: { mismatchThreshold: 0.1, viewports: ['desktop', 'phone'] },
    });

  const testDef = (name: string, config: unknown) => ({ name, config }) as never;

  it('rejects a renamed per-test key instead of ignoring it', function () {
    // `misMatchThreshold` is the old per-test spelling — one capital letter
    // from the new name, so the likeliest half-migration.
    assert.throws(
      () => applyPerTestConfigOverrides(fileConfig(), testDef('Homepage', {
        visreg: { misMatchThreshold: 0.01 },
      })),
      /abTest\("Homepage"\).*Unrecognized key.*misMatchThreshold/s,
    );
  });

  it('rejects an unknown per-test key, naming the test that declared it', function () {
    assert.throws(
      () => applyPerTestConfigOverrides(fileConfig(), testDef('Cart', {
        visreg: { delay: 50 },
      })),
      /abTest\("Cart"\).*Unrecognized key.*delay/s,
    );
  });

  it('rejects a per-test label that no shared.viewportDefinitions entry defines', function () {
    // Previously dropped silently, then thrown from resolveViewports mid-run.
    assert.throws(
      () => applyPerTestConfigOverrides(fileConfig(), testDef('Home', {
        visreg: { viewports: ['phome'] },
      })),
      /abTest\("Home"\).*unknown viewport label "phome"/s,
    );
  });

  it('rejects a viewportDefinitions override that leaves a category label unresolvable', function () {
    const TABLET = {
      label: 'tablet', width: 768, height: 1024,
      formFactor: 'mobile', deviceScaleFactor: 2,
    };
    assert.throws(
      () => applyPerTestConfigOverrides(fileConfig(), testDef('Dash', {
        shared: { viewportDefinitions: [TABLET] },
      })),
      /abTest\("Dash"\).*unknown viewport label "desktop"/s,
    );
  });

  // The precedence the `shared.viewports` default exists for: a test narrows
  // every category at once, EXCEPT ones the file config pinned itself — an
  // explicit file-level category list is the more specific of the two.
  const labelsFor = (effective: unknown, category: string): string[] =>
    viewportsForCategory(effective, category).map((v: { label: string }) => v.label);

  it('lets a per-test shared.viewports narrow the categories the file left unset', function () {
    const effective = applyPerTestConfigOverrides(fileConfig(), testDef('Home', {
      shared: { viewports: ['phone'] },
    }));

    assert.deepEqual(labelsFor(effective, 'audit'), ['phone']);
    assert.deepEqual(labelsFor(effective, 'perf'), ['phone']);
    // fileConfig() pins visreg to desktop + phone, so it wins.
    assert.deepEqual(labelsFor(effective, 'visreg'), ['desktop', 'phone']);
  });

  it("lets a per-test category viewports outrank the test's own shared.viewports", function () {
    const effective = applyPerTestConfigOverrides(fileConfig(), testDef('Home', {
      shared: { viewports: ['phone'] },
      audit: { viewports: ['desktop'] },
    }));

    assert.deepEqual(labelsFor(effective, 'audit'), ['desktop']);
    assert.deepEqual(labelsFor(effective, 'perf'), ['phone']);
  });

  it('accepts a valid override, keeping sibling keys and the hook function', function () {
    const hook = async () => {};
    const effective = applyPerTestConfigOverrides(fileConfig(), testDef('Home', {
      visreg: { mismatchThreshold: 0.01 },
      shared: { beforeNavigate: hook },
    }));

    assert.equal(effective.visreg.mismatchThreshold, 0.01);
    // Siblings fall through from the file rather than being re-defaulted away.
    assert.equal(effective.visreg.compareRetries, 2);
    assert.deepEqual(effective.visreg.viewports, ['desktop', 'phone']);
    // Validation runs in-process on live objects — the hook is not serialised.
    assert.equal(effective.shared.beforeNavigate, hook);
  });

  it('does not repeat the file config\'s deprecation warning per test', function () {
    // The re-validation pass runs buildAbTestsConfig once per test. Anything
    // that warns about a FILE-level setting must stay keyed to the file build,
    // or one deprecated value prints once per test.
    const deprecated = buildAbTestsConfig({
      shared: {
        controlURL: 'http://localhost:3011/',
        experimentURL: 'http://localhost:3012/',
        parallelism: 1,
        playwrightOptions: { browser: 'chromium' },
      },
      perf: { samplingMode: 'sequential' },
    });

    const original = console.warn;
    let warnings = 0;
    console.warn = (...args: unknown[]) => {
      if (String(args[0]).includes('samplingMode')) warnings += 1;
    };
    try {
      for (let i = 0; i < 3; i++) {
        applyPerTestConfigOverrides(deprecated, testDef(`T${i}`, {
          visreg: { mismatchThreshold: 0.01 },
        }));
      }
    } finally {
      console.warn = original;
    }

    assert.equal(warnings, 0);
  });

  it('does not mutate the file config it merges onto', function () {
    const file = fileConfig();
    applyPerTestConfigOverrides(file, testDef('Home', {
      visreg: { mismatchThreshold: 0.01, viewports: ['desktop'] },
    }));

    assert.equal(file.visreg.mismatchThreshold, 0.1);
    assert.deepEqual(file.visreg.viewports, ['desktop', 'phone']);
  });
});
