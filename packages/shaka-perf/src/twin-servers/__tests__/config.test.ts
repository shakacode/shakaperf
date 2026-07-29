/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { defineConfig, findConfigFile, loadConfig, projectPathSlug, resolveConfig } from '../config';
import type { TwinServersConfig } from '../types';

describe('projectPathSlug', () => {
  // Path separators become `--` so directory structure survives and a `/` path
  // can't collapse onto a `-` path; a literal `--` in the path is rejected.
  it('strips the home-dir prefix and turns separators into --', () => {
    const home = os.homedir();
    expect(projectPathSlug(path.join(home, 'foo', 'my-app')))
      .toBe('foo--my-app');
  });

  it('lowercases and replaces unsafe chars with dashes', () => {
    expect(projectPathSlug('/Some/Path With Space/App!'))
      .toBe('some--path-with-space--app');
  });

  it('trims leading/trailing dashes and dots', () => {
    expect(projectPathSlug('/./.weird./'))
      .toBe('weird');
  });

  it('produces distinct slugs for distinct paths', () => {
    expect(projectPathSlug('/Users/x/a/my-app'))
      .not.toBe(projectPathSlug('/Users/x/b/my-app'));
  });

  it('keeps a separator path distinct from a dash path', () => {
    // `foo/my-app` -> `foo--my-app`, `foo-my-app` -> `foo-my-app`: no collision.
    const home = os.homedir();
    expect(projectPathSlug(path.join(home, 'foo', 'my-app')))
      .not.toBe(projectPathSlug(path.join(home, 'foo-my-app')));
  });

  it('throws and suggests renaming when the path contains --', () => {
    const home = os.homedir();
    expect(() => projectPathSlug(path.join(home, 'foo--my-app')))
      .toThrow(/contains "--"/);
  });

  it('falls back to a non-empty slug for the home dir itself', () => {
    expect(projectPathSlug(os.homedir())).toBe('root');
  });
});

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const config = {
      experimentDir: '/project',
      controlDir: '/control',
      dockerBuildDir: '/build',
      dockerfile: 'Dockerfile',
      dockerBuildArgs: {},
      procfile: 'Procfile',
      ports: { control: 3020, experiment: 3030 },
    } satisfies TwinServersConfig;
    expect(defineConfig(config)).toBe(config);
  });
});

describe('findConfigFile', () => {
  const tmpDir = path.join(__dirname, 'tmp-find-config');

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

  it('returns null when no config file found', () => {
    expect(findConfigFile(tmpDir)).toBeNull();
  });

  it('finds abtests.config.ts', () => {
    fs.writeFileSync(path.join(tmpDir, 'abtests.config.ts'), 'export default {}');
    expect(findConfigFile(tmpDir)).toBe(path.join(tmpDir, 'abtests.config.ts'));
  });

  // The standalone twin-servers config was removed — `twinServers` is a section
  // of abtests.config.ts, so a leftover file must not be discovered.
  it('ignores a leftover twin-servers.config.ts', () => {
    fs.writeFileSync(path.join(tmpDir, 'twin-servers.config.ts'), 'export default {}');
    expect(findConfigFile(tmpDir)).toBeNull();
  });
});

