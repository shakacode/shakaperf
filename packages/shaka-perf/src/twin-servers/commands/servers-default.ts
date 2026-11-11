/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import type { ResolvedConfig } from '../types';
import { decideRebuild } from '../helpers/rebuild-check';
import { containersRunning, dockerImageExists } from '../helpers/docker';
import { printBanner } from '../helpers/ui';
import { build, ensureControlCheckout } from './build';
import { startContainers } from './start-containers';
import { cancelProjectBuildxOperations, stopProjectBuildxBuilderSafely } from '../helpers/buildx-lifecycle';
import { stopContainers } from './stop-containers';
import { runServersMenu, type MenuController } from './servers-menu';
import { startProxyServer, type ProxyServer } from '../ipc/server';
import { createDispatcher } from '../ipc/dispatch';
import { endpointPaths } from '../ipc/paths';
import { assertBuildDirectory } from '../helpers/project-paths';

export interface ServersOptions {
  verbose?: boolean;
}

/**
 * Entry point for `shaka-perf servers` (no subcommand). Auto-build if
 * `decideRebuild` says we need to, start containers if they aren't, then
 * start the IPC proxy alongside the interactive menu. Subcommands launched
 * from other terminals discover this server via the manifest and proxy in.
 */
export async function serversDefault(config: ResolvedConfig, options: ServersOptions = {}): Promise<void> {
  let stopServers = async (): Promise<void> => {};
  const onSignal = async (signal: NodeJS.Signals): Promise<void> => {
    cancelProjectBuildxOperations(config);
    await stopServers();
    await stopProjectBuildxBuilderSafely(config);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const onInt = () => { void onSignal('SIGINT'); };
  const onTerm = () => { void onSignal('SIGTERM'); };
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    await runServersSession(config, options, stop => { stopServers = stop; });
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    await stopProjectBuildxBuilderSafely(config);
  }
}

async function runServersSession(
  config: ResolvedConfig,
  options: ServersOptions,
  onShutdownReady: (stop: () => Promise<void>) => void,
): Promise<void> {
  printBanner('Twin Servers');

  assertBuildDirectory(config, 'experiment');
  const missingControl = !fs.existsSync(config.controlDir);
  const clonedControl = missingControl
    ? await ensureControlCheckout(config, dockerImageExists(config.images.control))
    : false;
  const reuseControl = missingControl && !clonedControl;
  if (!reuseControl) assertBuildDirectory(config, 'control');

  let decision = await decideRebuild(config);
  if (reuseControl && decision.needs && decision.target !== 'experiment') {
    decision = decision.target === 'control'
      ? { needs: false, reason: 'Using the existing control image without its checkout, as confirmed.' }
      : { ...decision, target: 'experiment' };
  }
  if (clonedControl) {
    // A restored checkout must replace the previous image even if mtimes happen
    // to be older. Preserve an experiment rebuild when it is also needed.
    const rebuildBoth = decision.needs && decision.target !== 'control';
    decision = {
      needs: true,
      target: rebuildBoth ? undefined : 'control',
      reason: `control checkout cloned; ${decision.reason}`,
    };
  }

  if (decision.needs) {
    console.log(`Rebuild needed: ${decision.reason}`);
    console.log('');
    await stopContainers(config, { ...options, keepBuilderRunning: true });
    await build(config, { ...options, target: decision.target, keepBuilderRunning: true });
    await startContainers(config, options);
  } else {
    console.log(decision.reason);
    console.log('');
    if (await containersRunning(config)) {
      console.log('Containers already running.');
    } else {
      console.log('Containers not running — starting...');
      await startContainers(config, options);
    }
  }

  // The IPC dispatcher needs the menu's controller, but the controller only
  // exists once `runServersMenu` has set up its state — so hand the
  // dispatcher a *getter* that closes over a `let`-binding the menu fills
  // in via its `onControllerReady` hook. Until that fires, lifecycle
  // requests come back as BUSY (EX_TEMPFAIL on the client).
  let controller: MenuController | null = null;
  const proxy = await startProxyOrWarn(config, () => controller);

  // The menu calls `process.exit(130)` on Ctrl+C — its finally blocks won't
  // run, so register an `exit` listener that synchronously unlinks the
  // manifest + socket. Leaving them behind would make the next session's
  // discovery probe try (and fail) to connect to a dead server.
  const paths = endpointPaths(config.projectSlug);
  const syncCleanup = (): void => {
    try { fs.unlinkSync(paths.manifest); } catch {}
    try { fs.unlinkSync(paths.socket); } catch {}
  };
  if (proxy) process.on('exit', syncCleanup);

  try {
    await runServersMenu(config, {
      ...options,
      onShutdownReady,
      onControllerReady: (c) => { controller = c; },
    });
  } finally {
    if (proxy) {
      process.off('exit', syncCleanup);
      await proxy.close();
    }
  }
}

/**
 * Try to start the IPC proxy; on failure (port-in-use-equivalent, permission
 * error, …) warn and continue without it. The menu's value isn't gated on
 * the proxy — the proxy is a power-up for parallel subcommand callers — so a
 * proxy-start failure must not block the human from getting to the menu.
 */
async function startProxyOrWarn(
  config: ResolvedConfig,
  getController: () => MenuController | null,
): Promise<ProxyServer | null> {
  try {
    return await startProxyServer({
      config,
      dispatch: createDispatcher(config, getController),
    });
  } catch (err) {
    console.warn(`(proxy IPC server not started: ${(err as Error).message} — subcommands will run locally)`);
    return null;
  }
}
