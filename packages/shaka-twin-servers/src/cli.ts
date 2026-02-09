#!/usr/bin/env node

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { loadConfig, resolveConfig, findConfigFile } from './config';
import { build, type BuildTarget } from './commands/build';
import { startContainers } from './commands/start-containers';
import { startServers } from './commands/start-servers';
import { runOvermindCommand } from './commands/run-overmind-command';
import { runCmd } from './commands/run-cmd';
import { runCmdParallel } from './commands/run-cmd-parallel';
import { syncChanges } from './commands/sync-changes';
import { say } from './commands/say';
import type { Command } from './types';
import { colorize } from './helpers/ui';

const VERSION = '0.0.2';

const HELP = `
shaka-twin-servers - Twin server management for A/B performance testing

Usage:
  shaka-twin-servers <command> [options]

Commands:
  build [--target <control|experiment>] Build Docker images (both by default, or single target)
  start-containers                      Start Docker containers
  start-servers                         Start Rails servers via Overmind
  run-cmd <target> <cmd>                Run a command in a container interactively
  run-cmd-parallel <cmd>                Run a command in both containers in parallel
  run-overmind-command <target> <cmd>   Run a command in a container with PID tracking (for Procfile)
  sync-changes <target>                 Sync git changes to control or experiment volume
  say <message>                         Speak a message using text-to-speech (macOS/Linux)

  <target> is either "control" or "experiment"

Options:
  -c, --config <file>    Config file path (.js or .ts)
                         Default: twin-servers.config.ts in current directory
  -t, --target <target>  Build target (control or experiment) - for build command only
  -v, --verbose          Verbose output
  -h, --help             Show this help message
      --version          Show version

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

  # Specify config explicitly
  shaka-twin-servers build -c path/to/twin-servers.config.ts
`;

const VALID_COMMANDS: Command[] = ['build', 'start-containers', 'start-servers', 'run-cmd', 'run-cmd-parallel', 'run-overmind-command', 'sync-changes', 'say'];

function showHelp(): void {
  console.log(HELP);
}

function showVersion(): void {
  console.log(`shaka-twin-servers v${VERSION}`);
}

function requireTarget(target: string | undefined, usage: string): asserts target is 'control' | 'experiment' {
  if (!target || (target !== 'control' && target !== 'experiment')) {
    console.error(colorize('Error: Target must be "control" or "experiment"', 'red'));
    console.error(`Usage: ${usage}`);
    process.exit(2);
  }
}

function requireCommand(cmd: string | undefined, usage: string): asserts cmd is string {
  if (!cmd) {
    console.error(colorize('Error: Command required', 'red'));
    console.error(`Usage: ${usage}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      target: { type: 'string', short: 't' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.version) {
    showVersion();
    process.exit(0);
  }

  const command = positionals[0] as Command | undefined;

  if (!command) {
    console.error(colorize('Error: No command specified', 'red'));
    console.error('Run with --help for usage information');
    process.exit(2);
  }

  if (!VALID_COMMANDS.includes(command)) {
    console.error(colorize(`Error: Unknown command '${command}'`, 'red'));
    console.error(`Valid commands: ${VALID_COMMANDS.join(', ')}`);
    process.exit(2);
  }

  // Handle commands that don't require config
  if (command === 'say') {
    const message = positionals.slice(1).join(' ');
    await say(message);
    process.exit(0);
  }

  let configPath = values.config;
  if (!configPath) {
    configPath = findConfigFile() ?? undefined;
    if (!configPath) {
      console.error(colorize('Error: No config file found', 'red'));
      console.error('Create a twin-servers.config.ts file or specify one with --config');
      process.exit(2);
    }
    if (values.verbose) {
      console.log(`Using config: ${configPath}`);
    }
  }

  let resolvedConfig;
  try {
    const userConfig = await loadConfig(configPath);
    resolvedConfig = resolveConfig(userConfig);
  } catch (error) {
    console.error(colorize(`Error loading config: ${(error as Error).message}`, 'red'));
    process.exit(2);
  }

  try {
    const options = { verbose: values.verbose };

    switch (command) {
      case 'build': {
        let target: BuildTarget | undefined;
        if (values.target) {
          if (values.target !== 'control' && values.target !== 'experiment') {
            console.error(colorize('Error: --target must be "control" or "experiment"', 'red'));
            process.exit(2);
          }
          target = values.target;
        }
        await build(resolvedConfig, { ...options, target });
        break;
      }
      case 'start-containers':
        await startContainers(resolvedConfig, options);
        break;
      case 'start-servers':
        await startServers(resolvedConfig, options);
        break;
      case 'run-cmd': {
        const target = positionals[1];
        const cmd = positionals.slice(2).join(' ') || undefined;
        const usage = 'shaka-twin-servers run-cmd <control|experiment> <command>';
        requireTarget(target, usage);
        requireCommand(cmd, usage);
        await runCmd(resolvedConfig, target, cmd, options);
        break;
      }
      case 'run-cmd-parallel': {
        const cmd = positionals.slice(1).join(' ') || undefined;
        const usage = 'shaka-twin-servers run-cmd-parallel <command>';
        requireCommand(cmd, usage);
        await runCmdParallel(resolvedConfig, cmd, options);
        break;
      }
      case 'run-overmind-command': {
        const target = positionals[1];
        const cmd = positionals.slice(2).join(' ') || undefined;
        const usage = 'shaka-twin-servers run-overmind-command <control|experiment> <command>';
        requireTarget(target, usage);
        requireCommand(cmd, usage);
        await runOvermindCommand(resolvedConfig, target, cmd, options);
        break;
      }
      case 'sync-changes': {
        const target = positionals[1];
        const usage = 'shaka-twin-servers sync-changes <control|experiment>';
        requireTarget(target, usage);
        await syncChanges(resolvedConfig, target, options);
        break;
      }
    }
  } catch (error) {
    console.error(colorize(`Error: ${(error as Error).message}`, 'red'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(colorize(`Unexpected error: ${error.message}`, 'red'));
  process.exit(2);
});
