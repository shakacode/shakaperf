/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import type * as Ink from 'ink';
import type { ResolvedConfig } from '../types';
import { spawnOvermind, startServers, cleanupContainerPids, type OvermindHandle } from './start-servers';
import { build, type BuildTarget } from './build';
import { startContainers } from './start-containers';
import { stopContainers } from './stop-containers';
import { runCmd } from './run-cmd';
import {
  loadDockerignore,
  decideRebuild,
  readBuildManifest,
  ignoreFromManifest,
  type RebuildDecision,
} from '../helpers/rebuild-check';
import {
  checkoutBranch,
  findMergeBaseAgainstDefault,
  getCheckoutInfo,
  type CheckoutInfo,
} from '../helpers/checkout';
import { listRemoteBranches, relativeAge } from '../helpers/branches';
import { commandExists, confirm, exec } from '../helpers/shell';
import {
  initialServerStatus,
  probeServerStatus,
  serversReady,
  type ServerEndpointStatus,
  type ServerStatusSnapshot,
} from '../helpers/server-ready';
import { createServerStatusStabilizer } from '../helpers/server-status-stability';
import {
  createServerLogStore,
  formatServerLogSuffix,
  writeLogTailToConsole,
  type ServerLogStatus,
} from '../helpers/server-log';
import { dockerBuildDirForSide, dockerfileAbsForSide } from '../helpers/project-paths';
import { BisectSessionController, type BisectExperimentReloadResult } from './bisect-session';
import {
  experimentRebuildMenuDefinition,
  rebuildExperimentInContainer,
} from './rebuild-experiment';

export interface ServersMenuOptions {
  verbose?: boolean;
  /**
   * Receives a `MenuController` once `runServersMenu` has set up its state.
   * Used by the IPC proxy to drive the same lifecycle operations the
   * interactive menu does — calling the raw `build()` / `startContainers()`
   * underneath a live menu would race the menu's own overmind/container
   * bookkeeping.
   */
  onControllerReady?: (controller: MenuController) => void;
}

/**
 * Subset of the menu's lifecycle operations exposed to outside callers (the
 * IPC proxy). Each method serialises against the menu's own busy state: if a
 * menu item is already running, the call rejects with `MenuBusyError`
 * instead of stomping on the in-flight action.
 *
 * The IPC layer uses these instead of the raw command functions so that a
 * proxied `build` ends with a server-restart, a proxied `start-containers`
 * resets the running containers (and their in-memory state), etc. — i.e. the
 * agent gets the same coherent "everything is consistent now" outcome a
 * human gets from the menu's items.
 */
export interface MenuController {
  /** Stop overmind → stop containers → build target(s) → start containers → start overmind. */
  rebuildAndRestart(target: BuildTarget | 'auto' | 'all', opts?: { noCache?: boolean }): Promise<void>;
  /** Stop overmind → stop containers → start containers → start overmind. Resets in-container state. */
  restartContainersAndServers(): Promise<void>;
  /** Stop overmind → start fresh overmind. Containers untouched. */
  restartServers(): Promise<void>;
  /** Stop overmind → stop containers → exit the menu loop. The session is over after this. */
  stopContainersAndExit(): Promise<void>;
  /**
   * Run an arbitrary action serialised against the menu's session lock —
   * used by IPC subcommands like `run-cmd` that have no dedicated lifecycle
   * op but still must not race menu-driven container ops. Returns whatever
   * the runner returns.
   *
   * Terminal menu states (`stopping` / not yet `menuReady`) surface as
   * `MenuBusyError`, which the IPC server translates to a `EX_TEMPFAIL`
   * (75) exit on the client side.
   */
  runOneOff<T>(verb: string, runner: () => Promise<T>): Promise<T>;
  /** Pause auto-sync and reject unrelated lifecycle actions while compare bisect owns the session. */
  beginBisectSession(sessionId: string, ownerPid: number): Promise<void>;
  /** Reload the experiment side for the currently active compare bisect session. */
  reloadBisectExperiment(request: {
    sessionId: string;
    mode: 'commands' | 'container';
    rebuildCommands: string[];
    noCache: boolean;
  }): Promise<BisectExperimentReloadResult>;
  /** End the compare bisect session and allow normal menu auto-sync/actions again. */
  endBisectSession(sessionId: string): Promise<void>;
}

export class MenuBusyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MenuBusyError';
  }
}

// Ink v6 is ESM-only and shaka-perf is built as CJS. The Function constructor
// keeps tsc from rewriting `await import('ink')` into `require('ink')`, which
// would throw at runtime for an ESM-only package.
const importInk: () => Promise<typeof Ink> =
  new Function('return import("ink")') as () => Promise<typeof Ink>;

interface ActivityStatus {
  /** Verb phrase: "running twin-servers", "rebuilding experiment", … */
  verb: string;
  color: 'green' | 'cyan' | 'yellow' | 'red' | 'gray';
}

const IDLE_ACTIVITY: ActivityStatus = { verb: 'running twin-servers', color: 'green' };
const STARTING_ACTIVITY: ActivityStatus = { verb: 'starting up', color: 'yellow' };
const SERVER_STATUS_POLL_MS = 3000;

interface CheckoutSnapshot {
  control: CheckoutInfo | null;
  experiment: CheckoutInfo | null;
}

interface MenuState {
  logLines: string[];
  serverLog: ServerLogStatus;
  decision: RebuildDecision;
  checkouts: CheckoutSnapshot;
  activity: ActivityStatus;
  selectedIndex: number;
  busy: boolean;
  menuReady: boolean;
  serversReady: boolean;
  serverStatus: ServerStatusSnapshot;
  picker: BranchPickerState | null;
  autoSyncCount: number;
  lastMessage: string | null;
  bisectSession: BisectSessionController;
}

interface BranchPickerItem {
  label: string;
  value: string;
  meta?: string;
  group?: string;
}

interface BranchPickerOptions {
  title: string;
  items: BranchPickerItem[];
  hint: string;
  allowCustomText: boolean;
  windowSize: number;
}

type BranchPickerResult =
  | { kind: 'item'; value: string }
  | { kind: 'custom'; text: string }
  | null;

interface BranchPickerState extends BranchPickerOptions {
  selectedIndex: number;
  typed: string;
  resolve: (result: BranchPickerResult) => void;
}

/** Tag used to pick a renderer for a menu row (TUI dispatch). */
type Renderer = 'simple' | 'rebuild' | 'checkout';

