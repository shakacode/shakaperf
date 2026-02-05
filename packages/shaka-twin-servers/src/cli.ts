#!/usr/bin/env node

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { loadConfig, resolveConfig, findConfigFile } from './config';
import { build } from './commands/build';
import { startContainers } from './commands/start-containers';
import { startServers } from './commands/start-servers';
import type { Command } from './types';

const VERSION = '0.0.2';

const HELP = `
shaka-twin-servers - Twin server management for A/B performance testing

Usage:
  shaka-twin-servers <command> [options]

Commands:
  build              Build Docker images for control and experiment servers
  start-containers   Start Docker containers
  start-servers      Start Rails servers via Overmind

Options:
  -c, --config <file>    Config file path (.js or .ts)
                         Default: twin-servers.config.ts in current directory
  -v, --verbose          Verbose output
  -h, --help             Show this help message
      --version          Show version

Examples:
  # Auto-discovers twin-servers.config.ts in current directory
  shaka-twin-servers build
  shaka-twin-servers start-containers
  shaka-twin-servers start-servers

  # Specify config explicitly
  shaka-twin-servers build -c path/to/twin-servers.config.ts
`;

const VALID_COMMANDS: Command[] = ['build', 'start-containers', 'start-servers'];

function showHelp(): void {
  console.log(HELP);
}

function showVersion(): void {
  console.log(`shaka-twin-servers v${VERSION}`);
}

function colorize(text: string, color: 'red' | 'green' | 'yellow'): string {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
  };
  return `${colors[color]}${text}\x1b[0m`;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
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
      case 'build':
        await build(resolvedConfig, options);
        break;
      case 'start-containers':
        await startContainers(resolvedConfig, options);
        break;
      case 'start-servers':
        await startServers(resolvedConfig, options);
        break;
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
