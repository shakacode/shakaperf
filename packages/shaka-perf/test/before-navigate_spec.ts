import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('beforeNavigate hooks', function () {
  const envKey = 'SHAKA_PERF_ABTESTS_CONFIG_PATH';

  afterEach(function () {
    delete process.env[envKey];
    jest.resetModules();
  });

  it('loads the global hook from the explicit CLI config path', async function () {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-perf-config-'));
    const configPath = path.join(tmpDir, 'hichee.abtests.config.js');
    fs.writeFileSync(
      configPath,
      [
        'module.exports = {',
        '  shared: {',
        '    beforeNavigate: async ({ page }) => {',
        '      page.loadedFromExplicitConfig = true;',
        '    },',
        '  },',
        '};',
        '',
      ].join('\n'),
    );
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

    assert.equal((page as { loadedFromExplicitConfig?: boolean }).loadedFromExplicitConfig, true);
  });
});