interface MenuItem {
  /** Stable id used to preserve cursor identity across status changes. */
  id: string;
  /** Numeric quick-jump shortcut shown as `[N]`. */
  numericKey?: string;
  /** Static or status-dependent label. */
  label: string | ((s: MenuState) => string);
  /** Hide unless this returns true (e.g. rebuild only shows when needed). */
  visible?: (s: MenuState) => boolean;
  /** Renderer tag — defaults to 'simple'. */
  renderer?: Renderer;
  /** Activity verb + color shown in the status line while running. */
  activity?: { verb: string | ((s: MenuState) => string); color: ActivityStatus['color'] };
  /** Run the item. */
  run(): Promise<void>;
}

/**
 * Interactive sticky menu for `shaka-perf servers`. Rendered with Ink:
 * overmind's stdio is captured into one colored log file while the menu
 * stays sticky at the bottom. Falls back to plain `startServers` on non-TTY
 * stdio (CI, piped output).
 */
export async function runServersMenu(
  config: ResolvedConfig,
  options: ServersMenuOptions = {},
): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    await startServers(config, options);
    return;
  }

  const ink = await importInk();
  const serverLogs = createServerLogStore(config);

  // State lives in this closure, not inside React, so it survives the
  // unmount/remount cycle the branch picker triggers.
  const state: MenuState = {
    logLines: [],
    serverLog: { path: serverLogs.path, errorCount: 0 },
    decision: { needs: false, reason: 'checking…' },
    checkouts: { control: null, experiment: null },
    activity: STARTING_ACTIVITY,
    selectedIndex: 0,
    busy: false,
    menuReady: false,
    serversReady: false,
    serverStatus: initialServerStatus(config),
    picker: null,
    autoSyncCount: 0,
    lastMessage: null,
    bisectSession: new BisectSessionController(config),
  };

  let stopping = false;
  let inkInstance: ReturnType<typeof ink.render> | null = null;

  const view = (): React.ReactElement =>
    React.createElement(AppShell, { state, items, onKey: dispatchKey, ink });
  const mount = (): void => { inkInstance = ink.render(view()); };
  const repaint = (): void => { if (inkInstance) inkInstance.rerender(view()); };
  const unmount = async (): Promise<void> => {
    const inst = inkInstance;
    if (!inst) return;
    inkInstance = null;
    inst.unmount();
    try { await inst.waitUntilExit(); } catch { /* best effort */ }
  };

  let lastInteractionErrorCount = 0;
  const syncDisplayedErrorCount = (): void => {
    state.serverLog.errorCount = Math.max(0, serverLogs.errorCount - lastInteractionErrorCount);
  };
  const appendLog = (chunk: string): void => {
    const completedLines = serverLogs.append(chunk);
    const previousErrorCount = state.serverLog.errorCount;
    syncDisplayedErrorCount();
    if (inkInstance && (completedLines.length > 0 || state.serverLog.errorCount !== previousErrorCount)) {
      repaint();
    }
  };

  const statusStabilizer = createServerStatusStabilizer();
  // Sweep stale PIDs from any session that died without running stop() before
  // the first spawn. Intra-menu restarts go through stopOvermind()/container
  // recreation, which already clean up, so only this cold start needs it.
  await cleanupContainerPids(config);
  let overmind: OvermindHandle = spawnOvermindWithLog(config, appendLog);
  const stopOvermind = async (): Promise<void> => { await overmind.stop(); };
  const startOvermindFresh = (activity: ActivityStatus = STARTING_ACTIVITY): void => {
    state.serversReady = false;
    state.serverStatus = initialServerStatus(config);
    statusStabilizer.reset();
    state.activity = activity;
    overmind = spawnOvermindWithLog(config, appendLog);
    repaint();
  };

  const setServerStatus = (status: ServerStatusSnapshot): void => {
    state.serverStatus = status;
    repaint();
  };

  const setPolledServerStatus = (status: ServerStatusSnapshot): void => {
    const stableStatus = statusStabilizer.stabilize(state.serverStatus, status);
    setServerStatus(stableStatus);
  };

  let statusPollInFlight = false;
  const pollServerStatus = async (): Promise<void> => {
    if (statusPollInFlight || state.busy || stopping) return;
    statusPollInFlight = true;
    try {
      setPolledServerStatus(await probeServerStatus(config));
    } finally {
      statusPollInFlight = false;
    }
  };
  let statusTimer: NodeJS.Timeout | null = null;

  // Dedupe rebuild-check failure logs across repeated watcher-triggered
  // refreshes so the same error doesn't flood the log on every save.
  let lastDecideError: string | null = null;
  const refreshDecision = async (): Promise<void> => {
    try {
      state.decision = await decideRebuild(config);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== lastDecideError) {
        lastDecideError = msg;
        state.logLines = state.logLines.concat(`[rebuild-check] ${msg}`);
      }
      state.decision = { needs: false, reason: `unavailable: ${msg}` };
    }
    state.checkouts = {
      control: getCheckoutInfo(config.controlDir),
      experiment: getCheckoutInfo(config.experimentDir),
    };
  };

  const withCookedTerminal = async <T,>(fn: () => Promise<T>): Promise<T> => {
    await unmount();
    process.stdout.write('\n');
    try {
      return await fn();
    } finally {
      // Drop accumulated log so the menu starts with a clean static area
      // after the cooked-mode child returns.
      state.logLines = [];
      // Force the cursor onto a fresh line and yield a tick so any in-flight
      // stdin/raw-mode events from the cooked-mode child drain before the
      // new Ink instance grabs stdin. Without this, exiting bash via Ctrl+D
      // sometimes left the menu paint next to the prompt or skipped the
      // first frame entirely until the next keystroke.
      process.stdout.write('\n');
      await new Promise<void>((resolve) => setImmediate(resolve));
      mount();
    }
  };

  const replayRecentServerLogs = async (title: string, remount = true): Promise<void> => {
    await unmount();
    process.stdout.write(`\n${title}\n`);
    process.stdout.write(`Server logs: ${serverLogs.path}\n\n`);
    writeLogTailToConsole(serverLogs, 100);
    process.stdout.write('\n');
    if (remount) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      mount();
    }
  };

  const runLogViewer = async (): Promise<void> => {
    if (!commandExists('less')) {
      state.lastMessage = `less is not installed. Server logs: ${serverLogs.path}`;
      repaint();
      return;
    }
    await unmount();
    try {
      await exec('less', ['-R', '+G', serverLogs.path], { env: process.env });
    } finally {
      process.stdout.write('\n');
      await new Promise<void>((resolve) => setImmediate(resolve));
      mount();
    }
  };

  const selectBranchInMenu = (opts: BranchPickerOptions): Promise<BranchPickerResult> =>
    new Promise((resolve) => {
      state.picker = {
        ...opts,
        selectedIndex: opts.items.length > 0 ? 0 : -1,
        typed: '',
        resolve,
      };
      repaint();
    });

  // ---------- Item handlers ----------

  const waitForCurrentOvermindStartup = async (waitOptions: WaitForServersOptions = {}): Promise<void> => {
    const ready = await waitForServersOrExit(config, overmind.done, setServerStatus, waitOptions);
    if (!ready) {
      state.menuReady = true;
      state.serversReady = false;
      state.activity = { verb: 'failed to start', color: 'red' };
      repaint();
      await replayRecentServerLogs('Servers failed to start. Last 100 server log lines:');
      throw new Error('Servers failed to start — overmind exited before both URLs responded. See log above.');
    }
    state.menuReady = true;
    state.serversReady = true;
    statusStabilizer.reset();
    state.activity = IDLE_ACTIVITY;
    repaint();
  };

  const runRebuild = async (target: BuildTarget | 'auto' | 'all', opts: { noCache?: boolean } = {}): Promise<void> => {
    await stopOvermind();
    let runError: unknown = null;
    try {
      const targets = resolveTargets(target, state.decision);
      if (targets.length === 0) {
        state.lastMessage = 'Up to date — nothing to rebuild.';
        return;
      }
      await stopContainers(config, options);
      for (const t of targets) await build(config, { ...options, target: t, noCache: opts.noCache });
      await startContainers(config, options);
      state.autoSyncCount = 0;
      await refreshDecision();
      state.lastMessage = `Rebuilt: ${targets.join(', ')}`;
    } catch (err) {
      runError = err;
      throw err;
    } finally {
      startOvermindFresh();
      try {
        await waitForCurrentOvermindStartup();
      } catch (startErr) {
        if (!runError) throw startErr;
        state.logLines = state.logLines.concat(`[restart-after-rebuild] ${(startErr as Error).message}`);
      }
    }
  };

  /**
   * Stop overmind, recreate both containers (state reset — see
   * `startContainers()`), then bring overmind back up. Shared by the
   * "Restart containers" menu item and the IPC `start-containers` proxy so
   * both paths produce the same coherent post-restart state.
   */
  const runRestartContainersAndServers = async (): Promise<void> => {
    await stopOvermind();
    await stopContainers(config, options);
    await startContainers(config, options);
    state.autoSyncCount = 0;
    await refreshDecision();
    startOvermindFresh();
    await waitForCurrentOvermindStartup();
    state.lastMessage = 'Containers + servers restarted.';
  };

  const runRestartServers = async (): Promise<void> => {
    state.serversReady = false;
    state.activity = { verb: 'stopping servers', color: 'yellow' };
    repaint();
    await stopOvermind();
    const stopped = await waitForServersDown(config, setServerStatus);
    if (!stopped) {
      state.logLines = state.logLines.concat(
        '[restart] old URLs still responded after cleanup; starting fresh Overmind and verifying it stays up',
      );
    }
    startOvermindFresh({ verb: 'restarting servers', color: 'yellow' });
    await waitForCurrentOvermindStartup({ readySettleMs: stopped ? 1000 : 5000 });
    state.lastMessage = 'Servers restarted.';
  };

  const runStopContainersAndExit = async (): Promise<void> => {
    stopping = true;
    await stopOvermind();
    await stopContainers(config, options);
  };

  const runCheckout = async (target: 'control' | 'experiment'): Promise<void> => {
    state.lastMessage = `Fetching branches for ${target}...`;
    repaint();

    const ref = await pickBranch(target, config, selectBranchInMenu);
    if (!ref) {
      state.lastMessage = 'Checkout cancelled.';
      return;
    }

    await withCookedTerminal(async () => {
      const dir = target === 'control' ? config.controlDir : config.experimentDir;
      const result = await checkoutBranch(dir, ref, { verbose: true });
      state.lastMessage = result.ok
        ? `${target}: ${result.message}`
        : `${target} checkout failed: ${result.message}`;

      // After a successful experiment checkout, offer to align control with
      // the new fork point — that's the canonical "before" baseline for an
      // experiment's diff.
      if (target === 'experiment' && result.ok) {
        const mb = findMergeBaseAgainstDefault(config.experimentDir);
        if (mb) {
          const yes = await confirm(
            `Update control to merge base of experiment with ${mb.defaultBranch} (${mb.shortSha})?`,
          );
          if (yes) {
            const controlResult = await checkoutBranch(config.controlDir, mb.sha, { verbose: true });
            state.lastMessage += controlResult.ok
              ? ` · control: ${controlResult.message}`
              : ` · control update failed: ${controlResult.message}`;
          }
        }
      }
    });
    await refreshDecision();
  };

  const runBash = async (target: 'control' | 'experiment'): Promise<void> => {
    await withCookedTerminal(() => runCmd(config, target, 'bash'));
  };

  // ---------- Menu definition ----------

  const experimentRebuildDefinition = experimentRebuildMenuDefinition(config);
  const experimentRebuildItem: MenuItem | null = experimentRebuildDefinition
    ? {
        ...experimentRebuildDefinition,
        activity: { verb: 'rebuilding experiment in container', color: 'yellow' },
        run: async () => {
          await rebuildExperimentInContainer(config);
          state.lastMessage = 'Experiment rebuilt in container.';
        },
      }
    : null;

  const items: MenuItem[] = [
    {
      id: 'experiment-checkout',
      label: (s) => formatCheckoutLabel('experiment', s.checkouts.experiment),
      renderer: 'checkout',
      activity: { verb: 'checking out experiment', color: 'cyan' },
      run: () => runCheckout('experiment'),
    },
    {
      id: 'control-checkout',
      label: (s) => formatCheckoutLabel('control', s.checkouts.control),
      renderer: 'checkout',
      activity: { verb: 'checking out control', color: 'cyan' },
      run: () => runCheckout('control'),
    },
    {
      id: 'rebuild',
      numericKey: '1',
      visible: (s) => s.decision.needs,
      renderer: 'rebuild',
      label: (s) => {
        if (!s.decision.needs) return 'Rebuild what changed';
        const t = s.decision.target;
        if (t === 'experiment') return 'Rebuild experiment';
        if (t === 'control') return 'Rebuild control';
        return 'Rebuild both';
      },
      activity: { verb: (s) => `rebuilding ${(s.decision.needs && s.decision.target) || 'both'}`, color: 'yellow' },
      run: () => runRebuild('auto'),
    },
    {
      id: 'bash-experiment',
      numericKey: '2',
      label: 'Bash in experiment',
      activity: { verb: 'bash in experiment', color: 'cyan' },
      run: () => runBash('experiment'),
    },
    {
      id: 'bash-control',
      numericKey: '3',
      label: 'Bash in control',
      activity: { verb: 'bash in control', color: 'cyan' },
      run: () => runBash('control'),
    },
    {
      id: 'full-rebuild',
      numericKey: '4',
      label: 'Full rebuild (both images)',
      activity: { verb: 'rebuilding both images', color: 'yellow' },
      run: () => runRebuild('all'),
    },
    {
      id: 'view-logs',
      numericKey: '5',
      label: (s) => `View logs (${s.serverLog.path})${formatServerLogSuffix(s.serverLog.errorCount)}`,
      activity: { verb: 'viewing logs', color: 'cyan' },
      run: () => runLogViewer(),
    },
    {
      id: 'restart',
      numericKey: '6',
      label: 'Restart servers',
      activity: { verb: 'restarting servers', color: 'yellow' },
      run: runRestartServers,
    },
    {
      id: 'restart-containers',
      numericKey: '7',
      label: 'Restart containers (resets state)',
      activity: { verb: 'restarting containers + servers', color: 'yellow' },
      run: runRestartContainersAndServers,
    },
    {
      id: 'stop',
      numericKey: '8',
      label: 'Stop containers and exit',
      activity: { verb: 'stopping', color: 'gray' },
      run: runStopContainersAndExit,
    },
    ...(experimentRebuildItem ? [experimentRebuildItem] : []),
  ];

  // ---------- IPC-driven controller surface ----------

  /**
   * Session-wide async mutex. Both menu items (`runItem`) and proxied IPC
   * actions (`runProxiedAction` / `runOneOff`) acquire it before mutating
   * twin-servers state — so a menu rebuild and an IPC `run-cmd` can never
   * race over container lifecycle.
   *
   * Why a queue and not a fast-fail? Roman's UX requirement is that proxied
   * commands FREEZE the client until the action is done, never bounce with
   * EX_TEMPFAIL. The queue delivers that: if the menu is mid-rebuild when
   * an IPC `run-cmd` arrives, the client's stderr prints the proxy notice
   * and then just hangs there until the menu finishes — exactly like
   * waiting on `make` for a long target. Deadlock-safe because every menu
   * action and every proxied action is bounded (overmind timeouts,
   * `docker` returns, …) and only ever takes one lock.
   */
  let lockChain: Promise<void> = Promise.resolve();
  const acquireLock = async (): Promise<() => void> => {
    const prev = lockChain;
    let release!: () => void;
    lockChain = new Promise<void>((r) => { release = r; });
    await prev;
    return release;
  };

  /**
   * Wrap an action so any subprocess it spawns (and any container it shells
   * into via `dockerComposeExec`) sees `SHAKAPERF_NO_PROXY=1` and bails out
   * of the IPC proxy. Without this gate, a setup command that shells out to
   * `shaka-perf` (Rails generators, yarn scripts, etc.) would dial back
   * into THIS process and deadlock on the session lock the parent action is
   * still holding.
   *
   * Scoped per-action rather than per-session so the menu's idle window
   * doesn't carry the flag (tests run client and server in one process —
   * setting it for the whole session would make them all bail).
   */
  const withInsideServerEnv = async <T>(runner: () => Promise<T>): Promise<T> => {
    const previous = process.env.SHAKAPERF_NO_PROXY;
    process.env.SHAKAPERF_NO_PROXY = '1';
    try {
      return await runner();
    } finally {
      if (previous === undefined) delete process.env.SHAKAPERF_NO_PROXY;
      else process.env.SHAKAPERF_NO_PROXY = previous;
    }
  };

  /**
   * Mirrors `runItem`'s state-flag accounting (busy + activity +
   * lastMessage repaint), but for proxied work. The acquire is what makes
   * the IPC client "freeze" while another action holds the slot — no
   * MenuBusyError on contention; that error is reserved for terminal
   * states (`stopping`, not yet `menuReady`).
   */
  const runProxiedAction = async <T>(
    verb: string,
    runner: () => Promise<T>,
    actionOptions: { allowDuringBisect?: boolean } = {},
  ): Promise<T> => {
    if (!state.menuReady) throw new MenuBusyError('menu is still starting up');
    if (stopping) throw new MenuBusyError('menu is shutting down');
    if (state.bisectSession.activeSessionId !== null && !actionOptions.allowDuringBisect) {
      throw new MenuBusyError('compare bisect session is active');
    }
    const release = await acquireLock();
    // Recheck after the wait: the menu may have transitioned to a terminal
    // state while we were queued. Don't run a half-action against a session
    // that's tearing down.
    if (stopping) {
      release();
      throw new MenuBusyError('menu is shutting down');
    }
    if (state.bisectSession.activeSessionId !== null && !actionOptions.allowDuringBisect) {
      release();
      throw new MenuBusyError('compare bisect session is active');
    }
    state.busy = true;
    const previousActivity = state.activity;
    lastInteractionErrorCount = serverLogs.errorCount;
    syncDisplayedErrorCount();
    state.activity = { verb, color: 'yellow' };
    state.lastMessage = `Running (proxied): ${verb}…`;
    repaint();
    try {
      return await withInsideServerEnv(runner);
    } finally {
      state.busy = false;
      if (state.lastMessage === `Running (proxied): ${verb}…`) state.lastMessage = null;
      if (state.serversReady) {
        state.activity = IDLE_ACTIVITY;
      } else if (state.activity.verb === verb) {
        state.activity = previousActivity;
      }
      if (state.bisectSession.activeSessionId === null) performAutoSync();
      repaint();
      release();
    }
  };

  const controller: MenuController = {
    rebuildAndRestart: (target, opts) => runProxiedAction(
      `rebuilding ${target === 'auto' ? 'auto' : target === 'all' ? 'both' : target}${opts?.noCache ? ' (--no-cache)' : ''}`,
      () => runRebuild(target, opts),
    ),
    restartContainersAndServers: () => runProxiedAction(
      'restarting containers + servers',
      runRestartContainersAndServers,
    ),
    restartServers: () => runProxiedAction('restarting servers', runRestartServers),
    stopContainersAndExit: () => runProxiedAction('stopping containers', runStopContainersAndExit),
    runOneOff: (verb, runner) => runProxiedAction(verb, runner),
    beginBisectSession: (sessionId, ownerPid) => runProxiedAction(
      'beginning compare bisect session',
      async () => {
        state.bisectSession.beginSession(sessionId, ownerPid);
        state.lastMessage = 'Compare bisect owns experiment reload; auto-sync is paused.';
      },
      { allowDuringBisect: true },
    ),
    reloadBisectExperiment: (request) => runProxiedAction(
      `reloading compare bisect experiment (${request.mode})`,
      async () => {
        const result = await state.bisectSession.reloadExperiment(request.sessionId, request);
        state.lastMessage = result.usedFallback
          ? 'Compare bisect command reload failed; rebuilt experiment container.'
          : `Compare bisect reloaded experiment using ${result.mode} mode.`;
        return result;
      },
      { allowDuringBisect: true },
    ),
    endBisectSession: (sessionId) => runProxiedAction(
      'ending compare bisect session',
      async () => {
        state.bisectSession.endSession(sessionId);
        state.lastMessage = 'Compare bisect finished; auto-sync resumed.';
      },
      { allowDuringBisect: true },
    ),
  };

  options.onControllerReady?.(controller);

  // ---------- Action dispatch ----------

  const clampSelectedIndex = (): void => {
    const visible = visibleItems(items, state);
    const max = visible.length - 1;
    if (state.selectedIndex > max) state.selectedIndex = max;
    if (state.selectedIndex < 0) state.selectedIndex = 0;
  };

  const runItem = async (item: MenuItem): Promise<void> => {
    // Fast-fail menu keypresses while the slot is taken — the user is
    // expected to look at the menu and try again. (Contrast with proxied
    // requests in `runProxiedAction`, which deliberately queue.)
    if (state.busy || stopping || !state.menuReady || state.bisectSession.activeSessionId !== null) return;
    const release = await acquireLock();
    // Recheck: the user could have pressed Ctrl+C while we were waiting
    // (in practice the lock is uncontended here because the menu
    // fast-failed competing keypresses).
    if (stopping || !state.menuReady) {
      release();
      return;
    }
    state.busy = true;
    const verb = typeof item.activity?.verb === 'function'
      ? item.activity.verb(state)
      : item.activity?.verb ?? (typeof item.label === 'function' ? item.label(state) : item.label);
    const previousActivity = state.activity;
    lastInteractionErrorCount = serverLogs.errorCount;
    syncDisplayedErrorCount();
    state.activity = { verb, color: item.activity?.color ?? 'yellow' };
    state.lastMessage = `Running: ${verb}…`;
    repaint();
    try {
      await withInsideServerEnv(() => item.run());
    } catch (err) {
      state.lastMessage = `Failed: ${verb} — ${(err as Error).message}`;
      if (!state.serversReady && state.activity.verb !== 'failed to start' && serversReady(state.serverStatus)) {
        state.serversReady = true;
        state.activity = IDLE_ACTIVITY;
      }
    } finally {
      state.busy = false;
      if (state.lastMessage === `Running: ${verb}…`) state.lastMessage = null;
      if (state.serversReady) {
        state.activity = IDLE_ACTIVITY;
      } else if (state.activity.verb === verb) {
        state.activity = previousActivity;
      }
      clampSelectedIndex();
      // Drain any auto-sync events that arrived while busy. `performAutoSync`
      // early-returns on `state.busy`, so without this kick, files changed
      // during a rebuild stay in `pendingSync` until the next save touches
      // them.
      performAutoSync();
      repaint();
      release();
    }
  };

  const dispatchKey = async (key: string): Promise<void> => {
    if (key === 'ctrl-c') {
      stopping = true;
      try { await overmind.stop(); } catch { /* best effort */ }
      await unmount();
      serverLogs.close();
      process.exit(130);
    }
    if (state.picker) {
      dispatchPickerKey(key);
      return;
    }
    if (state.busy || stopping || !state.menuReady || state.bisectSession.activeSessionId !== null) return;
    const visible = visibleItems(items, state);
    if (key === 'up') {
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      repaint();
      return;
    }
    if (key === 'down') {
      state.selectedIndex = Math.min(visible.length - 1, state.selectedIndex + 1);
      repaint();
      return;
    }
    if (key === 'enter') {
      const item = visible[state.selectedIndex];
      if (item) await runItem(item);
      return;
    }
    const item = visible.find((i) => i.numericKey === key);
    if (item) await runItem(item);
  };

  const finishPicker = (result: BranchPickerResult): void => {
    const picker = state.picker;
    if (!picker) return;
    state.picker = null;
    picker.resolve(result);
    repaint();
  };

  const dispatchPickerKey = (key: string): void => {
    const picker = state.picker;
    if (!picker) return;
    const itemCount = picker.items.length;
    if (key === 'escape') {
      finishPicker(null);
      return;
    }
    if (key === 'up') {
      if (itemCount > 0) {
        picker.selectedIndex = Math.max(0, picker.selectedIndex - 1);
        if (picker.typed === '' || /^\d+$/.test(picker.typed)) picker.typed = '';
      }
      repaint();
      return;
    }
    if (key === 'down') {
      if (itemCount > 0) {
        picker.selectedIndex = Math.min(itemCount - 1, picker.selectedIndex + 1);
        if (picker.typed === '' || /^\d+$/.test(picker.typed)) picker.typed = '';
      }
      repaint();
      return;
    }
    if (key === 'backspace') {
      if (picker.typed.length > 0) {
        picker.typed = picker.typed.slice(0, -1);
        repaint();
      }
      return;
    }
    if (key === 'enter') {
      submitPicker(picker);
      return;
    }
    if (key.length !== 1) return;
    const code = key.charCodeAt(0);
    if (code < 32 || code >= 127) return;
    picker.typed += key;
    const n = Number(picker.typed);
    if (Number.isInteger(n) && n >= 1 && n <= itemCount) {
      picker.selectedIndex = n - 1;
    }
    repaint();
  };

  const submitPicker = (picker: BranchPickerState): void => {
    const trimmed = picker.typed.trim();
    if (trimmed === '') {
      if (picker.selectedIndex >= 0 && picker.selectedIndex < picker.items.length) {
        finishPicker({ kind: 'item', value: picker.items[picker.selectedIndex].value });
      } else {
        process.stdout.write('\x07');
      }
      return;
    }
    const n = Number(trimmed);
    if (Number.isInteger(n) && n >= 1 && n <= picker.items.length) {
      finishPicker({ kind: 'item', value: picker.items[n - 1].value });
      return;
    }
    if (picker.allowCustomText) {
      finishPicker({ kind: 'custom', text: trimmed });
      return;
    }
    process.stdout.write('\x07');
  };

  // ---------- Auto-sync ----------

  const experimentBuildDir = dockerBuildDirForSide(config, 'experiment');
  const liveIgnore = loadDockerignore(experimentBuildDir, dockerfileAbsForSide(config, 'experiment'));
  const pendingSync = new Set<string>();
  let syncTimer: NodeJS.Timeout | null = null;
  const performAutoSync = (): void => {
    if (state.busy || stopping || state.bisectSession.activeSessionId !== null || pendingSync.size === 0) return;
    // Re-read per batch so a fresh rebuild's manifest is picked up immediately.
    // Without a manifest (never built, or older shaka-perf), fall back to the
    // live dockerignore and skip deletion handling — we can't safely unlink
    // anything in the volume without knowing what was supposed to be in the
    // image in the first place.
    const manifest = readBuildManifest(config.volumes.experiment);
    const ig = manifest ? ignoreFromManifest(manifest) : liveIgnore;
    const manifestSet = manifest ? new Set(manifest.files) : null;

    const batch = Array.from(pendingSync);
    pendingSync.clear();
    let copied = 0;
    let deleted = 0;
    for (const rel of batch) {
      const src = path.join(experimentBuildDir, rel);
      const dst = path.join(config.volumes.experiment, rel);
      let srcStat: fs.Stats | null = null;
      try { srcStat = fs.statSync(src); } catch { /* missing — treat as delete below */ }

      if (!srcStat) {
        // Only delete files the image actually had — without a manifest, or
        // for paths Docker never copied (node_modules, build artifacts), the
        // dst in the volume came from somewhere else and isn't ours to touch.
        const relPosix = rel.split(path.sep).join('/');
        if (!manifestSet || !manifestSet.has(relPosix)) continue;
        try {
          fs.unlinkSync(dst);
          deleted++;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            state.logLines = state.logLines.concat(`[auto-sync] ${rel} (delete): ${(err as Error).message}`);
          }
        }
        continue;
      }

      const checkPath = srcStat.isDirectory() ? `${rel}/` : rel;
      if (ig.ignores(checkPath) || !srcStat.isFile()) continue;
      try {
        let dstStat: fs.Stats | null = null;
        try { dstStat = fs.statSync(dst); } catch { /* dest may not exist */ }
        if (dstStat && dstStat.mtimeMs >= srcStat.mtimeMs && dstStat.size === srcStat.size) continue;
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copied++;
      } catch (err) {
        state.logLines = state.logLines.concat(`[auto-sync] ${rel}: ${(err as Error).message}`);
      }
    }
    if (copied > 0 || deleted > 0) {
      state.autoSyncCount += copied + deleted;
      const n = state.autoSyncCount;
      state.lastMessage = `Auto-sync: ${n} file${n === 1 ? '' : 's'} updated since last build`;
      repaint();
    }
  };
  // Guard against stacked refreshes: `refreshDecision` walks the build
  // context, which on big monorepos can take longer than the debounce window.
  // Without this, bursts of saves would queue up walks and thrash the disk.
  let refreshInFlight = false;
  const refreshFromWatcher = async (): Promise<void> => {
    performAutoSync();
    if (refreshInFlight || state.busy || stopping) return;
    refreshInFlight = true;
    try {
      const prevDecision = state.decision;
      const prevCheckouts = state.checkouts;
      // Preserve cursor identity across visible-item changes (rebuild row can
      // appear/disappear with the rebuild decision).
      const prevVisible = visibleItems(items, state);
      const prevId = prevVisible[state.selectedIndex]?.id;
      await refreshDecision();
      if (sameDecision(prevDecision, state.decision) && sameCheckouts(prevCheckouts, state.checkouts)) return;
      if (prevId) {
        const nextVisible = visibleItems(items, state);
        const i = nextVisible.findIndex((it) => it.id === prevId);
        if (i >= 0) state.selectedIndex = i;
      }
      clampSelectedIndex();
      repaint();
    } finally {
      refreshInFlight = false;
    }
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(experimentBuildDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      pendingSync.add(filename.toString());
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { void refreshFromWatcher(); }, 500);
    });
    // The recursive watcher scans subdirectories lazily; if one disappears
    // between an event firing and the scan (a build, a git operation, or a
    // test suite churning temp dirs anywhere under the build context) Node
    // emits an asynchronous 'error' event. With no listener that surfaces as
    // an unhandled error and kills the whole TUI, so swallow it — auto-sync
    // degrades for that blip rather than crashing the session.
    watcher.on('error', (err) => {
      state.logLines = state.logLines.concat(`[auto-sync] watcher error (ignored): ${(err as Error).message}`);
    });
  } catch (err) {
    state.logLines = state.logLines.concat(`[auto-sync] watcher unavailable: ${(err as Error).message}`);
  }

  await refreshDecision();
  mount();

  // Ready gating: block menu input until both server URLs return an HTTP
  // response. If overmind exits during startup, surface as failure rather than
  // landing on an idle menu with broken servers.
  const ready = await waitForServersOrExit(config, overmind.done, setServerStatus);
  if (!ready) {
    state.menuReady = true;
    state.serversReady = false;
    state.activity = { verb: 'failed to start', color: 'red' };
    repaint();
    if (stopping) {
      await unmount();
      serverLogs.close();
      return;
    }
    await replayRecentServerLogs('Servers failed to start. Last 100 server log lines:');
  } else {
    state.menuReady = true;
    state.serversReady = true;
    state.activity = IDLE_ACTIVITY;
    repaint();
  }
  statusTimer = setInterval(() => { void pollServerStatus(); }, SERVER_STATUS_POLL_MS);

  try {
    // `await overmind.done` captures one specific promise; restart/rebuild
    // actions reassign `overmind`, so loop and re-read so we don't fall
    // through to "Overmind exited" after a normal restart.
    while (!stopping) {
      const current = overmind;
      await current.done;
      if (overmind !== current) continue;
      state.menuReady = true;
      state.serversReady = false;
      state.activity = state.activity.verb === 'failed to start'
        ? state.activity
        : { verb: 'overmind exited', color: 'gray' };
      repaint();
      while (!stopping && overmind === current) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
    }
  } finally {
    if (syncTimer) clearTimeout(syncTimer);
    if (statusTimer) clearInterval(statusTimer);
    if (watcher) { try { watcher.close(); } catch { /* best effort */ } }
    await unmount();
    serverLogs.close();
  }
}

