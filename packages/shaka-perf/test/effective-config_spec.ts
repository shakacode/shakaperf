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
        "    playwrightOptions: { browser: 'chromium' },",
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
