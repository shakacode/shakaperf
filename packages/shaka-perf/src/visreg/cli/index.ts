#!/usr/bin/env node

import { Command } from 'commander';
import { addCompareOptions } from 'shaka-shared';
import runner from '../core/runner';

const packageJson = require('../package.json');
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
  .option('--config <path>', 'Path to visreg config file (default: visreg.config.ts)');

function runCommand(commandName: string, command: Command) {
  const globalOpts = program.opts();
  const cmdOpts = command.opts();
  const argsOptions: Record<string, unknown> = {
    _: [commandName],
    config: globalOpts.config,
    testFile: cmdOpts.testFile,
    testPathPattern: cmdOpts.testPathPattern,
    controlURL: cmdOpts.controlURL,
    experimentURL: cmdOpts.experimentURL,
    filter: cmdOpts.filter,
  };

  console.log('shaka-perf visreg v' + version);
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
  .action(function (this: Command) { runCommand('init', this); });

const compareCmd = program
  .command('compare')
  .description('Open reference and test URLs simultaneously, compare side-by-side with retry logic.')
  .action(function (this: Command) { runCommand('compare', this); });
addCompareOptions(compareCmd);

program.parse();