// ---------- Helpers ----------

function spawnOvermindWithLog(
  config: ResolvedConfig,
  onChunk: (chunk: string) => void,
): OvermindHandle {
  const handle = spawnOvermind(config, { stdio: 'pipe' });
  // setEncoding('utf8') lets Node's Readable hold partial multi-byte UTF-8
  // sequences across chunks rather than handing us a half-decoded Buffer
  // (which `.toString('utf8')` turns into U+FFFD replacement chars).
  handle.child.stdout?.setEncoding('utf8');
  handle.child.stderr?.setEncoding('utf8');
  handle.child.stdout?.on('data', onChunk);
  handle.child.stderr?.on('data', onChunk);
  return handle;
}

function resolveTargets(target: BuildTarget | 'auto' | 'all', decision: RebuildDecision): BuildTarget[] {
  if (target === 'control' || target === 'experiment') return [target];
  if (target === 'all') return ['experiment', 'control'];
  if (!decision.needs) return [];
  if (decision.target) return [decision.target];
  return ['experiment', 'control'];
}

function visibleItems(items: MenuItem[], state: MenuState): MenuItem[] {
  return items.filter((i) => !i.visible || i.visible(state));
}

interface WaitForServersOptions {
  timeoutMs?: number;
  pollMs?: number;
  probeTimeoutMs?: number;
  stableReadySamples?: number;
  readySettleMs?: number;
}

