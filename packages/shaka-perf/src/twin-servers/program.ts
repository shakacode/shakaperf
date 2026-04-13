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

function requireTarget(target: string | undefined, usage: string): asserts target is 'control' | 'experiment' {
  if (!target || (target !== 'control' && target !== 'experiment')) {
    console.error(colorize('Error: Target must be "control" or "experiment"', 'red'));
    console.error(`Usage: ${usage}`);
    process.exit(2);
  }
}

async function getResolvedConfig(cmd: Command): Promise<{ resolvedConfig: ResolvedConfig; configPath: string }> {
  const opts = cmd.opts();

  let configPath = opts.config;
  if (!configPath) {
    configPath = findConfigFile() ?? undefined;
    if (!configPath) {
      console.error(colorize('Error: No config file found', 'red'));
      console.error('Create a twin-servers.config.ts file or specify one with --config');
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

function addTwinsOptions(cmd: Command): Command {
  return cmd
    .option('-c, --config <file>', 'Config file path (.js or .ts)')
    .option('-v, --verbose', 'Verbose output', false);
}

export function createTwinServersCommands(): Command[] {
  const commands: Command[] = [];

  const buildCmd = new Command('twins-build')
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
      await build(resolvedConfig, { verbose: this.opts().verbose, target, noCache: !opts.cache });
    }));
  addTwinsOptions(buildCmd);
  commands.push(buildCmd);

  const getConfigCmd = new Command('twins-get-config')
    .description('Get a config value (e.g., dockerfile)')
    .argument('[key]', 'Config key to print')
    .action(wrapAction(async function(this: Command, key) {
      const { resolvedConfig } = await getResolvedConfig(this);
      if (!key || !(key in resolvedConfig)) {
        console.error(colorize(`Error: ${key ? `Unknown config key '${key}'` : 'Config key required'}`, 'red'));
        console.error(`Available keys: ${Object.keys(resolvedConfig).join(', ')}`);
        process.exit(2);
      }
      const value = resolvedConfig[key as keyof ResolvedConfig];
      console.log(value);
    }));
  addTwinsOptions(getConfigCmd);
  commands.push(getConfigCmd);

  const startContainersCmd = new Command('twins-start-containers')
    .description('Start Docker containers')
    .action(wrapAction(async function(this: Command) {
      const { resolvedConfig } = await getResolvedConfig(this);
      await startContainers(resolvedConfig, { verbose: this.opts().verbose });
    }));
  addTwinsOptions(startContainersCmd);
  commands.push(startContainersCmd);

  const stopContainersCmd = new Command('twins-stop-containers')
    .description('Stop Docker containers and remove volumes')
    .action(wrapAction(async function(this: Command) {
      const { resolvedConfig } = await getResolvedConfig(this);
      await stopContainers(resolvedConfig, { verbose: this.opts().verbose });
    }));
  addTwinsOptions(stopContainersCmd);
  commands.push(stopContainersCmd);

  const startServersCmd = new Command('twins-start-servers')
    .description('Start Rails servers via Overmind')
    .action(wrapAction(async function(this: Command) {
      const { resolvedConfig } = await getResolvedConfig(this);
      await startServers(resolvedConfig, { verbose: this.opts().verbose });
    }));
  addTwinsOptions(startServersCmd);
  commands.push(startServersCmd);

  const runCmdCmd = new Command('twins-run-cmd')
    .description('Run a command in a container interactively')
    .argument('<target>', 'control or experiment')
    .argument('[cmd...]', 'Command to run')
    .action(wrapAction(async function(this: Command, target, cmdParts) {
      const { resolvedConfig } = await getResolvedConfig(this);
      const usage = 'shaka-perf twins-run-cmd <control|experiment> <command>';
      requireTarget(target, usage);
      const cmd = cmdParts.length > 0 ? cmdParts.join(' ') : undefined;
      if (!cmd) {
        console.error(colorize('Error: Command required', 'red'));
        console.error(`Usage: ${usage}`);
        process.exit(2);
      }
      await runCmd(resolvedConfig, target, cmd, { verbose: this.opts().verbose });
    }));
  addTwinsOptions(runCmdCmd);
  commands.push(runCmdCmd);

  const runCmdParallelCmd = new Command('twins-run-cmd-parallel')
    .description('Run a command in both containers in parallel')
    .argument('<cmd...>', 'Command to run')
    .action(wrapAction(async function(this: Command, cmdParts) {
      const { resolvedConfig } = await getResolvedConfig(this);
      const cmd = cmdParts.join(' ');
      await runCmdParallel(resolvedConfig, cmd, { verbose: this.opts().verbose });
    }));
  addTwinsOptions(runCmdParallelCmd);
  commands.push(runCmdParallelCmd);

  const runOvermindCmd = new Command('twins-run-overmind-command')
    .description('Run a command in a container with PID tracking (for Procfile)')
    .argument('<target>', 'control or experiment')
    .argument('<cmd...>', 'Command to run')
    .action(wrapAction(async function(this: Command, target, cmdParts) {
      const { resolvedConfig } = await getResolvedConfig(this);
      const usage = 'shaka-perf twins-run-overmind-command <control|experiment> <command>';
      requireTarget(target, usage);
      const cmd = cmdParts.join(' ');
      await runOvermindCommand(resolvedConfig, target, cmd, { verbose: this.opts().verbose });
    }));
  addTwinsOptions(runOvermindCmd);
  commands.push(runOvermindCmd);

  const syncChangesCmd = new Command('twins-sync-changes')
    .description('Sync git changes to control or experiment volume')
    .argument('<target>', 'control or experiment')
    .action(wrapAction(async function(this: Command, target) {
      const { resolvedConfig } = await getResolvedConfig(this);
      const usage = 'shaka-perf twins-sync-changes <control|experiment>';
      requireTarget(target, usage);
      await syncChanges(resolvedConfig, target, { verbose: this.opts().verbose });
    }));
  addTwinsOptions(syncChangesCmd);
  commands.push(syncChangesCmd);

  const sayCmd = new Command('twins-say')
    .description('Speak a message using text-to-speech (macOS/Linux)')
    .argument('<message...>', 'Message to speak')
    .action(wrapAction(async (_messageParts) => {
      const message = _messageParts.join(' ');
      await say(message);
    }));
  commands.push(sayCmd);

  const SSH_HINT = `
To get the correct arguments:
1. Go to your CircleCI job
2. Click "Rerun job with SSH"
3. Copy the SSH command from the job logs
4. Extract the port and host from: ssh -p <PORT> <HOST>`;

  const copyChangesCmd = new Command('twins-copy-changes-to-ssh')
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
      await copyChangesToSsh(resolvedConfig, { port, host }, { verbose: this.opts().verbose, target: copyTarget });
    }));
  addTwinsOptions(copyChangesCmd);
  commands.push(copyChangesCmd);

  const forwardPortsCmd = new Command('twins-forward-ports')
    .description('Forward CI ports to localhost')
    .argument('<port>', 'SSH port')
    .argument('<host>', 'SSH host')
    .argument('[controlPort]', 'Control port (default: 3020)', '3020')
    .argument('[experimentPort]', 'Experiment port (default: 3030)', '3030')
    .addHelpText('after', SSH_HINT)
    .action(wrapAction(async function(this: Command, port, host, controlPort, experimentPort) {
      const { resolvedConfig } = await getResolvedConfig(this);
      await forwardPorts(resolvedConfig, { port, host }, { verbose: this.opts().verbose, controlPort, experimentPort });
    }));
  addTwinsOptions(forwardPortsCmd);
  commands.push(forwardPortsCmd);

  const customizeCmd = new Command('twins-customize-docker-compose')
    .description('Copy bundled docker-compose.yml for customization')
    .action(wrapAction(async function(this: Command) {
      const { resolvedConfig, configPath } = await getResolvedConfig(this);
      await customizeDockerCompose(resolvedConfig, configPath);
    }));
  addTwinsOptions(customizeCmd);
  commands.push(customizeCmd);

  return commands;
}
