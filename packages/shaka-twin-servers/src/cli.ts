#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { loadConfig, resolveConfig, findConfigFile } from './config';
import { build, type BuildTarget } from './commands/build';
import { startContainers } from './commands/start-containers';
import { stopContainers } from './commands/stop-containers';
import { startServers } from './commands/start-servers';
import { runOvermindCommand } from './commands/run-overmind-command';
import { runCmd } from './commands/run-cmd';
import { runCmdParallel } from './commands/run-cmd-parallel';
import { syncChanges } from './commands/sync-changes';
import { say } from './commands/say';
import { copyChangesToSsh } from './commands/copy-changes-to-ssh';
import { forwardPorts } from './commands/forward-ports';
import { customizeDockerCompose } from './commands/customize-docker-compose';
import type { ResolvedConfig } from './types';
import { colorize } from './helpers/ui';

const VERSION = '0.0.6';

function requireTarget(target: string | undefined, usage: string): asserts target is 'control' | 'experiment' {
  if (!target || (target !== 'control' && target !== 'experiment')) {
    console.error(colorize('Error: Target must be "control" or "experiment"', 'red'));
    console.error(`Usage: ${usage}`);
    process.exit(2);
  }
}

async function getResolvedConfig(program: Command): Promise<{ resolvedConfig: ResolvedConfig; configPath: string }> {
  const globalOpts = program.opts();

  let configPath = globalOpts.config;
  if (!configPath) {
    configPath = findConfigFile() ?? undefined;
    if (!configPath) {
      console.error(colorize('Error: No config file found', 'red'));
      console.error('Create a twin-servers.config.ts file or specify one with --config');
      process.exit(2);
    }
    if (globalOpts.verbose) {
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

function wrapAction(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error(colorize(`Error: ${(error as Error).message}`, 'red'));
      process.exit(1);
    }
  };
}

const program = new Command();

program
  .name('shaka-twin-servers')
  .description('Twin server management for A/B performance testing')
  .version(`shaka-twin-servers v${VERSION}`, '--version', 'Show version')
  .option('-c, --config <file>', 'Config file path (.js or .ts)')
  .option('-v, --verbose', 'Verbose output', false)
  .addHelpText('after', `
Command options:
  build:
      -t, --target <target>  Build target (control or experiment)
          --no-cache         Disable Docker layer cache

<target> is either "control" or "experiment"

Examples:
  # Auto-discovers twin-servers.config.ts in current directory
  shaka-twin-servers build
  shaka-twin-servers build --target experiment  # Build only experiment image
  shaka-twin-servers build --target control     # Build only control image
  shaka-twin-servers start-containers
  shaka-twin-servers start-servers

  # Sync changes to experiment volume
  shaka-twin-servers sync-changes experiment

  # Run command in container interactively
  shaka-twin-servers run-cmd experiment "bundle exec rails console"

  # Run command in both containers in parallel
  shaka-twin-servers run-cmd-parallel "bundle exec rake db:migrate"

  # Run command in container with PID tracking (used in Procfile)
  shaka-twin-servers run-overmind-command control "bundle exec puma -b tcp://0.0.0.0:3000"

  # Copy local git changes to CI via SSH (for debugging)
  shaka-twin-servers copy-changes-to-ssh 54782 18.210.27.22              # all targets
  shaka-twin-servers copy-changes-to-ssh 54782 18.210.27.22 experiment   # experiment only

  # Forward CI twin server ports to localhost
  shaka-twin-servers forward-ports 54782 18.210.27.22                    # default ports 3020, 3030
  shaka-twin-servers forward-ports 54782 18.210.27.22 3000 3001          # custom ports
  shaka-twin-servers forward-ports 54782 18.210.27.22 3010:3020 3030     # local:remote mapping

  # Specify config explicitly
  shaka-twin-servers build -c path/to/twin-servers.config.ts
`);

program
  .command('build')
  .description('Build Docker images (both by default, or single target)')
  .option('-t, --target <target>', 'Build target (control or experiment)')
  .option('--no-cache', 'Disable Docker layer cache')
  .action(wrapAction(async (opts) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    const globalOpts = program.opts();
    let target: BuildTarget | undefined;
    if (opts.target) {
      if (opts.target !== 'control' && opts.target !== 'experiment') {
        console.error(colorize('Error: --target must be "control" or "experiment"', 'red'));
        process.exit(2);
      }
      target = opts.target;
    }
    await build(resolvedConfig, { verbose: globalOpts.verbose, target, noCache: !opts.cache });
  }));

program
  .command('get-config')
  .description('Get a config value (e.g., dockerfile)')
  .argument('[key]', 'Config key to print')
  .action(wrapAction(async (key) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    if (!key || !(key in resolvedConfig)) {
      console.error(colorize(`Error: ${key ? `Unknown config key '${key}'` : 'Config key required'}`, 'red'));
      console.error(`Available keys: ${Object.keys(resolvedConfig).join(', ')}`);
      process.exit(2);
    }
    const value = resolvedConfig[key as keyof ResolvedConfig];
    console.log(value);
  }));

