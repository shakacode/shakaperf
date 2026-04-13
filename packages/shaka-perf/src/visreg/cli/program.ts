import { Command } from 'commander';
import { addCompareOptions } from 'shaka-shared';
import runner from '../core/runner';

function addVisregOptions(cmd: Command): Command {
  return cmd.option('--config <path>', 'Path to visreg config file (default: visreg.config.ts)');
}

async function runCommand(commandName: string, command: Command) {
  const cmdOpts = command.opts();
  const argsOptions: Record<string, unknown> = {
    _: [commandName],
    config: cmdOpts.config,
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

export function createVisregCommands(): Command[] {
  const initCmd = new Command('visreg-init')
    .description('Generate boilerplate config files in your CWD.');
  addVisregOptions(initCmd);
  initCmd.action(async function (this: Command) { await runCommand('init', this); });

  const compareCmd = new Command('visreg-compare')
    .description('Open reference and test URLs simultaneously, compare side-by-side with retry logic.');
  addVisregOptions(compareCmd);
  addCompareOptions(compareCmd);
  compareCmd.action(async function (this: Command) { await runCommand('compare', this); });

  return [compareCmd, initCmd];
}
