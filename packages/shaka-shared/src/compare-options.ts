import type { Command } from 'commander';

export interface CompareBaseOptions {
  testPathPattern?: string;
  filter?: string;
  controlURL: string;
  experimentURL: string;
}

export interface AddCompareOptionsDefaults {
  controlURL: string;
  experimentURL: string;
}

export function addCompareOptions(command: Command, defaults: AddCompareOptionsDefaults): Command {
  return command
    .option('--testPathPattern <regex>', 'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)')
    .option(
      '--filter <value>',
      'Regex/substring to filter tests by name (comma-separated for multiple), OR a path to a single .abtest.ts/.abtest.js file',
    )
    .option('--controlURL <url>', 'Control server URL', defaults.controlURL)
    .option('--experimentURL <url>', 'Experiment server URL', defaults.experimentURL);
}