async function waitForServersOrExit(
  config: ResolvedConfig,
  overmindDone: Promise<void>,
  onStatus: (status: ServerStatusSnapshot) => void,
  options: WaitForServersOptions = {},
): Promise<boolean> {
  const {
    timeoutMs = 90_000,
    pollMs = 500,
    probeTimeoutMs = 3000,
    stableReadySamples = 2,
    readySettleMs = 1000,
  } = options;
  let died = false;
  let readySamples = 0;
  const deadline = Date.now() + timeoutMs;
  overmindDone.then(() => { died = true; }, () => { died = true; });
  while (!died && Date.now() < deadline) {
    const status = await probeServerStatus(config, probeTimeoutMs);
    onStatus(status);
    if (died) return false;
    if (serversReady(status)) {
      readySamples++;
      if (readySamples >= stableReadySamples) {
        await new Promise<void>((r) => setTimeout(r, readySettleMs));
        if (died) return false;
        const confirmation = await probeServerStatus(config, probeTimeoutMs);
        onStatus(confirmation);
        if (died) return false;
        if (serversReady(confirmation)) return true;
        readySamples = 0;
      }
    } else {
      readySamples = 0;
    }
    await new Promise<void>((r) => setTimeout(r, pollMs));
  }
  return false;
}

async function waitForServersDown(
  config: ResolvedConfig,
  onStatus: (status: ServerStatusSnapshot) => void,
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await probeServerStatus(config, 250);
    onStatus(status);
    if (status.control.status === 'down' && status.experiment.status === 'down') return true;
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  return false;
}

