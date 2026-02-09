import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { defineConfig, findConfigFile, resolveConfig } from '../config';
import type { TwinServersConfig } from '../types';

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const config = {
      projectDir: '/project',
      controlDir: '/control',
      dockerBuildDir: '/build',
      dockerBuildArgs: {},
      composeFile: 'docker-compose.yml',
      procfile: 'Procfile',
      images: { control: 'img:ctrl', experiment: 'img:exp' },
      volumes: { control: '/vol/ctrl', experiment: '/vol/exp' },
    } satisfies TwinServersConfig;
    expect(defineConfig(config)).toBe(config);
  });
});

describe('findConfigFile', () => {
  const tmpDir = path.join(__dirname, 'tmp-find-config');

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns null when no config file found', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    expect(findConfigFile(tmpDir)).toBeNull();
  });

  it('finds twin-servers.config.ts', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'twin-servers.config.ts'), 'export default {}');
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, 'twin-servers.config.ts'));
  });

  it('finds twin-servers.config.js', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'twin-servers.config.js'), 'module.exports = {}');
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, 'twin-servers.config.js'));
  });

  it('prefers .ts over .js', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'twin-servers.config.ts'), 'export default {}');
    fs.writeFileSync(path.join(tmpDir, 'twin-servers.config.js'), 'module.exports = {}');
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, 'twin-servers.config.ts'));
  });
});

describe('resolveConfig', () => {
  const tmpDir = path.join(__dirname, 'tmp-resolve-config');
  const projectDir = path.join(tmpDir, 'project');
  const controlDir = path.join(tmpDir, 'control');
  const dockerBuildDir = path.join(tmpDir, 'build');

  beforeEach(() => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(controlDir, { recursive: true });
    fs.mkdirSync(dockerBuildDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function makeConfig(overrides: Partial<TwinServersConfig> = {}): TwinServersConfig {
    return {
      projectDir,
      controlDir,
      dockerBuildDir,
      dockerBuildArgs: { KEY: 'val' },
      composeFile: 'docker-compose.yml',
      procfile: 'Procfile.twin',
      images: { control: 'img:ctrl', experiment: 'img:exp' },
      volumes: { control: '/tmp/ctrl_vol', experiment: '/tmp/exp_vol' },
      ...overrides,
    };
  }

  it('resolves a valid config', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.projectDir).toBe(projectDir);
    expect(resolved.controlDir).toBe(controlDir);
    expect(resolved.dockerBuildDir).toBe(dockerBuildDir);
    expect(resolved.images.control).toBe('img:ctrl');
    expect(resolved.images.experiment).toBe('img:exp');
  });

  it('resolves composeFile relative to projectDir', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.composeFile).toBe(path.resolve(projectDir, 'docker-compose.yml'));
  });

  it('resolves procfile relative to projectDir', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.procfile).toBe(path.resolve(projectDir, 'Procfile.twin'));
  });

  it('defaults setupCommands to empty array', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.setupCommands).toEqual([]);
  });

  it('passes through setupCommands when provided', () => {
    const config = makeConfig({
      setupCommands: [{ command: 'rake db:migrate', description: 'Migrate' }],
    });
    const resolved = resolveConfig(config, tmpDir);
    expect(resolved.setupCommands).toHaveLength(1);
    expect(resolved.setupCommands[0].command).toBe('rake db:migrate');
  });

  it('throws on Zod validation failure', () => {
    expect(() => resolveConfig({}, tmpDir)).toThrow();
  });

  it('throws on empty projectDir', () => {
    expect(() => resolveConfig(makeConfig({ projectDir: '' }), tmpDir)).toThrow('projectDir');
  });

  it('throws when projectDir does not exist', () => {
    expect(() => resolveConfig(makeConfig({ projectDir: '/nonexistent/path' }), tmpDir))
      .toThrow('Project directory not found');
  });

  it('throws when dockerBuildDir does not exist', () => {
    expect(() => resolveConfig(makeConfig({ dockerBuildDir: '/nonexistent/build' }), tmpDir))
      .toThrow('Docker build root not found');
  });

  it('expands tilde in paths', () => {
    // Use a config with tilde paths and actual existing dirs
    const homeDir = os.homedir();
    const config = makeConfig({
      projectDir: projectDir, // keep absolute so it exists
      controlDir: controlDir,
      dockerBuildDir: dockerBuildDir,
      volumes: { control: '~/ctrl_vol', experiment: '~/exp_vol' },
    });
    const resolved = resolveConfig(config, tmpDir);
    expect(resolved.volumes.control).toBe(path.join(homeDir, 'ctrl_vol'));
    expect(resolved.volumes.experiment).toBe(path.join(homeDir, 'exp_vol'));
  });

  it('resolves relative paths from cwd', () => {
    // Make paths relative to tmpDir
    const config = makeConfig({
      projectDir: 'project',
      controlDir: 'control',
      dockerBuildDir: 'build',
    });
    const resolved = resolveConfig(config, tmpDir);
    expect(resolved.projectDir).toBe(path.resolve(tmpDir, 'project'));
    expect(resolved.controlDir).toBe(path.resolve(tmpDir, 'control'));
    expect(resolved.dockerBuildDir).toBe(path.resolve(tmpDir, 'build'));
  });
});
