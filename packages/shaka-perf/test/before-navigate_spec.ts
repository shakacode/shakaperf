import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('beforeNavigate hooks', function () {
  const envKey = 'SHAKA_PERF_ABTESTS_CONFIG_PATH';

  function writeConfig(tmpDirPrefix: string, marker: string) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), tmpDirPrefix));
    const configPath = path.join(tmpDir, 'abtests.config.js');
    fs.writeFileSync(
      configPath,
      [
        'module.exports = {',
        '  shared: {',
        '    beforeNavigate: async ({ page }) => {',
        `      page.loadedFromConfig = ${JSON.stringify(marker)};`,
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

  it('loads the global hook from the explicit CLI config path', async function () {
    const configPath = writeConfig('shaka-perf-config-', 'explicit');
    process.env[envKey] = configPath;
    jest.resetModules();

    const { runBeforeNavigateHooks } = await import('../src/before-navigate');
    const page = {};

    await runBeforeNavigateHooks(
      {
        context: {},
        page,
        url: 'http://localhost:3012/',
        viewport: { label: 'desktop' },
        isControl: false,
        testType: 'visreg',
      } as any,
      undefined,
    );

    assert.equal((page as { loadedFromConfig?: string }).loadedFromConfig, 'explicit');
  });

  it('reloads the global hook when the explicit config path changes', async function () {
    const firstConfigPath = writeConfig('shaka-perf-config-first-', 'first');
    const secondConfigPath = writeConfig('shaka-perf-config-second-', 'second');
    process.env[envKey] = firstConfigPath;
    jest.resetModules();

    const { runBeforeNavigateHooks } = await import('../src/before-navigate');
    const firstPage = {};
    const secondPage = {};

    await runBeforeNavigateHooks(
      {
        context: {},
        page: firstPage,
        url: 'http://localhost:3012/',
        viewport: { label: 'desktop' },
        isControl: false,
        testType: 'visreg',
      } as any,
      undefined,
    );

    process.env[envKey] = secondConfigPath;

    await runBeforeNavigateHooks(
      {
        context: {},
        page: secondPage,
        url: 'http://localhost:3012/',
        viewport: { label: 'desktop' },
        isControl: false,
        testType: 'visreg',
      } as any,
      undefined,
    );

    assert.equal((firstPage as { loadedFromConfig?: string }).loadedFromConfig, 'first');
    assert.equal((secondPage as { loadedFromConfig?: string }).loadedFromConfig, 'second');
  });

  it('restores the explicit config path after a scoped config run', async function () {
    const configPath = writeConfig('shaka-perf-config-scoped-', 'scoped');
    process.env[envKey] = '/tmp/original-abtests.config.js';
    jest.resetModules();

    const { withAbTestsConfigPath } = await import('../src/before-navigate');

    await withAbTestsConfigPath(configPath, async () => {
      assert.equal(process.env[envKey], path.resolve(configPath));
    });

    assert.equal(process.env[envKey], '/tmp/original-abtests.config.js');
  });

  it('preserves an existing config path when no scoped path is provided', async function () {
    process.env[envKey] = '/tmp/original-abtests.config.js';
    jest.resetModules();

    const { withAbTestsConfigPath } = await import('../src/before-navigate');

    await withAbTestsConfigPath(undefined, async () => {
      assert.equal(process.env[envKey], '/tmp/original-abtests.config.js');
    });

    assert.equal(process.env[envKey], '/tmp/original-abtests.config.js');
  });
});
