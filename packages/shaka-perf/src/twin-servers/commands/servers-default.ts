/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import type { ResolvedConfig } from '../types';
import { decideRebuild } from '../helpers/rebuild-check';
import { containersRunning } from '../helpers/docker';
import { printBanner } from '../helpers/ui';
import { build } from './build';
import { startContainers } from './start-containers';
import { stopContainers } from './stop-containers';
import { runServersMenu, type MenuController } from './servers-menu';
import { startProxyServer, type ProxyServer } from '../ipc/server';
import { createDispatcher } from '../ipc/dispatch';
import { endpointPaths } from '../ipc/paths';

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
  printBanner('Twin Servers');

  const decision = await decideRebuild(config);

  if (decision.needs) {
    console.log(`Rebuild needed: ${decision.reason}`);
    console.log('');
    await stopContainers(config, options);
    await build(config, { ...options, target: decision.target });
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
