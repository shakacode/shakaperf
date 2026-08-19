/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BisectSessionController,
  type BisectSessionDependencies,
} from '../commands/bisect-session';
import { recreateExperimentContainer } from '../helpers/docker';
import {
  experimentProcessNames,
  restartExperimentProcesses,
  waitForExperimentReady,
} from '../helpers/overmind-processes';
import * as shell from '../helpers/shell';
import type { ResolvedConfig } from '../types';

jest.mock('../helpers/shell');

const mockExec = shell.exec as jest.MockedFunction<typeof shell.exec>;

function fakeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bisect-session-'));
  const procfile = path.join(projectDir, 'Procfile.twin');
  fs.writeFileSync(procfile, [
    'control-rails: shaka-perf servers run-overmind-command control "bin/rails server"',
    'experiment-rails: shaka-perf servers run-overmind-command experiment "bin/rails server"',
    'notify-control-server-started: shaka-perf servers notify-server-started control',
    'notify-experiment-server-started: shaka-perf servers notify-server-started experiment',
  ].join('\n'));
  return {
    projectDir,
    experimentDir: path.join(projectDir, 'experiment'),
    controlDir: path.join(projectDir, 'control'),
    dockerBuildDir: projectDir,
    dockerfile: 'Dockerfile',
    dockerBuildArgs: {},
    composeFile: path.join(projectDir, 'docker-compose.yml'),
    procfile,
    images: { control: 'app:control', experiment: 'app:experiment' },
    volumes: {
      control: path.join(projectDir, 'volumes', 'control'),
      experiment: path.join(projectDir, 'volumes', 'experiment'),
    },
    ports: { control: 3020, experiment: 3030 },
    setupCommands: [{ command: 'bin/setup', description: 'Set up experiment' }],
    rebuildCommands: [],
    copyIgnore: { folders: [], files: [] },
    projectSlug: 'bisect-session',
    ...overrides,
  };
}

type MockDependencies = {
  [Key in keyof BisectSessionDependencies]: jest.MockedFunction<BisectSessionDependencies[Key]>;
};

function fakeDependencies(
  overrides: Partial<BisectSessionDependencies> = {},
): MockDependencies {
  return {
    buildExperiment: jest.fn().mockResolvedValue(undefined),
    recreateExperimentContainer: jest.fn().mockResolvedValue(undefined),
    runExperimentCommand: jest.fn().mockResolvedValue(undefined),
    restartExperimentProcesses: jest.fn().mockResolvedValue(undefined),
    waitForExperimentReady: jest.fn().mockResolvedValue(undefined),
    ownerProcessAlive: jest.fn().mockReturnValue(true),
    ...overrides,
  } as MockDependencies;
}

describe('experiment Overmind process targeting', () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  it('discovers only experiment-owned Procfile processes', () => {
    const procfile = [
      'control-rails: shaka-perf servers run-overmind-command control "bin/rails server"',
      'experiment-rails: shaka-perf servers run-overmind-command experiment "bin/rails server"',
      'notify-control-server-started: shaka-perf servers notify-server-started control',
      'notify-experiment-server-started: shaka-perf servers notify-server-started experiment',
      'worker: bundle exec sidekiq',
    ].join('\n');

    expect(experimentProcessNames(procfile)).toEqual([
      'experiment-rails',
      'notify-experiment-server-started',
    ]);
  });

  it('stops experiment processes before terminating tracked commands and restarting them', async () => {
    const config = fakeConfig();

    await restartExperimentProcesses(config);

    const socketPath = path.join(config.projectDir, '.overmind.sock');
    expect(mockExec).toHaveBeenNthCalledWith(
      1,
      'overmind',
      ['stop', '--socket', socketPath, 'experiment-rails', 'notify-experiment-server-started'],
      { cwd: config.projectDir },
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      2,
      'docker',
      expect.arrayContaining([
        'exec',
        '-T',
        'experiment-server',
        'bash',
        '-c',
        expect.stringContaining('/tmp/overmind-pid.*'),
      ]),
      expect.objectContaining({ cwd: config.projectDir }),
    );
    const cleanupCommand = mockExec.mock.calls[1]?.[1].at(-1);
    expect(cleanupCommand?.match(/for attempt in \$\(seq 1 100\)/g)).toHaveLength(2);
    expect(cleanupCommand).toContain('[ -z "$pids" ] || exit 1');
    expect(mockExec).toHaveBeenNthCalledWith(
      3,
      'overmind',
      ['restart', '--socket', socketPath, 'experiment-rails', 'notify-experiment-server-started'],
      { cwd: config.projectDir },
    );
  });

  it('polls and settles only the experiment port', async () => {
    const config = fakeConfig();
    const probe = jest.fn()
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce({ ready: true });
    const sleep = jest.fn().mockResolvedValue(undefined);

    await waitForExperimentReady(config, { probe, sleep, pollMs: 1, settleMs: 1, maxAttempts: 2 });

    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenNthCalledWith(1, config.ports.experiment);
    expect(probe).toHaveBeenNthCalledWith(2, config.ports.experiment);
    expect(probe).not.toHaveBeenCalledWith(config.ports.control);
  });
});

