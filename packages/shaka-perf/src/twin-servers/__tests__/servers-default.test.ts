/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serversDefault } from '../commands/servers-default';
import { build } from '../commands/build';
import { startContainers } from '../commands/start-containers';
import { stopContainers } from '../commands/stop-containers';
import { runServersMenu } from '../commands/servers-menu';
import { dockerImageExists, getImageCreatedAt, containersRunning } from '../helpers/docker';
import { invalidateImageCreated } from '../helpers/rebuild-check';
import { confirm, exec } from '../helpers/shell';
import { getGitRemoteUrl, getGitRootDirectory } from '../helpers/git';
import { startProxyServer } from '../ipc/server';
import type { ResolvedConfig } from '../types';

jest.mock('../commands/build', () => ({
  ...jest.requireActual('../commands/build'),
  build: jest.fn(),
}));
jest.mock('../commands/start-containers');
jest.mock('../commands/stop-containers');
jest.mock('../commands/servers-menu');
jest.mock('../helpers/docker');
jest.mock('../helpers/shell');
jest.mock('../helpers/git');
jest.mock('../helpers/ui');
jest.mock('../ipc/server');
jest.mock('../ipc/dispatch');

describe('servers startup with a missing source checkout and an existing image', () => {
  let root: string;
  let config: ResolvedConfig;

  beforeEach(() => {
    jest.resetAllMocks();
    invalidateImageCreated();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-servers-startup-'));
    const experimentDir = path.join(root, 'app');
    fs.mkdirSync(experimentDir);
    config = {
      projectDir: experimentDir,
      experimentDir,
      controlDir: path.join(root, 'app-control'),
      dockerBuildDir: experimentDir,
      dockerfile: 'Dockerfile',
      images: { control: 'app:control', experiment: 'app:experiment' },
      volumes: { control: path.join(root, 'volumes/control'), experiment: path.join(root, 'volumes/experiment') },
      projectSlug: 'app',
    } as ResolvedConfig;
    jest.mocked(dockerImageExists).mockReturnValue(true);
    jest.mocked(getImageCreatedAt).mockReturnValue(new Date('2020-01-01'));
    jest.mocked(containersRunning).mockResolvedValue(true);
    jest.mocked(getGitRemoteUrl).mockReturnValue('https://example.com/app.git');
    jest.mocked(getGitRootDirectory).mockReturnValue(config.experimentDir);
    jest.mocked(exec).mockImplementation(async (_cmd, args) => {
      if (args?.[0] === 'clone') fs.mkdirSync(config.controlDir);
      return { code: 0, stdout: '', stderr: '' };
    });
    // Avoid opening an IPC listener; startup should still reach the menu.
    jest.mocked(startProxyServer).mockRejectedValue(new Error('IPC disabled in test'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('clones on confirmation and rebuilds control before starting containers', async () => {
    jest.mocked(confirm).mockResolvedValueOnce(true);
    await serversDefault(config);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Clone now? Declining will continue using the existing control image without cloning.');
    expect(exec).toHaveBeenCalledWith('git', ['clone', 'https://example.com/app.git', config.controlDir]);
    expect(build).toHaveBeenCalledWith(config, { target: 'control' });
    expect(startContainers).toHaveBeenCalledTimes(1);
    expect(runServersMenu).toHaveBeenCalledTimes(1);
    expect(jest.mocked(exec).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(stopContainers).mock.invocationCallOrder[0]);
  });

  it('clones at the repository root when the build context is nested', async () => {
    const source = config.experimentDir;
    const buildDir = path.join(source, 'packages/web');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'Dockerfile'), 'FROM scratch\n');
    execFileSync('git', ['init', source], { stdio: 'pipe' });
    execFileSync('git', ['-C', source, 'add', '.']);
    execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'], { stdio: 'pipe' });
    config.dockerBuildDir = buildDir;
    config.dockerfile = 'packages/web/Dockerfile';
    jest.mocked(getGitRemoteUrl).mockReturnValue(source);
    jest.mocked(getGitRootDirectory).mockImplementation((cwd) => execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
    jest.mocked(exec).mockImplementation(async (cmd, args) => {
      execFileSync(cmd, args, { stdio: 'pipe' });
      return { code: 0, stdout: '', stderr: '' };
    });
    jest.mocked(confirm).mockResolvedValueOnce(true);

    await serversDefault(config);

    expect(exec).toHaveBeenCalledWith('git', ['clone', source, config.controlDir]);
    expect(fs.readFileSync(path.join(config.controlDir, 'packages/web/Dockerfile'), 'utf8')).toBe('FROM scratch\n');
    expect(fs.existsSync(path.join(config.controlDir, '.git'))).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing experiment build context before offering a control clone', async () => {
    config.dockerBuildDir = path.join(config.projectDir, 'packages/web');
    fs.mkdirSync(config.dockerBuildDir, { recursive: true });
    config.experimentDir = path.join(root, 'separate-experiment');
    fs.mkdirSync(config.experimentDir);

    await expect(serversDefault(config)).rejects.toThrow(path.join(config.experimentDir, 'packages/web'));

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(stopContainers).not.toHaveBeenCalled();
    expect(runServersMenu).not.toHaveBeenCalled();
  });

  it('rejects a missing control build context in an existing checkout without offering cloning', async () => {
    config.dockerBuildDir = path.join(config.projectDir, 'packages/web');
    fs.mkdirSync(config.dockerBuildDir, { recursive: true });
    fs.mkdirSync(config.controlDir);
    fs.writeFileSync(path.join(config.controlDir, '.git'), 'existing checkout');

    await expect(serversDefault(config)).rejects.toThrow(path.join(config.controlDir, 'packages/web'));

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(stopContainers).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(config.controlDir, '.git'), 'utf8')).toBe('existing checkout');
  });

  it('offers cloning based on controlDir even when its parent build directory exists', async () => {
    const sourceRoot = config.experimentDir;
    config.projectDir = path.join(sourceRoot, 'app');
    config.experimentDir = config.projectDir;
    config.dockerBuildDir = sourceRoot;
    config.controlDir = path.join(root, 'control/app');
    fs.mkdirSync(config.experimentDir);
    fs.mkdirSync(path.dirname(config.controlDir));
    jest.mocked(confirm).mockResolvedValueOnce(true);

    await serversDefault(config);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('git', ['clone', 'https://example.com/app.git', path.dirname(config.controlDir)]);
    expect(build).toHaveBeenCalledWith(config, { target: 'control' });
  });

  it('continues with the existing image when the single clone prompt is declined', async () => {
    jest.mocked(confirm).mockResolvedValueOnce(false);
    await serversDefault(config);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Clone now? Declining will continue using the existing control image without cloning.');
    expect(exec).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(stopContainers).not.toHaveBeenCalled();
    expect(runServersMenu).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(config.controlDir)).toBe(false);
  });

  it('preserves an experiment rebuild when control image reuse is confirmed', async () => {
    jest.mocked(confirm).mockResolvedValueOnce(false);
    fs.writeFileSync(path.join(config.experimentDir, 'app.ts'), 'changed');
    await serversDefault(config);

    expect(build).toHaveBeenCalledWith(config, { target: 'experiment' });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('rebuilds both sides when control is cloned and experiment has changed', async () => {
    jest.mocked(confirm).mockResolvedValueOnce(true);
    fs.writeFileSync(path.join(config.experimentDir, 'app.ts'), 'changed');
    await serversDefault(config);

    expect(build).toHaveBeenCalledWith(config, { target: undefined });
  });

  it('does not prompt when both source directories exist', async () => {
    fs.mkdirSync(config.controlDir);
    await serversDefault(config);

    expect(confirm).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('offers cloning before rebuilding when the control image is also missing', async () => {
    jest.mocked(dockerImageExists).mockImplementation((image) => image !== config.images.control);
    jest.mocked(confirm).mockResolvedValueOnce(true);
    await serversDefault(config);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Clone now? Declining will stop the build.');
    expect(build).toHaveBeenCalledWith(config, { target: 'control' });
  });

  it('requires confirmation even when the clone remote is unavailable', async () => {
    jest.mocked(getGitRemoteUrl).mockReturnValue('');
    jest.mocked(confirm).mockResolvedValueOnce(true);
    await serversDefault(config);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Continue using the existing control image without cloning?');
    expect(exec).not.toHaveBeenCalled();
  });

  it('honors confirmed image reuse even when its creation time cannot be inspected', async () => {
    jest.mocked(getImageCreatedAt).mockReturnValue(null);
    jest.mocked(confirm).mockResolvedValueOnce(false);
    await serversDefault(config);

    expect(build).toHaveBeenCalledWith(config, { target: 'experiment' });
  });

  it('starts stopped containers after image reuse is confirmed', async () => {
    jest.mocked(confirm).mockResolvedValueOnce(false);
    jest.mocked(containersRunning).mockResolvedValue(false);
    await serversDefault(config);

    expect(build).not.toHaveBeenCalled();
    expect(startContainers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(confirm).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(startContainers).mock.invocationCallOrder[0]);
  });

  it('does not stop containers or open the menu when cloning fails', async () => {
    jest.mocked(confirm).mockResolvedValueOnce(true);
    jest.mocked(exec).mockResolvedValue({ code: 1, stdout: '', stderr: 'clone failed' });
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit(1)'); });
    await expect(serversDefault(config)).rejects.toThrow('process.exit(1)');

    expect(stopContainers).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(runServersMenu).not.toHaveBeenCalled();
  });

  it('stops without an image when cloning is declined', async () => {
    jest.mocked(dockerImageExists).mockReturnValue(false);
    jest.mocked(confirm).mockResolvedValueOnce(false);
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit(1)'); });

    await expect(serversDefault(config)).rejects.toThrow('process.exit(1)');

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Clone now? Declining will stop the build.');
    expect(exec).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(stopContainers).not.toHaveBeenCalled();
  });
});
