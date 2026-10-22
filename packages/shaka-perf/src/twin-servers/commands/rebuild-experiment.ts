/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import {
  restartExperimentProcesses,
  waitForExperimentReady,
} from '../helpers/overmind-processes';
import { runCmd } from './run-cmd';
import { recordReloadedExperimentCommit, logServerCommit } from '../helpers/server-commit';

export interface ExperimentRebuildDependencies {
  runCommand(
    config: ResolvedConfig,
    target: 'control' | 'experiment',
    command: string,
  ): Promise<void>;
  restartExperimentProcesses(config: ResolvedConfig): Promise<void>;
  waitForExperimentReady(config: ResolvedConfig): Promise<void>;
  recordExperimentCommit(config: ResolvedConfig, invalidating: boolean): Promise<void>;
  logExperimentCommit(config: ResolvedConfig): Promise<void>;
}

const defaultDependencies: ExperimentRebuildDependencies = {
  runCommand: (config, target, command) => runCmd(config, target, command),
  restartExperimentProcesses,
  waitForExperimentReady,
  logExperimentCommit: (config) => logServerCommit(config, 'experiment'),
  recordExperimentCommit: recordReloadedExperimentCommit,
};

export function experimentRebuildCommandsAvailable(config: ResolvedConfig): boolean {
  return config.rebuildCommands.length > 0;
}

export interface ExperimentRebuildMenuDefinition {
  id: 'rebuild-experiment-in-container';
  numericKey: '9';
  label: 'Rebuild experiment in container (rebuildCommands)';
}

export function experimentRebuildMenuDefinition(
  config: ResolvedConfig,
): ExperimentRebuildMenuDefinition | null {
  if (!experimentRebuildCommandsAvailable(config)) return null;
  return {
    id: 'rebuild-experiment-in-container',
    numericKey: '9',
    label: 'Rebuild experiment in container (rebuildCommands)',
  };
}

export async function rebuildExperimentInContainer(
  config: ResolvedConfig,
  dependencies: ExperimentRebuildDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.recordExperimentCommit(config, true);
  for (const command of config.rebuildCommands) {
    await dependencies.runCommand(config, 'experiment', command.command);
  }
  await dependencies.restartExperimentProcesses(config);
  await dependencies.waitForExperimentReady(config);
  await dependencies.recordExperimentCommit(config, false);
  await dependencies.logExperimentCommit(config);
}
