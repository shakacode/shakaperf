/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import 'dotenv/config';
import { Command } from 'commander';
import { loadConfig, resolveConfig, findConfigFile } from './config';
import { build, type BuildTarget } from './commands/build';
import { startContainers } from './commands/start-containers';
import { stopContainers } from './commands/stop-containers';
import { startServers } from './commands/start-servers';
import { serversDefault } from './commands/servers-default';
import { runOvermindCommand } from './commands/run-overmind-command';
import { runCmd } from './commands/run-cmd';
import { runCmdParallel } from './commands/run-cmd-parallel';
import { syncChanges } from './commands/sync-changes';
import { say } from './commands/say';
import { notifyServerStarted } from './commands/notify-server-started';
import { copyChangesToSsh } from './commands/copy-changes-to-ssh';
import { forwardPorts } from './commands/forward-ports';
import { customizeDockerCompose } from './commands/customize-docker-compose';
import { pruneBuildCache } from './commands/prune-cache';
import type { ResolvedConfig } from './types';
import { colorize } from './helpers/ui';
import { tryProxy } from './ipc/client';
import { EXIT_NEVER_DISPATCHED, PROTOCOL_VERSION, type ProxyRequestPayload } from './ipc/protocol';

function requireTarget(target: string | undefined, usage: string): asserts target is 'control' | 'experiment' {
  if (!target || (target !== 'control' && target !== 'experiment')) {
    console.error(colorize('Error: Target must be "control" or "experiment"', 'red'));
    console.error(`Usage: ${usage}`);
    process.exit(2);
  }
}

async function getResolvedConfig(cmd: Command): Promise<{ resolvedConfig: ResolvedConfig; configPath: string }> {
  const opts = inheritedOpts(cmd);

  let configPath = opts.config;
  if (!configPath) {
    configPath = findConfigFile() ?? undefined;
    if (!configPath) {
      console.error(colorize('Error: No config file found', 'red'));
      console.error('Create an abtests.config.ts file or specify one with --config');
      process.exit(2);
    }
    if (opts.verbose) {
      console.log(`Using config: ${configPath}`);
    }
  }

  try {
    const userConfig = await loadConfig(configPath);
    const resolvedConfig = resolveConfig(userConfig);
    return { resolvedConfig, configPath };
  } catch (error) {
    console.error(colorize(`Error loading config: ${(error as Error).message}`, 'red'));
    process.exit(2);
  }
}

/**
 * Merge options set on the subcommand and its parent so callers can pass
 * `-c/-v` either before or after the subcommand name.
 */
function inheritedOpts(cmd: Command): { config?: string; verbose?: boolean } {
  const own = cmd.opts();
  const parent = cmd.parent?.opts() ?? {};
  return {
    config: own.config ?? parent.config,
    verbose: own.verbose ?? parent.verbose,
  };
}

function wrapAction(fn: (this: Command, ...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async function(this: Command, ...args: any[]) {
    try {
      await fn.apply(this, args);
    } catch (error) {
      console.error(colorize(`Error: ${(error as Error).message}`, 'red'));
      process.exit(1);
    }
  };
}

function getNestedConfigValue(config: ResolvedConfig, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) => {
    if (value && typeof value === 'object' && part in value) {
      return (value as Record<string, unknown>)[part];
    }
    return undefined;
  }, config);
}

function printConfigValue(value: unknown, asJson: boolean): void {
  if (asJson || (value !== null && typeof value === 'object')) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(String(value));
}

/**
 * Run a subcommand through a running `shaka-perf servers` if one is up for
 * this slug; otherwise run `fallback` locally. The proxy path always wins
 * when reachable — that's the whole point of running an interactive servers
 * session in another terminal: subcommands queued there share its tty for
 * logs and its single notion of "what's in flight".
 *
 * On `proxied: true` we propagate the exit code with `process.exit` rather
 * than just returning, because the surrounding `wrapAction` would otherwise
 * print nothing and let commander reach a 0 exit even after a non-zero
 * proxy outcome. The one exception is `EXIT_NEVER_DISPATCHED` (2): the
 * server reached but didn't run the action (protocol skew, malformed frame,
 * unknown cmd from a newer client). The action is safe to run locally —
 * documented intent of code 2 — and the project already uses raw exit 2
 * for usage errors, so propagating verbatim would mis-bucket protocol
 * skew as a user mistake on a CI dashboard.
 */
