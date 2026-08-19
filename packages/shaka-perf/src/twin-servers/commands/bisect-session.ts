/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import { build } from './build';
import { runCmd } from './run-cmd';
import { recreateExperimentContainer } from '../helpers/docker';
import {
  restartExperimentProcesses,
  waitForExperimentReady,
} from '../helpers/overmind-processes';

export interface BisectExperimentReloadResult {
  mode: 'commands' | 'container';
  usedFallback: boolean;
}

export interface BisectExperimentReloadOptions {
  mode: 'commands' | 'container';
  rebuildCommands: string[];
  noCache: boolean;
}

export interface BisectSessionDependencies {
  buildExperiment(config: ResolvedConfig, noCache: boolean): Promise<void>;
  recreateExperimentContainer(config: ResolvedConfig): Promise<void>;
  runExperimentCommand(config: ResolvedConfig, command: string): Promise<void>;
  restartExperimentProcesses(config: ResolvedConfig): Promise<void>;
  waitForExperimentReady(config: ResolvedConfig): Promise<void>;
  ownerProcessAlive(ownerPid: number): boolean;
}

interface ActiveSession {
  sessionId: string;
  ownerPid: number;
}

const defaultDependencies: BisectSessionDependencies = {
  buildExperiment: (config, noCache) => build(config, { target: 'experiment', noCache }),
  recreateExperimentContainer,
  runExperimentCommand: (config, command) => runCmd(config, 'experiment', command),
  restartExperimentProcesses,
  waitForExperimentReady,
  ownerProcessAlive,
};

export class BisectSessionController {
  private activeSession: ActiveSession | null = null;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly dependencies: BisectSessionDependencies = defaultDependencies,
  ) {}

  get activeSessionId(): string | null {
    this.reapAbandonedSession();
    return this.activeSession?.sessionId ?? null;
  }

  beginSession(sessionId: string, ownerPid: number): void {
    if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
      throw new Error('bisect requires a positive owner PID');
    }
    this.reapAbandonedSession();
    if (this.activeSession && this.activeSession.sessionId !== sessionId) {
      throw new Error('another bisect session is already active');
    }
    this.activeSession = { sessionId, ownerPid };
  }

  async reloadExperiment(
    sessionId: string,
    options: BisectExperimentReloadOptions,
  ): Promise<BisectExperimentReloadResult> {
    this.requireSession(sessionId);
    if (options.mode === 'container' || options.rebuildCommands.length === 0) {
      await this.rebuildAndReloadExperimentContainer(options.noCache);
      return { mode: 'container', usedFallback: false };
    }

    try {
      for (const command of options.rebuildCommands) {
        await this.dependencies.runExperimentCommand(this.config, command);
      }
      await this.restartAndWait();
      return { mode: 'commands', usedFallback: false };
    } catch {
      await this.rebuildAndReloadExperimentContainer(options.noCache);
      return { mode: 'container', usedFallback: true };
    }
  }

  async runRepairCommands(
    sessionId: string,
    phase: 'prepare' | 'cleanup',
    commands: readonly string[],
  ): Promise<void> {
    this.requireSession(sessionId);
    for (const [index, command] of commands.entries()) {
      try {
        await this.dependencies.runExperimentCommand(this.config, command);
      } catch (error) {
        throw new Error(
          `Bisect repair ${phase} command ${index + 1} failed: ${command}`,
          { cause: error },
        );
      }
    }
  }

  endSession(sessionId: string): void {
    this.requireSession(sessionId);
    this.activeSession = null;
  }

  private requireSession(sessionId: string): void {
    this.reapAbandonedSession();
    if (this.activeSession?.sessionId !== sessionId) {
      throw new Error('bisect session ID does not match the active lease');
    }
  }

  private async rebuildAndReloadExperimentContainer(noCache: boolean): Promise<void> {
    await this.dependencies.buildExperiment(this.config, noCache);
    await this.dependencies.recreateExperimentContainer(this.config);
    for (const setupCommand of this.config.setupCommands) {
      await this.dependencies.runExperimentCommand(this.config, setupCommand.command);
    }
    await this.restartAndWait();
  }

  private async restartAndWait(): Promise<void> {
    await this.dependencies.restartExperimentProcesses(this.config);
    await this.dependencies.waitForExperimentReady(this.config);
  }

  private reapAbandonedSession(): void {
    if (!this.activeSession) return;
    if (!this.dependencies.ownerProcessAlive(this.activeSession.ownerPid)) {
      this.activeSession = null;
    }
  }
}

function ownerProcessAlive(ownerPid: number): boolean {
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    return true;
  }
}