function sameDecision(a: RebuildDecision, b: RebuildDecision): boolean {
  if (a.needs !== b.needs) return false;
  if (a.reason !== b.reason) return false;
  if (a.needs && b.needs && a.target !== b.target) return false;
  return true;
}

function sameCheckouts(a: CheckoutSnapshot, b: CheckoutSnapshot): boolean {
  return sameCheckout(a.control, b.control) && sameCheckout(a.experiment, b.experiment);
}

function sameCheckout(a: CheckoutInfo | null, b: CheckoutInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.branch === b.branch && a.commit === b.commit && a.upstream === b.upstream
    && a.ahead === b.ahead && a.behind === b.behind;
}

function formatCheckoutLabel(
  target: 'control' | 'experiment',
  info: CheckoutInfo | null,
): string {
  if (!info) return `${target}: (unavailable)`;
  const upstream = info.upstream ? ` → ${info.upstream}` : '';
  if (info.upstream && info.ahead > 0 && info.behind > 0) {
    return `${target}: ${info.branch} @ ${info.commit}${upstream} (diverged ${info.ahead}↑ ${info.behind}↓)`;
  }
  if (info.behind > 0) return `${target}: ${info.branch} @ ${info.commit}${upstream} (${info.behind} behind)`;
  if (info.ahead > 0) return `${target}: ${info.branch} @ ${info.commit}${upstream} (${info.ahead} ahead)`;
  return `${target}: ${info.branch} @ ${info.commit}${upstream}`;
}

