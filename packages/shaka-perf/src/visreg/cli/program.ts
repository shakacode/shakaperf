import { Command } from 'commander';
import { addCompareOptions } from 'shaka-shared';
import runner from '../core/runner';

export function createVisregProgram(): Command {
  const program = new Command('visreg');

  program
    .description('Visual regression testing for web applications')
    .option('--config <path>', 'Path to visreg config file (default: visreg.config.ts)');

  // Catch errors from failing promises
  process.on('unhandledRejection', function (error: Error | undefined) {
    console.error(error && error.stack);
  });

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

    const packageJson = require('../../../package.json');
    console.log('shaka-perf visreg v' + packageJson.version);
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

  return program;
}