describe('resolveConfig', () => {
  const tmpDir = path.join(__dirname, 'tmp-resolve-config');
  const experimentDir = path.join(tmpDir, 'project');
  const controlDir = path.join(tmpDir, 'control');
  const dockerBuildDir = path.join(tmpDir, 'build');

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(experimentDir, { recursive: true });
    fs.mkdirSync(controlDir, { recursive: true });
    fs.mkdirSync(dockerBuildDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function makeConfig(overrides: Partial<TwinServersConfig> = {}): TwinServersConfig {
    return {
      experimentDir,
      controlDir,
      dockerBuildDir,
      dockerfile: 'Dockerfile',
      dockerBuildArgs: { KEY: 'val' },
      procfile: 'Procfile.twin',
      ports: { control: 3020, experiment: 3030 },
      ...overrides,
    };
  }

  it('resolves a valid config', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.projectDir).toBe(tmpDir);
    expect(resolved.experimentDir).toBe(experimentDir);
    expect(resolved.controlDir).toBe(controlDir);
    expect(resolved.dockerBuildDir).toBe(dockerBuildDir);
    // images are derived from the local project-path slug so two twin-server
    // project directories don't share Docker resources.
    const slug = projectPathSlug(tmpDir);
    expect(resolved.projectSlug).toBe(slug);
    expect(resolved.images.control).toBe(`${slug}:control`);
    expect(resolved.images.experiment).toBe(`${slug}:experiment`);
  });

  it('keeps image names stable when only experimentDir changes', () => {
    const altProject = path.join(tmpDir, 'project-alt');
    fs.mkdirSync(altProject, { recursive: true });
    const a = resolveConfig(makeConfig(), tmpDir);
    const b = resolveConfig(makeConfig({ experimentDir: altProject }), tmpDir);
    expect(a.images.control).toBe(b.images.control);
    expect(a.images.experiment).toBe(b.images.experiment);
    expect(a.projectSlug).toBe(b.projectSlug);
  });

  it('produces different image names for two different local project paths', () => {
    const otherProjectDir = path.join(tmpDir, 'other-local-project');
    fs.mkdirSync(otherProjectDir, { recursive: true });
    const a = resolveConfig(makeConfig(), tmpDir);
    const b = resolveConfig(makeConfig({
      experimentDir,
      controlDir,
      dockerBuildDir,
    }), otherProjectDir);
    expect(a.images.control).not.toBe(b.images.control);
    expect(a.images.experiment).not.toBe(b.images.experiment);
    expect(a.projectSlug).not.toBe(b.projectSlug);
  });

  it('uses bundled default compose file when composeFile not specified', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.composeFile).toMatch(/templates[/\\]docker-compose\.yml$/);
    expect(fs.existsSync(resolved.composeFile)).toBe(true);
  });

  it('resolves explicit composeFile relative to projectDir', () => {
    const resolved = resolveConfig(makeConfig({ composeFile: 'docker-compose.yml' }), tmpDir);
    expect(resolved.composeFile).toBe(path.resolve(tmpDir, 'docker-compose.yml'));
  });

  it('resolves procfile relative to projectDir', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.procfile).toBe(path.resolve(tmpDir, 'Procfile.twin'));
  });

  it('defaults setupCommands to empty array', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.setupCommands).toEqual([]);
  });

  it('defaults rebuildCommands to empty array', () => {
    const resolved = resolveConfig(makeConfig(), tmpDir);
    expect(resolved.rebuildCommands).toEqual([]);
  });

  it('passes through configured rebuildCommands', () => {
    const resolved = resolveConfig(makeConfig({
      rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
    }), tmpDir);

    expect(resolved.rebuildCommands).toEqual([
      { description: 'Build assets', command: 'yarn build' },
    ]);
  });

  it('passes through setupCommands when provided', () => {
    const config = makeConfig({
      setupCommands: [{ command: 'rake db:migrate', description: 'Migrate' }],
    });
    const resolved = resolveConfig(config, tmpDir);
    expect(resolved.setupCommands).toHaveLength(1);
    expect(resolved.setupCommands[0].command).toBe('rake db:migrate');
  });

  it('rejects missing ports', () => {
    const { ports: _omit, ...rest } = makeConfig();
    expect(() => resolveConfig(rest, tmpDir)).toThrow(/ports/);
  });

  it('passes through explicit ports', () => {
    const resolved = resolveConfig(
      makeConfig({ ports: { control: 3060, experiment: 3090 } }),
      tmpDir,
    );
    expect(resolved.ports).toEqual({ control: 3060, experiment: 3090 });
  });

  it('throws on Zod validation failure', () => {
    expect(() => resolveConfig({}, tmpDir)).toThrow();
  });

  it('throws on empty experimentDir', () => {
    expect(() => resolveConfig(makeConfig({ experimentDir: '' }), tmpDir)).toThrow('experimentDir');
  });

  it('throws when experimentDir is missing', () => {
    const { experimentDir: _omit, ...config } = makeConfig();
    expect(() => resolveConfig(config, tmpDir)).toThrow('experimentDir');
  });

  it('throws when experimentDir does not exist', () => {
    expect(() => resolveConfig(makeConfig({ experimentDir: '/nonexistent/path' }), tmpDir))
      .toThrow('Experiment directory not found');
  });

  it('throws when dockerBuildDir does not exist', () => {
    expect(() => resolveConfig(makeConfig({ dockerBuildDir: '/nonexistent/build' }), tmpDir))
      .toThrow('Docker build root not found');
  });

  it('derives volume dirs under ~/shaka-perf-volumes keyed by the local project-path slug', () => {
    // Volumes live under a slug-keyed dir so two twin-server project
    // directories don't bind-mount the same host directory.
    const homeDir = os.homedir();
    const resolved = resolveConfig(makeConfig(), tmpDir);
    const slug = projectPathSlug(tmpDir);
    const base = path.join(homeDir, 'shaka-perf-volumes', slug);
    expect(resolved.volumes.control).toBe(path.join(base, 'control'));
    expect(resolved.volumes.experiment).toBe(path.join(base, 'experiment'));
  });

  it('resolves relative paths from cwd', () => {
    // Make paths relative to tmpDir
    const config = makeConfig({
      experimentDir: 'project',
      controlDir: 'control',
      dockerBuildDir: 'build',
    });
    const resolved = resolveConfig(config, tmpDir);
    expect(resolved.experimentDir).toBe(path.resolve(tmpDir, 'project'));
    expect(resolved.controlDir).toBe(path.resolve(tmpDir, 'control'));
    expect(resolved.dockerBuildDir).toBe(path.resolve(tmpDir, 'build'));
  });

  it('loads twinServers rebuildCommands from an abtests config', async () => {
    const configPath = path.join(tmpDir, 'abtests.config.js');
    fs.writeFileSync(configPath, `module.exports = ${JSON.stringify({
      twinServers: makeConfig({
        rebuildCommands: [{ description: 'Build assets', command: 'yarn build' }],
      }),
    })}`);

    const loaded = await loadConfig(configPath);

    expect(loaded.rebuildCommands).toEqual([
      { description: 'Build assets', command: 'yarn build' },
    ]);
  });

  it('rejects invalid twinServers rebuildCommands while loading an abtests config', async () => {
    const configPath = path.join(tmpDir, 'abtests.config.invalid.js');
    fs.writeFileSync(configPath, `module.exports = ${JSON.stringify({
      twinServers: {
        ...makeConfig(),
        rebuildCommands: [{ description: 'Build assets', command: 42 }],
      },
    })}`);

    await expect(loadConfig(configPath)).rejects.toThrow(/rebuildCommands/);
  });
});
