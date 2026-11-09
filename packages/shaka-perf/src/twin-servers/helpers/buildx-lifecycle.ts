/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import { withFileLock } from '../../native/file-lock';
import { endpointPaths } from '../ipc/paths';
import type { ResolvedConfig } from '../types';
import { stopProjectBuildxBuilder } from './docker';

const operations = new Map<string, Set<AbortController>>();

/** Serialize this project's builds, prunes, and stops across CLI processes. */
function withProjectBuildxLock<T>(config: ResolvedConfig, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const filename = path.join(endpointPaths(config.projectSlug).dir, 'buildx.flock');
  return withFileLock(filename, run, {
    signal,
    onWait: () => console.log("Waiting for this project's active Buildx operation to finish..."),
  });
}

async function stopBuilderSafely(config: ResolvedConfig): Promise<void> {
  try {
    await stopProjectBuildxBuilder(config);
  } catch (error) {
    console.warn(`Warning: could not stop project Buildx builder: ${(error as Error).message}`);
  }
}

/** Cleanup is best effort, but never runs across a ShakaPerf build's lock. */
export async function stopProjectBuildxBuilderSafely(config: ResolvedConfig): Promise<void> {
  try {
    await withProjectBuildxLock(config, () => stopBuilderSafely(config));
  } catch (error) {
    console.warn(`Warning: could not clean up project Buildx builder: ${(error as Error).message}`);
  }
}

/** Cancel this process's build children before a raw-mode menu exit waits for cleanup. */
export function cancelProjectBuildxOperations(config: ResolvedConfig): void {
  for (const controller of operations.get(config.projectSlug) ?? []) controller.abort();
}

/** Hold builder ownership until the operation and any automatic cleanup finish. */
export async function withProjectBuildxOperation<T>(
  config: ResolvedConfig,
  shouldStop: (interrupted: boolean) => boolean,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const current = operations.get(config.projectSlug) ?? new Set<AbortController>();
  current.add(controller);
  operations.set(config.projectSlug, current);
  let interrupted: NodeJS.Signals | undefined;
  const onInt = () => { interrupted = 'SIGINT'; controller.abort(); };
  const onTerm = () => { interrupted = 'SIGTERM'; controller.abort(); };
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    return await withProjectBuildxLock(config, async () => {
      try {
        return await run(controller.signal);
      } finally {
        if (shouldStop(controller.signal.aborted)) await stopBuilderSafely(config);
      }
    }, controller.signal);
  } finally {
    current.delete(controller);
    if (current.size === 0) operations.delete(config.projectSlug);
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    // The CLI or session owner exits after all server teardown has completed.
    if (interrupted) process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  }
}