async function proxyOrRun(
  config: ResolvedConfig,
  verbose: boolean,
  payload: ProxyRequestPayload,
  fallback: () => Promise<void>,
): Promise<void> {
  const outcome = await tryProxy({
    slug: config.projectSlug,
    request: { v: PROTOCOL_VERSION, ...payload },
    verbose,
  });
  if (outcome.proxied) {
    if (outcome.code === EXIT_NEVER_DISPATCHED) {
      if (verbose) console.error(`[ipc] server didn't dispatch (${outcome.error ?? 'no reason given'}) — falling back to local`);
      await fallback();
      return;
    }
    if (outcome.error) console.error(colorize(`Error: ${outcome.error}`, 'red'));
    process.exit(outcome.code);
  }
  await fallback();
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-c, --config <file>', 'Config file path (.js or .ts)')
    // No `false` default — `inheritedOpts` uses `??` to fall through to the
    // parent's value when the subcommand has nothing set, and a literal
    // `false` would short-circuit that and silently drop `-v` placed before
    // the subcommand name (`shaka-perf -v build` would lose verbose).
    .option('-v, --verbose', 'Verbose output');
}

const SSH_HINT = `
To get the correct arguments:
1. Go to your CircleCI job
2. Click "Rerun job with SSH"
3. Copy the SSH command from the job logs
4. Extract the port and host from: ssh -p <PORT> <HOST>`;

function buildSub(): Command {
  return addCommonOptions(
    new Command('build')
      .description('Build Docker images (both by default, or single target)')
      .option('-t, --target <target>', 'Build target (control or experiment)')
      .option('--no-cache', 'Disable Docker layer cache')
      .action(wrapAction(async function(this: Command, opts) {
        const { resolvedConfig } = await getResolvedConfig(this);
        let target: BuildTarget | undefined;
        if (opts.target) {
          if (opts.target !== 'control' && opts.target !== 'experiment') {
            console.error(colorize('Error: --target must be "control" or "experiment"', 'red'));
            process.exit(2);
          }
          target = opts.target;
        }
        const verbose = inheritedOpts(this).verbose ?? false;
        const noCache = !opts.cache;
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'build', target, noCache },
          () => build(resolvedConfig, { verbose, target, noCache }),
        );
      }))
  );
}

function getConfigSub(): Command {
  return addCommonOptions(
    new Command('get-config')
      .description('Get a resolved config value (e.g., dockerfile, images.control, ports.control)')
      .argument('[key]', 'Config key or dotted path to print')
      .option('--json', 'Print JSON')
      .action(wrapAction(async function(this: Command, key) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const opts = this.opts();
        if (!key && opts.json) {
          printConfigValue(resolvedConfig, true);
          return;
        }
        if (!key) {
          console.error(colorize('Error: Config key required', 'red'));
          console.error(`Available keys: ${Object.keys(resolvedConfig).join(', ')}`);
          process.exit(2);
        }
        const value = getNestedConfigValue(resolvedConfig, key);
        if (typeof value === 'undefined') {
          console.error(colorize(`Error: ${key ? `Unknown config key '${key}'` : 'Config key required'}`, 'red'));
          console.error(`Available keys: ${Object.keys(resolvedConfig).join(', ')}`);
          process.exit(2);
        }
        printConfigValue(value, opts.json);
      }))
  );
}

function startContainersSub(): Command {
  return addCommonOptions(
    new Command('start-containers')
      .description('Start Docker containers')
      .action(wrapAction(async function(this: Command) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const verbose = inheritedOpts(this).verbose ?? false;
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'start-containers' },
          () => startContainers(resolvedConfig, { verbose }),
        );
      }))
  );
}

