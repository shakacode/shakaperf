#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'node:module';
import runner from '../core/runner.js';

const _require = createRequire(import.meta.url);
const packageJson = _require('../package.json');
const { version } = packageJson;

// Catch errors from failing promises
process.on('unhandledRejection', function (error: Error | undefined) {
  console.error(error && error.stack);
});

const program = new Command();

program
  .name('shaka-visreg')
  .description('Shaka-visreg: Catch CSS curveballs.')
  .version('v' + version, '--version', 'Display version')
  .option('--config <path>', 'Path to config file name', 'backstop.json')
  .option('--filter <regex>', 'A RegEx string used to filter scenarios by label');

function runCommand(commandName: string) {
  const opts = program.opts();
  // Build a minimist-compatible args object for the core runner
  const argsOptions: Record<string, unknown> = {
    _: [commandName],
    config: opts.config,
    filter: opts.filter,
  };

  console.log('shaka-visreg v' + version);
  runner(commandName, argsOptions).catch(function () {
    process.exitCode = 1;
  });

  process.on('uncaughtException', function (err: Error) {
    console.log('Uncaught exception:', err.message, err.stack);
    throw err;
  });
}

program
  .command('init')
  .description('Generate boilerplate config files in your CWD.')
  .action(() => runCommand('init'));

program
  .command('liveCompare')
  .description('Open reference and test URLs simultaneously, compare side-by-side with retry logic.')
  .action(() => runCommand('liveCompare'));

program
  .command('openReport')
  .description('View the last test report in your browser.')
  .action(() => runCommand('openReport'));

program.parse();
