import { Command } from 'commander';
import { addCompareOptions } from 'shaka-shared';
import runner from '../core/runner';

export function createVisregProgram(): Command {
  const program = new Command('visreg');

  program
    .description('Visual regression testing for web applications')
    .option('--config <path>', 'Path to visreg config file (default: visreg.config.ts)');

  async function runCommand(commandName: string, command: Command) {
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
    try {
      await runner(commandName, argsOptions);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  }

  program
    .command('init')
    .description('Generate boilerplate config files in your CWD.')
    .action(async function (this: Command) { await runCommand('init', this); });

  const compareCmd = program
    .command('compare')
    .description('Open reference and test URLs simultaneously, compare side-by-side with retry logic.')
    .action(async function (this: Command) { await runCommand('compare', this); });
  addCompareOptions(compareCmd);

  return program;
}