describe('experiment-only container recreation', () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  it('recreates only experiment-server and only clears the experiment volume', async () => {
    const config = fakeConfig();
    fs.mkdirSync(config.volumes.control, { recursive: true });
    fs.mkdirSync(config.volumes.experiment, { recursive: true });
    fs.writeFileSync(path.join(config.volumes.control, 'keep.txt'), 'control');
    fs.writeFileSync(path.join(config.volumes.experiment, 'remove.txt'), 'experiment');

    await recreateExperimentContainer(config);

    expect(mockExec.mock.calls.map((call) => call[1])).toEqual([
      ['compose', '-f', config.composeFile, '-p', config.projectSlug, 'rm', '-s', '-f', 'experiment-server'],
      ['compose', '-f', config.composeFile, '-p', config.projectSlug, 'up', '-d', '--force-recreate', 'experiment-server'],
    ]);
    expect(fs.readFileSync(path.join(config.volumes.control, 'keep.txt'), 'utf8')).toBe('control');
    expect(fs.existsSync(path.join(config.volumes.experiment, 'remove.txt'))).toBe(false);
  });
});

describe('BisectSessionController experiment reload strategy', () => {
  it('runs rebuild commands and refreshes only experiment processes in command mode', async () => {
    const config = fakeConfig();
    const deps = fakeDependencies();
    const controller = new BisectSessionController(config, deps);
    controller.beginSession('session-1', process.pid);

    await expect(controller.reloadExperiment('session-1', {
      mode: 'commands',
      rebuildCommands: ['yarn build', 'bin/rails db:migrate'],
      noCache: false,
    })).resolves.toEqual({ mode: 'commands', usedFallback: false });

    expect(deps.runExperimentCommand.mock.calls).toEqual([
      [config, 'yarn build'],
      [config, 'bin/rails db:migrate'],
    ]);
    expect(deps.restartExperimentProcesses).toHaveBeenCalledWith(config);
    expect(deps.waitForExperimentReady).toHaveBeenCalledWith(config);
    expect(deps.buildExperiment).not.toHaveBeenCalled();
    expect(deps.recreateExperimentContainer).not.toHaveBeenCalled();
  });

  it('uses container mode when forced and runs experiment setup commands', async () => {
    const config = fakeConfig();
    const deps = fakeDependencies();
    const controller = new BisectSessionController(config, deps);
    controller.beginSession('session-1', process.pid);

    await expect(controller.reloadExperiment('session-1', {
      mode: 'container',
      rebuildCommands: ['command-mode-only rebuild'],
      noCache: true,
    })).resolves.toEqual({ mode: 'container', usedFallback: false });

    expect(deps.buildExperiment).toHaveBeenCalledWith(config, true);
    expect(deps.recreateExperimentContainer).toHaveBeenCalledWith(config);
    expect(deps.runExperimentCommand).toHaveBeenCalledWith(config, 'bin/setup');
    expect(deps.runExperimentCommand).not.toHaveBeenCalledWith(config, 'command-mode-only rebuild');
    expect(deps.restartExperimentProcesses).toHaveBeenCalledWith(config);
    expect(deps.waitForExperimentReady).toHaveBeenCalledWith(config);
  });

  it('uses container mode when command mode has no rebuild commands', async () => {
    const config = fakeConfig();
    const deps = fakeDependencies();
    const controller = new BisectSessionController(config, deps);
    controller.beginSession('session-1', process.pid);

    await expect(controller.reloadExperiment('session-1', {
      mode: 'commands',
      rebuildCommands: [],
      noCache: false,
    })).resolves.toEqual({ mode: 'container', usedFallback: false });

    expect(deps.buildExperiment).toHaveBeenCalledTimes(1);
    expect(deps.recreateExperimentContainer).toHaveBeenCalledTimes(1);
  });

  it('falls back to the container path exactly once after a rebuild command fails', async () => {
    const config = fakeConfig();
    const deps = fakeDependencies({
      runExperimentCommand: jest.fn()
        .mockRejectedValueOnce(new Error('command failed'))
        .mockResolvedValue(undefined),
    });
    const controller = new BisectSessionController(config, deps);
    controller.beginSession('session-1', process.pid);

    await expect(controller.reloadExperiment('session-1', {
      mode: 'commands',
      rebuildCommands: ['yarn build'],
      noCache: false,
    })).resolves.toEqual({ mode: 'container', usedFallback: true });

    expect(deps.buildExperiment).toHaveBeenCalledTimes(1);
    expect(deps.recreateExperimentContainer).toHaveBeenCalledTimes(1);
    expect(deps.runExperimentCommand.mock.calls).toEqual([
      [config, 'yarn build'],
      [config, 'bin/setup'],
    ]);
  });

  it('falls back to the container path exactly once after command-mode readiness fails', async () => {
    const config = fakeConfig();
    const deps = fakeDependencies({
      waitForExperimentReady: jest.fn()
        .mockRejectedValueOnce(new Error('experiment not ready'))
        .mockResolvedValue(undefined),
    });
    const controller = new BisectSessionController(config, deps);
    controller.beginSession('session-1', process.pid);

    await expect(controller.reloadExperiment('session-1', {
      mode: 'commands',
      rebuildCommands: ['yarn build'],
      noCache: false,
    })).resolves.toEqual({ mode: 'container', usedFallback: true });

    expect(deps.buildExperiment).toHaveBeenCalledTimes(1);
    expect(deps.recreateExperimentContainer).toHaveBeenCalledTimes(1);
    expect(deps.restartExperimentProcesses).toHaveBeenCalledTimes(2);
    expect(deps.waitForExperimentReady).toHaveBeenCalledTimes(2);
  });
});

