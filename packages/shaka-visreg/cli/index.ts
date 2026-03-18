#!/usr/bin/env node

import { Command } from 'commander';
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
  .action(function (this: Command) { runCommand('init', this); });

program
  .command('liveCompare')
  .description('Open reference and test URLs simultaneously, compare side-by-side with retry logic.')
  .option('--testFile <path>', 'Path to a specific .abtest.ts/.abtest.js file (if omitted, auto-discovers *.abtest.ts and *.abtest.js files in cwd)')
  .option('--testPathPattern <regex>', "Regex to filter auto-discovered test files by path (like Jest's --testPathPattern)")
  .option('--controlURL <url>', 'Control server URL', 'http://localhost:3020')
  .option('--experimentURL <url>', 'Experiment server URL', 'http://localhost:3030')
  .option('--filter <regex>', 'A RegEx string used to filter scenarios by label')
  .action(function (this: Command) { runCommand('liveCompare', this); });

program
  .command('openReport')
  .description('View the last test report in your browser.')
  .action(function (this: Command) { runCommand('openReport', this); });

program.parse();