function stopContainersSub(): Command {
  return addCommonOptions(
    new Command('stop-containers')
      .description('Stop Docker containers and remove volumes')
      .action(wrapAction(async function(this: Command) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const verbose = inheritedOpts(this).verbose ?? false;
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'stop-containers' },
          () => stopContainers(resolvedConfig, { verbose }),
        );
      }))
  );
}

function pruneCacheSub(): Command {
  return addCommonOptions(
    new Command('prune-cache')
      .description('Prune this project\'s isolated Buildx cache')
      .option('--images', 'Also remove the configured control and experiment images')
      .action(wrapAction(async function(this: Command, opts: { images?: boolean }) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const verbose = inheritedOpts(this).verbose ?? false;
        const images = opts.images === true;
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'prune-cache', images },
          () => pruneBuildCache(resolvedConfig, { images }),
        );
      }))
  );
}

function startServersSub(): Command {
  return addCommonOptions(
    new Command('start-servers')
      .description('Start Rails servers via Overmind')
      .action(wrapAction(async function(this: Command) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const verbose = inheritedOpts(this).verbose ?? false;
        // When a `shaka-perf servers` is up, this re-spawns overmind inside
        // its menu (containers untouched). Without a server up, it falls
        // back to the same blocking local startServers() as before.
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'start-servers' },
          () => startServers(resolvedConfig, { verbose }),
        );
      }))
  );
}

function runCmdSub(): Command {
  return addCommonOptions(
    new Command('run-cmd')
      .description('Run a command in a container interactively')
      .argument('<target>', 'control or experiment')
      .argument('[cmd...]', 'Command to run')
      .action(wrapAction(async function(this: Command, target, cmdParts) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const usage = 'shaka-perf servers run-cmd <control|experiment> <command>';
        requireTarget(target, usage);
        const cmd = cmdParts.length > 0 ? cmdParts.join(' ') : undefined;
        if (!cmd) {
          console.error(colorize('Error: Command required', 'red'));
          console.error(`Usage: ${usage}`);
          process.exit(2);
        }
        const verbose = inheritedOpts(this).verbose ?? false;
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'run-cmd', target, shellCommand: cmd },
          () => runCmd(resolvedConfig, target, cmd, { verbose }),
        );
      }))
  );
}

function runCmdParallelSub(): Command {
  return addCommonOptions(
    new Command('run-cmd-parallel')
      .description('Run a command in both containers in parallel')
      .argument('<cmd...>', 'Command to run')
      .action(wrapAction(async function(this: Command, cmdParts) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const cmd = cmdParts.join(' ');
        const verbose = inheritedOpts(this).verbose ?? false;
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'run-cmd-parallel', shellCommand: cmd },
          () => runCmdParallel(resolvedConfig, cmd, { verbose }),
        );
      }))
  );
}

function runOvermindCommandSub(): Command {
  return addCommonOptions(
    new Command('run-overmind-command')
      .description('Run a command in a container with PID tracking (for Procfile)')
      .argument('<target>', 'control or experiment')
      .argument('<cmd...>', 'Command to run')
      .action(wrapAction(async function(this: Command, target, cmdParts) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const usage = 'shaka-perf servers run-overmind-command <control|experiment> <command>';
        requireTarget(target, usage);
        const cmd = cmdParts.join(' ');
        await runOvermindCommand(resolvedConfig, target, cmd, { verbose: inheritedOpts(this).verbose });
      }))
  );
}

function syncChangesSub(): Command {
  return addCommonOptions(
    new Command('sync-changes')
      .description('Sync git changes to control or experiment volume')
      .argument('<target>', 'control or experiment')
      .action(wrapAction(async function(this: Command, target) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const usage = 'shaka-perf servers sync-changes <control|experiment>';
        requireTarget(target, usage);
        const verbose = inheritedOpts(this).verbose ?? false;
        await proxyOrRun(
          resolvedConfig,
          verbose,
          { cmd: 'sync-changes', target },
          () => syncChanges(resolvedConfig, target, { verbose }),
        );
      }))
  );
}

