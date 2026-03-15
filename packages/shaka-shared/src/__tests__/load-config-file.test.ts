import * as fs from 'fs';
import * as path from 'path';
import { loadConfigFile } from '../load-config-file';

describe('loadConfigFile', () => {
  const tmpDir = path.join(__dirname, 'tmp-load-config');

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('throws when file does not exist', async () => {
    await expect(loadConfigFile(path.join(tmpDir, 'nonexistent.ts'))).rejects.toThrow(
      'Config file not found',
    );
  });

  it('throws for unsupported file extensions', async () => {
    const jsonPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(jsonPath, '{}');

    await expect(loadConfigFile(jsonPath)).rejects.toThrow('Unsupported config file extension');
  });

  it('throws for .yaml extension', async () => {
    const yamlPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(yamlPath, 'key: value');

    await expect(loadConfigFile(yamlPath)).rejects.toThrow('Unsupported config file extension');
  });

  it('loads a .js config file', async () => {
    const jsPath = path.join(tmpDir, 'config.js');
    fs.writeFileSync(jsPath, 'module.exports = { key: "value" };');

    const config = await loadConfigFile(jsPath);
    expect(config).toEqual({ key: 'value' });
  });

  // tsx ESM/CJS APIs require --experimental-vm-modules which is incompatible
  // with the default Jest VM environment. The .ts loading path is exercised
  // by the shaka-visreg integration tests (makeConfig_it_spec) instead.
  it.skip('loads a .ts config file via tsx', async () => {
    const tsPath = path.join(tmpDir, 'config.ts');
    fs.writeFileSync(
      tsPath,
      `const config = { greeting: "hello" };\nmodule.exports = config;\n`,
    );

    const config = await loadConfigFile(tsPath);
    expect(config).toHaveProperty('greeting', 'hello');
  });

  it('throws when config file exports a string', async () => {
    const jsPath = path.join(tmpDir, 'bad-config.js');
    fs.writeFileSync(jsPath, 'module.exports = "not-an-object";');

    await expect(loadConfigFile(jsPath)).rejects.toThrow(
      'Config file must export a configuration object',
    );
  });

  it('resolves relative paths', async () => {
    const jsPath = path.join(tmpDir, 'relative-test.js');
    fs.writeFileSync(jsPath, 'module.exports = { resolved: true };');

    // Use a path relative to cwd
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const config = await loadConfigFile('./relative-test.js');
      expect(config).toEqual({ resolved: true });
    } finally {
      process.chdir(originalCwd);
    }
  });
});
