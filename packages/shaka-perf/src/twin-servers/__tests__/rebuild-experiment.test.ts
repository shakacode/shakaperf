/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  experimentRebuildMenuDefinition,
  experimentRebuildCommandsAvailable,
  rebuildExperimentInContainer,
  type ExperimentRebuildDependencies,
} from '../commands/rebuild-experiment';
import type { ResolvedConfig } from '../types';

function fakeConfig(commands: string[]): ResolvedConfig {
  return {
    rebuildCommands: commands.map((command) => ({
      command,
      description: `Run ${command}`,
    })),
  } as ResolvedConfig;
}

function recordingDependencies(events: string[]): ExperimentRebuildDependencies {
  return {
    logExperimentCommit: async () => { events.push('log-commit'); },
    recordExperimentCommit: async (_config, invalidating) => {
      events.push(invalidating ? 'invalidate-commit' : 'refresh-commit');
    },
    runCommand: async (_config, target, command) => {
      events.push(`run:${target}:${command}`);
    },
    restartExperimentProcesses: async () => {
      events.push('restart-experiment');
    },
    waitForExperimentReady: async () => {
      events.push('wait-experiment');
    },
  };
}

describe('experiment in-container rebuild', () => {
  it('is available only when rebuild commands are configured', () => {
    expect(experimentRebuildCommandsAvailable(fakeConfig([]))).toBe(false);
    expect(experimentRebuildCommandsAvailable(fakeConfig(['yarn build']))).toBe(true);
  });

  it('defines the experiment-specific menu row only when commands exist', () => {
    expect(experimentRebuildMenuDefinition(fakeConfig([]))).toBeNull();
    expect(experimentRebuildMenuDefinition(fakeConfig(['yarn build']))).toEqual({
      id: 'rebuild-experiment-in-container',
      numericKey: '9',
      label: 'Rebuild experiment in container (rebuildCommands)',
    });
  });

  it('runs configured commands in order before restarting only the experiment', async () => {
    const events: string[] = [];
    const config = fakeConfig(['yarn build', 'bin/rails assets:precompile']);

    await rebuildExperimentInContainer(config, recordingDependencies(events));

    expect(events).toEqual([
      'invalidate-commit',
      'run:experiment:yarn build',
      'run:experiment:bin/rails assets:precompile',
      'restart-experiment',
      'wait-experiment',
      'refresh-commit',
      'log-commit',
    ]);
  });

  it('surfaces a command failure without running later lifecycle steps', async () => {
    const events: string[] = [];
    const config = fakeConfig(['failing command', 'must not run']);
    const dependencies = recordingDependencies(events);
    dependencies.runCommand = async (_config, target, command) => {
      events.push(`run:${target}:${command}`);
      throw new Error('rebuild failed');
    };

    await expect(rebuildExperimentInContainer(config, dependencies)).rejects.toThrow('rebuild failed');
    expect(events).toEqual(['invalidate-commit', 'run:experiment:failing command']);
  });
});


it.each(['restartExperimentProcesses', 'waitForExperimentReady'] as const)('keeps identity invalid when %s fails', async (step) => {
  const events: string[] = [];
  const deps = recordingDependencies(events);
  deps[step] = async () => { throw new Error('restart failed'); };
  await expect(rebuildExperimentInContainer(fakeConfig(['build']), deps)).rejects.toThrow('restart failed');
  expect(events).toContain('invalidate-commit');
  expect(events).not.toContain('refresh-commit');
  expect(events).not.toContain('log-commit');
});