function saySub(): Command {
  return new Command('say')
    .description('Speak a message using text-to-speech (macOS/Linux)')
    .argument('<message...>', 'Message to speak')
    .action(wrapAction(async (_messageParts) => {
      const message = _messageParts.join(' ');
      await say(message);
    }));
}

function notifyServerStartedSub(): Command {
  return addCommonOptions(
    new Command('notify-server-started')
      .description('Wait for a twin server, announce it, then sleep (Procfile helper)')
      .argument('<target>', 'control or experiment')
      .option('--timeout <duration>', 'dockerize -timeout value', '60s')
      .action(wrapAction(async function(this: Command, target) {
        const { resolvedConfig } = await getResolvedConfig(this);
        const usage = 'shaka-perf servers notify-server-started <control|experiment>';
        requireTarget(target, usage);
        await notifyServerStarted(resolvedConfig, target, {
          timeout: this.opts().timeout,
        });
      }))
  );
}

function copyChangesToSshSub(): Command {
  return addCommonOptions(
    new Command('copy-changes-to-ssh')
      .description('Copy local git changes to SSH (for CI debugging)')
      .argument('<port>', 'SSH port')
      .argument('<host>', 'SSH host')
      .argument('[target]', 'control, experiment, or all')
      .addHelpText('after', SSH_HINT)
      .action(wrapAction(async function(this: Command, port, host, copyTarget) {
        const { resolvedConfig } = await getResolvedConfig(this);
        if (copyTarget && copyTarget !== 'control' && copyTarget !== 'experiment' && copyTarget !== 'all') {
          console.error(colorize('Error: Target must be "control", "experiment", or "all"', 'red'));
          process.exit(2);
        }
        await copyChangesToSsh(resolvedConfig, { port, host }, { verbose: inheritedOpts(this).verbose, target: copyTarget });
      }))
  );
}

function forwardPortsSub(): Command {
  return addCommonOptions(
    new Command('forward-ports')
      .description('Forward CI ports to localhost')
      .argument('<port>', 'SSH port')
      .argument('<host>', 'SSH host')
      .argument('[controlPort]', 'Control port (default: from twin-servers config)')
      .argument('[experimentPort]', 'Experiment port (default: from twin-servers config)')
      .addHelpText('after', SSH_HINT)
      .action(wrapAction(async function(this: Command, port, host, controlPort, experimentPort) {
        const { resolvedConfig } = await getResolvedConfig(this);
        await forwardPorts(resolvedConfig, { port, host }, { verbose: inheritedOpts(this).verbose, controlPort, experimentPort });
      }))
  );
}

function customizeDockerComposeSub(): Command {
  return addCommonOptions(
    new Command('customize-docker-compose')
      .description('Copy bundled docker-compose.yml for customization')
      .action(wrapAction(async function(this: Command) {
        const { resolvedConfig, configPath } = await getResolvedConfig(this);
        await customizeDockerCompose(resolvedConfig, configPath);
      }))
  );
}

export function createServersCommand(): Command {
  const root = addCommonOptions(
    new Command('servers')
      .description('Manage twin Docker servers for A/B testing (run with no subcommand to auto-build & start)')
      .action(wrapAction(async function(this: Command) {
        const { resolvedConfig } = await getResolvedConfig(this);
        await serversDefault(resolvedConfig, { verbose: inheritedOpts(this).verbose });
      }))
  );

  for (const sub of [
    buildSub(),
    getConfigSub(),
    startContainersSub(),
    stopContainersSub(),
    pruneCacheSub(),
    startServersSub(),
    runCmdSub(),
    runCmdParallelSub(),
    runOvermindCommandSub(),
    syncChangesSub(),
    saySub(),
    notifyServerStartedSub(),
    copyChangesToSshSub(),
    forwardPortsSub(),
    customizeDockerComposeSub(),
  ]) {
    root.addCommand(sub);
  }

  return root;
}