describe('BisectSessionController lease', () => {
  it('runs repair commands sequentially only for the owning session', async () => {
    const config = fakeConfig();
    const deps = fakeDependencies();
    const controller = new BisectSessionController(config, deps);
    controller.beginSession('owner', process.pid);

    await controller.runRepairCommands('owner', 'prepare', ['bin/seed', 'bin/check-seed']);

    expect(deps.runExperimentCommand.mock.calls).toEqual([
      [config, 'bin/seed'],
      [config, 'bin/check-seed'],
    ]);
    await expect(controller.runRepairCommands('competitor', 'cleanup', ['bin/unseed']))
      .rejects.toThrow(/does not match/);
  });

  it('stops repair commands at the first failure with phase context', async () => {
    const config = fakeConfig();
    const deps = fakeDependencies({
      runExperimentCommand: jest.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('seed failed')),
    });
    const controller = new BisectSessionController(config, deps);
    controller.beginSession('owner', process.pid);

    await expect(controller.runRepairCommands(
      'owner',
      'cleanup',
      ['bin/one', 'bin/two', 'bin/three'],
    )).rejects.toThrow(/cleanup command 2 failed: bin\/two/i);
    expect(deps.runExperimentCommand).toHaveBeenCalledTimes(2);
  });

  it('rejects non-positive owner PIDs', () => {
    const controller = new BisectSessionController(fakeConfig(), fakeDependencies());

    expect(() => controller.beginSession('zero', 0)).toThrow(/positive owner PID/);
    expect(() => controller.beginSession('negative', -1)).toThrow(/positive owner PID/);
    expect(() => controller.beginSession('fractional', 1.5)).toThrow(/positive owner PID/);
  });

  it('rejects competing sessions and requires the owner session for reload and end', async () => {
    const controller = new BisectSessionController(fakeConfig(), fakeDependencies());
    controller.beginSession('owner', process.pid);

    expect(() => controller.beginSession('competitor', process.pid)).toThrow(/already active/);
    await expect(controller.reloadExperiment('competitor', {
      mode: 'commands',
      rebuildCommands: ['yarn build'],
      noCache: false,
    })).rejects.toThrow(/does not match/);
    expect(() => controller.endSession('competitor')).toThrow(/does not match/);
    expect(controller.activeSessionId).toBe('owner');
  });

  it('becomes inactive when its owner process no longer exists', () => {
    const deps = fakeDependencies({ ownerProcessAlive: jest.fn().mockReturnValue(false) });
    const controller = new BisectSessionController(fakeConfig(), deps);
    controller.beginSession('abandoned', 2_147_483_647);

    expect(controller.activeSessionId).toBeNull();
  });
});