function checkoutColor(info: CheckoutInfo | null): 'gray' | 'cyan' | 'yellow' | 'red' {
  if (!info) return 'gray';
  if (info.upstream && info.ahead > 0 && info.behind > 0) return 'red';
  if (info.behind > 0) return 'yellow';
  return 'cyan';
}

async function pickBranch(
  target: 'control' | 'experiment',
  config: ResolvedConfig,
  selectBranch: (opts: BranchPickerOptions) => Promise<BranchPickerResult>,
): Promise<string | null> {
  const dir = target === 'control' ? config.controlDir : config.experimentDir;
  // For control, expose the merge base of experiment's HEAD with the default
  // remote branch as a one-shortcut option — that's the canonical "before"
  // baseline for diffing an experiment.
  const mergeBase = target === 'control' ? findMergeBaseAgainstDefault(config.experimentDir) : null;

  const branches = await listRemoteBranches(dir);
  const widest = Math.min(60, Math.max(
    mergeBase ? `merge base with ${mergeBase.defaultBranch}`.length : 0,
    ...(branches ?? []).map((b) => b.name.length),
  ));
  const items: Array<{ label: string; value: string; meta?: string; group?: string }> = [];
  if (mergeBase) {
    items.push({
      label: `merge base with ${mergeBase.defaultBranch}`.padEnd(widest),
      value: mergeBase.sha,
      meta: mergeBase.shortSha,
      group: 'Special',
    });
  }
  for (const b of branches ?? []) {
    items.push({
      label: b.name.padEnd(widest),
      value: b.name,
      meta: `${relativeAge(b.committedAt)}  ${b.authorName}`,
      group: b.isMine ? 'Your branches' : 'Other branches',
    });
  }

  const hints = [
    branches === null ? 'Could not list remote branches via gh; type a branch name manually.' : null,
    items.length === 0 ? 'No remote branches found; type a branch name manually.' : null,
    '↑/↓ navigate · Enter or number · type a branch name + Enter for custom · Esc to cancel',
  ].filter((hint): hint is string => hint !== null);

  const result = await selectBranch({
    title: 'Branch:',
    items,
    hint: hints.join(' '),
    allowCustomText: true,
    windowSize: 5,
  });
  if (!result) return null;
  return result.kind === 'item' ? result.value : result.text;
}

