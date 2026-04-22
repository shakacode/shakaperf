import { Command } from 'commander';
import { DEFAULT_EXPERIMENT_URL } from 'shaka-shared';
import { runAxeCommand } from './run';

export interface CreateAxeCommandOptions {
  experimentURLDefault?: string;
}

/**
 * V1 standalone `shaka-perf axe` command. Loads `abtests.config.ts`, runs axe
 * against the experiment server for every matched test, writes per-test
 * `<slug>/axe-report.json` artifacts, and sets a non-zero exit code when
 * violations (with `failOnViolation: true`) or engine errors are present.
 */
export function createAxeCommand(options: CreateAxeCommandOptions = {}): Command {
  const experimentURLDefault = options.experimentURLDefault ?? DEFAULT_EXPERIMENT_URL;
  return new Command('axe')
    .description(
      'Run @axe-core/playwright against every ab-test on the experiment server and write per-test axe-report.json artifacts',
    )
    .option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)')
    .option(
      '--testPathPattern <regex>',
      'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)',
    )
    .option(
      '--filter <value>',
      'Regex/substring to filter tests by name (comma-separated for multiple), OR a path to a single .abtest.ts/.abtest.js file',
    )
    .option('--experimentURL <url>', 'Experiment server URL', experimentURLDefault)
    .action(async function (this: Command) {
      const opts = this.opts();
      const result = await runAxeCommand({
        configPath: opts.config,
        experimentURL: opts.experimentURL,
        testPathPattern: opts.testPathPattern,
        filter: opts.filter,
      });
      console.log(`\nResults: ${result.resultsRoot}`);
      if (result.hasFailures) {
        console.error(`\nFAILED: ${result.failureSummary}`);
        process.exitCode = 1;
      }
    });
}
