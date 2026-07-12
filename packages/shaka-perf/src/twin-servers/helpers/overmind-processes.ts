/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResolvedConfig } from '../types';
import { exec } from './shell';
import { probeHttpEndpoint, type HttpProbeResult } from './server-ready';

const EXPERIMENT_COMMANDS = [
  /\brun-overmind-command\s+experiment(?:\s|$)/,
  /\bnotify-server-started\s+experiment(?:\s|$)/,
];

export function experimentProcessNames(procfile: string): string[] {
  const names: string[] = [];
  for (const line of procfile.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const command = line.slice(separator + 1);
    if (name && EXPERIMENT_COMMANDS.some((pattern) => pattern.test(command))) {
      names.push(name);
    }
  }
  return names;
}

export async function restartExperimentProcesses(config: ResolvedConfig): Promise<void> {
  const names = experimentProcessNames(fs.readFileSync(config.procfile, 'utf8'));
  if (names.length === 0) {
    throw new Error(`No experiment Overmind processes found in ${config.procfile}`);
  }
  const socketPath = path.join(config.projectDir, '.overmind.sock');
  const stop = await exec('overmind', ['stop', '--socket', socketPath, ...names], {
    cwd: config.projectDir,
  });
  if (stop.code !== 0) throw new Error('Failed to stop experiment Overmind processes');
  const restart = await exec('overmind', ['restart', '--socket', socketPath, ...names], {
    cwd: config.projectDir,
  });
  if (restart.code !== 0) throw new Error('Failed to restart experiment Overmind processes');
}

export interface ExperimentReadinessOptions {
  probe?: (port: number) => Promise<HttpProbeResult>;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  settleMs?: number;
  maxAttempts?: number;
}

export async function waitForExperimentReady(
  config: ResolvedConfig,
  options: ExperimentReadinessOptions = {},
): Promise<void> {
  const probe = options.probe ?? probeHttpEndpoint;
  const wait = options.sleep ?? sleep;
  const pollMs = options.pollMs ?? 1000;
  const settleMs = options.settleMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 60;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ready = await probe(config.ports.experiment);
    if (ready.ready) {
      await wait(settleMs);
      const settled = await probe(config.ports.experiment);
      if (settled.ready) return;
    }
    if (attempt < maxAttempts - 1) await wait(pollMs);
  }
  throw new Error(`Experiment server on port ${config.ports.experiment} did not become ready`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