// ---------- View ----------

interface AppShellProps {
  state: MenuState;
  items: MenuItem[];
  onKey: (key: string) => void | Promise<void>;
  ink: typeof Ink;
}

const MAIN_MENU_HINT = '↑/↓ navigate · Enter / number to pick · Ctrl+C to quit';

function AppShell({ state, items, onKey, ink }: AppShellProps): React.ReactElement {
  const { Box, Static, Text } = ink;
  const h = React.createElement;
  const F = React.Fragment;

  ink.useInput((input, key) => {
    if (key.ctrl && input === 'c') { void onKey('ctrl-c'); return; }
    if (key.escape) { void onKey('escape'); return; }
    if (key.upArrow) { void onKey('up'); return; }
    if (key.downArrow) { void onKey('down'); return; }
    if (key.return) { void onKey('enter'); return; }
    if (key.backspace || key.delete) { void onKey('backspace'); return; }
    if (input.length === 1) void onKey(input);
  });

  const TypedStatic = Static as unknown as React.FC<{
    items: string[];
    children: (item: string, index: number) => React.ReactNode;
  }>;

  const visible = visibleItems(items, state);
  const urlsReady = serversReady(state.serverStatus);
  const effectiveActivity = state.activity === IDLE_ACTIVITY && !urlsReady
    ? { verb: 'server URLs unreachable', color: 'gray' as const }
    : state.activity;
  // The shaka and sad emoji are reserved for the two terminal states: green
  // means servers are up and responding, red means startup actually failed.
  // Everything in between (starting, rebuilding, checking out, …) is just
  // "progress" — render it in the terminal default color with no emoji.
  const failedToStart = effectiveActivity.verb === 'failed to start';
  const statusColor: ActivityStatus['color'] | undefined =
    effectiveActivity.color === 'green' ? 'green'
    : failedToStart ? 'red'
    : undefined;
  const emoji = statusColor === 'green' ? ' 🤙' : statusColor === 'red' ? ' 😢' : '';
  const statusLine = h(Text, { color: statusColor, bold: true },
    `shaka-perf ${effectiveActivity.verb}${emoji}`);

  const renderServerStatusRow = (endpoint: ServerEndpointStatus): React.ReactElement => {
    const statusColor =
      endpoint.status === 'ready' ? 'green'
      : endpoint.status === 'down' ? 'red'
      : 'yellow';
    const label = `${endpoint.label}:`.padEnd(12);
    const detail = endpoint.detail ? ` (${endpoint.detail})` : '';
    return h(Box, { key: `server-${endpoint.side}`, flexDirection: 'column' },
      h(Text, null,
        `  ${label}${endpoint.url}  `,
        h(Text, { color: statusColor }, endpoint.status),
        detail ? h(Text, { color: 'gray' }, detail) : null,
      ),
      h(Text, { color: 'gray' }, `  ${'Volume:'.padEnd(12)}${endpoint.volumeDir}`),
    );
  };

  const serverRows = [state.serverStatus.control, state.serverStatus.experiment]
    .map(renderServerStatusRow);

  const renderPicker = (picker: BranchPickerState): React.ReactElement[] => {
    const lines: React.ReactElement[] = [
      h(Text, { key: 'picker-title', bold: true }, `  ${picker.title}`),
    ];
    const itemCount = picker.items.length;
    const windowSize = picker.windowSize > 0
      ? Math.min(picker.windowSize, Math.max(itemCount, 1))
      : Math.max(itemCount, 1);
    let firstVisible = 0;
    if (itemCount > 0) {
      if (picker.selectedIndex >= firstVisible + windowSize) {
        firstVisible = picker.selectedIndex - windowSize + 1;
      }
    }
    const end = Math.min(firstVisible + windowSize, itemCount);
    if (firstVisible > 0) {
      lines.push(h(Text, { key: 'picker-above', color: 'gray' }, `  ↑ ${firstVisible} more above`));
    }

    let lastGroup: string | undefined;
    for (let i = firstVisible; i < end; i++) {
      const item = picker.items[i];
      if (item.group !== lastGroup) {
        if (lastGroup !== undefined) lines.push(h(Text, { key: `picker-gap-${i}` }, ''));
        if (item.group) {
          lines.push(h(Text, { key: `picker-group-${item.group}-${i}`, color: 'gray' }, `  ${item.group}`));
        }
        lastGroup = item.group;
      }
      const selected = i === picker.selectedIndex;
      const cursor = selected ? '▸' : ' ';
      const num = `[${String(i + 1).padStart(2)}]`;
      lines.push(h(Text, { key: `picker-item-${i}`, color: selected ? 'cyan' : undefined, bold: selected },
        `  ${cursor}${num} ${item.label}`,
        item.meta ? h(Text, { color: 'gray' }, `  ${item.meta}`) : null,
      ));
    }

    if (end < itemCount) {
      lines.push(h(Text, { key: 'picker-below', color: 'gray' }, `  ↓ ${itemCount - end} more below`));
    }
    if (itemCount === 0) {
      lines.push(h(Text, { key: 'picker-empty', color: 'gray' }, '  No branch list available.'));
    }
    lines.push(h(Text, { key: 'picker-spacer' }, ''));
    lines.push(h(Text, { key: 'picker-hint', color: 'gray' }, `  ${picker.hint}`));
    lines.push(h(Text, { key: 'picker-input' }, `  > ${picker.typed}`));
    return lines;
  };

  const renderRow = (item: MenuItem, selected: boolean): React.ReactElement[] => {
    const cursor = selected ? '▸' : ' ';
    const rowColor = selected ? 'cyan' : undefined;
    const bold = selected;
    const numLabel = item.numericKey ? `[${item.numericKey}] ` : '';
    const label = typeof item.label === 'function' ? item.label(state) : item.label;
    switch (item.renderer ?? 'simple') {
      case 'checkout': {
        const target = item.id === 'control-checkout' ? 'control' : 'experiment';
        const info = target === 'control' ? state.checkouts.control : state.checkouts.experiment;
        return [h(Text, { key: item.id, color: rowColor, bold },
          ` ${cursor}`,
          h(Text, { color: checkoutColor(info) }, label),
        )];
      }
      case 'rebuild': {
        const dotColor = state.decision.needs ? 'yellow' : 'green';
        return [
          h(Text, { key: item.id, color: rowColor, bold }, ` ${cursor}${numLabel}`,
            h(Text, { color: dotColor }, '● '), label),
          h(Text, { key: `${item.id}-reason`, color: 'gray' }, `        ${state.decision.reason}`),
        ];
      }
      case 'simple':
      default:
        return [h(Text, { key: item.id, color: rowColor, bold }, ` ${cursor}${numLabel}${label}`)];
    }
  };

  return h(F, null,
    h(TypedStatic, {
      items: state.logLines,
      children: (line: string, i: number) => h(Text, { key: i }, line),
    }),
    // While starting up, render only operational status. Server logs are kept
    // in the combined log file unless the explicit log viewer is open.
    !state.menuReady ? h(Box, { marginTop: 1, flexDirection: 'column' },
      statusLine,
      ...serverRows,
    ) : h(Box, {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'gray',
      paddingX: 1,
      marginTop: 1,
    },
      statusLine,
      h(Text, null, ''),
      ...serverRows,
      h(Text, null, ''),
      ...(state.picker
        ? renderPicker(state.picker)
        : visible.flatMap((item, i) => renderRow(item, i === state.selectedIndex))),
      state.busy && !state.picker ? h(Text, { color: 'blue' }, '  (running — keys disabled, Ctrl+C to abort)') : null,
      !state.picker ? h(Text, { color: 'gray' }, `  ${MAIN_MENU_HINT}`) : null,
      state.lastMessage ? h(Text, { color: 'blue' }, `  ${state.lastMessage}`) : null,
    ),
  );
}
