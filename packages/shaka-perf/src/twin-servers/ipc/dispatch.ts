/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import { runCmd } from '../commands/run-cmd';
import { runCmdParallel } from '../commands/run-cmd-parallel';
import { MenuBusyError, type MenuController } from '../commands/servers-menu';
import { UnknownCommandError } from './protocol';
import type { ProxyDispatcher } from './server';

/**
 * Build a dispatcher that maps proxied requests onto either the menu
 * controller (lifecycle ops) or raw container-exec helpers (one-shot
 * commands). The controller is looked up *lazily* on each dispatch so the
 * IPC server can be started before `runServersMenu` finishes wiring its
 * controller — until that happens, lifecycle ops surface a clear "menu not
 * ready" via the same `BUSY` channel as a contended in-flight action.
 *
 * This is the single deserialisation site for the IPC wire format (the one
 * allowed `switch (cmd)` per the review-architecture skill): every
 * branch maps a persisted name to its primitive, with no shared
 * "do-the-variant-thing" interface to factor out.
 */
export function createDispatcher(
  config: ResolvedConfig,
  getController: () => MenuController | null,
): ProxyDispatcher {
  const requireController = (): MenuController => {
    const c = getController();
    if (!c) throw new MenuBusyError('menu controller not ready');
    return c;
  };

  return async (req) => {
    switch (req.cmd) {
      case 'build':
        // The interactive menu's rebuild always restarts overmind too — so a
        // proxied `build` lands the agent in the same post-build state a
        // human would get from picking "Rebuild" in the menu. `noCache` is
        // threaded through so `shaka-perf servers build --no-cache` against
        // a live menu actually does pass `--no-cache` to `docker build`.
        await requireController().rebuildAndRestart(req.target ?? 'auto', { noCache: req.noCache });
        return;
      case 'start-containers':
        // `startContainers()` already wipes volumes + reseeds; pairing it
        // with an overmind restart leaves the session coherent. Side effect
        // worth noting in the SKILL.md: in-container runtime state is gone.
        await requireController().restartContainersAndServers();
        return;
      case 'stop-containers':
        // Stopping containers under a live menu makes the menu's overmind
        // pointless — wire it to the menu's own stop+exit path so the
        // session ends cleanly and the next proxied call falls back to
        // local execution.
        await requireController().stopContainersAndExit();
        return;
      case 'start-servers':
        // Proxied start-servers means "restart overmind in the live session"
        // — running a second overmind locally while the menu has its own
        // would dual-spawn and fight over the container's TCP port.
        await requireController().restartServers();
        return;
      case 'run-cmd':
        // run-cmd is just a `docker exec`, but routing it through the
        // controller's lock means a `run-cmd` queued behind an in-flight
        // `build` waits politely for the build to finish — instead of
        // exec'ing into a container that's mid-tear-down. The client
        // freezes through the wait.
        await requireController().runOneOff(
          `run-cmd ${req.target}`,
          () => runCmd(config, req.target, req.shellCommand),
        );
        return;
      case 'run-cmd-parallel':
        await requireController().runOneOff(
          'run-cmd-parallel',
          () => runCmdParallel(config, req.shellCommand),
        );
        return;
      case 'sync-changes':
        // The menu installs an fs.watch on the build context that auto-syncs
        // every save into the bind-mount volume. A proxied sync would race
        // that watcher (sometimes copying an already-copied file, sometimes
        // observing a half-written file). Surface as a typed error so the
        // agent learns to drop sync-changes from its toolbox when a menu is
        // up.
        throw new Error(
          'sync-changes is unnecessary while `shaka-perf servers` is running — ' +
            'the menu auto-syncs the build context on every save. ' +
            'Just edit your files; the watcher mirrors them into the volume.',
        );
      case 'bisect-begin':
        await requireController().beginBisectSession(req.sessionId, req.ownerPid);
        return;
      case 'bisect-refresh':
        return requireController().reloadBisectExperiment({
          sessionId: req.sessionId,
          mode: req.mode,
          rebuildCommands: req.rebuildCommands,
          noCache: req.noCache,
        });
      case 'bisect-end':
        await requireController().endBisectSession(req.sessionId);
        return;
      default: {
        // Exhaustive check: a newer client at the same PROTOCOL_VERSION
        // could send a `cmd` this server doesn't know. Without this branch
        // the switch falls through, dispatch returns undefined, and the
        // server replies `exit 0`. Throw a typed `UnknownCommandError` so
        // server.ts maps it to `EXIT_NEVER_DISPATCHED` (2) — the client
        // then falls back to local execution rather than hard-failing.
        const _exhaustive: never = req;
        throw new UnknownCommandError((req as { cmd: string }).cmd);
      }
    }
  };
}
