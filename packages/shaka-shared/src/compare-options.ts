import type { Command } from 'commander';

export const DEFAULT_CONTROL_URL = 'http://localhost:3020';
export const DEFAULT_EXPERIMENT_URL = 'http://localhost:3030';

export interface CompareBaseOptions {
  testFile?: string;
  testPathPattern?: string;
  controlURL: string;
  experimentURL: string;
}

export function addCompareOptions(command: Command): Command {
  return command
    .option('--testFile <path>', 'Path to a specific test file containing abTest() calls')
    .option('--testPathPattern <regex>', 'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)')
    .option('--controlURL <url>', 'Control server URL', DEFAULT_CONTROL_URL)
    .option('--experimentURL <url>', 'Experiment server URL', DEFAULT_EXPERIMENT_URL);
}