program
  .command('start-containers')
  .description('Start Docker containers')
  .action(wrapAction(async () => {
    const { resolvedConfig } = await getResolvedConfig(program);
    await startContainers(resolvedConfig, { verbose: program.opts().verbose });
  }));

program
  .command('stop-containers')
  .description('Stop Docker containers and remove volumes')
  .action(wrapAction(async () => {
    const { resolvedConfig } = await getResolvedConfig(program);
    await stopContainers(resolvedConfig, { verbose: program.opts().verbose });
  }));

program
  .command('start-servers')
  .description('Start Rails servers via Overmind')
  .action(wrapAction(async () => {
    const { resolvedConfig } = await getResolvedConfig(program);
    await startServers(resolvedConfig, { verbose: program.opts().verbose });
  }));

program
  .command('run-cmd')
  .description('Run a command in a container interactively')
  .argument('<target>', 'control or experiment')
  .argument('[cmd...]', 'Command to run')
  .action(wrapAction(async (target, cmdParts) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    const usage = 'shaka-twin-servers run-cmd <control|experiment> <command>';
    requireTarget(target, usage);
    const cmd = cmdParts.length > 0 ? cmdParts.join(' ') : undefined;
    if (!cmd) {
      console.error(colorize('Error: Command required', 'red'));
      console.error(`Usage: ${usage}`);
      process.exit(2);
    }
    await runCmd(resolvedConfig, target, cmd, { verbose: program.opts().verbose });
  }));

program
  .command('run-cmd-parallel')
  .description('Run a command in both containers in parallel')
  .argument('<cmd...>', 'Command to run')
  .action(wrapAction(async (cmdParts) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    const cmd = cmdParts.join(' ');
    await runCmdParallel(resolvedConfig, cmd, { verbose: program.opts().verbose });
  }));

program
  .command('run-overmind-command')
  .description('Run a command in a container with PID tracking (for Procfile)')
  .argument('<target>', 'control or experiment')
  .argument('<cmd...>', 'Command to run')
  .action(wrapAction(async (target, cmdParts) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    const usage = 'shaka-twin-servers run-overmind-command <control|experiment> <command>';
    requireTarget(target, usage);
    const cmd = cmdParts.join(' ');
    await runOvermindCommand(resolvedConfig, target, cmd, { verbose: program.opts().verbose });
  }));

program
  .command('sync-changes')
  .description('Sync git changes to control or experiment volume')
  .argument('<target>', 'control or experiment')
  .action(wrapAction(async (target) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    const usage = 'shaka-twin-servers sync-changes <control|experiment>';
    requireTarget(target, usage);
    await syncChanges(resolvedConfig, target, { verbose: program.opts().verbose });
  }));

program
  .command('say')
  .description('Speak a message using text-to-speech (macOS/Linux)')
  .argument('<message...>', 'Message to speak')
  .action(wrapAction(async (messageParts) => {
    const message = messageParts.join(' ');
    await say(message);
  }));

const SSH_HINT = `
To get the correct arguments:
1. Go to your CircleCI job
2. Click "Rerun job with SSH"
3. Copy the SSH command from the job logs
4. Extract the port and host from: ssh -p <PORT> <HOST>`;

program
  .command('copy-changes-to-ssh')
  .description('Copy local git changes to SSH (for CI debugging)')
  .argument('<port>', 'SSH port')
  .argument('<host>', 'SSH host')
  .argument('[target]', 'control, experiment, or all')
  .addHelpText('after', SSH_HINT)
  .action(wrapAction(async (port, host, copyTarget) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    if (copyTarget && copyTarget !== 'control' && copyTarget !== 'experiment' && copyTarget !== 'all') {
      console.error(colorize('Error: Target must be "control", "experiment", or "all"', 'red'));
      process.exit(2);
    }
    await copyChangesToSsh(resolvedConfig, { port, host }, { verbose: program.opts().verbose, target: copyTarget });
  }));

program
  .command('forward-ports')
  .description('Forward CI ports to localhost')
  .argument('<port>', 'SSH port')
  .argument('<host>', 'SSH host')
  .argument('[controlPort]', 'Control port (default: 3020)', '3020')
  .argument('[experimentPort]', 'Experiment port (default: 3030)', '3030')
  .addHelpText('after', SSH_HINT)
  .action(wrapAction(async (port, host, controlPort, experimentPort) => {
    const { resolvedConfig } = await getResolvedConfig(program);
    await forwardPorts(resolvedConfig, { port, host }, { verbose: program.opts().verbose, controlPort, experimentPort });
  }));

program
  .command('customize-docker-compose')
  .description('Copy bundled docker-compose.yml for customization')
  .action(wrapAction(async () => {
    const { resolvedConfig, configPath } = await getResolvedConfig(program);
    await customizeDockerCompose(resolvedConfig, configPath);
  }));

program.parse();
