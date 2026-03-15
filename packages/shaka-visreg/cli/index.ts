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
  .option('--config <path>', 'Path to visreg config file (default: visreg.config.ts)')
  .requiredOption('--testFile <path>', 'Path to .bench.ts test file (loads scenarios from abTest registry)')
  .option('--controlURL <url>', 'Control server URL', 'http://localhost:3020')
  .option('--experimentURL <url>', 'Experiment server URL', 'http://localhost:3030')
  .option('--filter <regex>', 'A RegEx string used to filter scenarios by label');

function runCommand(commandName: string) {
  const opts = program.opts();
  // Build args object for the core runner
  const argsOptions: Record<string, unknown> = {
    _: [commandName],
    config: opts.config,
    testFile: opts.testFile,
    controlURL: opts.controlURL,
    experimentURL: opts.experimentURL,
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
