import { Command } from 'commander';
import { addCompareOptions, DEFAULT_EXPERIMENT_URL } from 'shaka-shared';
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
  const cmd = new Command('axe')
    .description(
      'Run @axe-core/playwright against every ab-test on the experiment server and write per-test axe-report.json artifacts',
    )
    .option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)')
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

  // Accept the same --testPathPattern / --filter / --experimentURL flags as
  // compare so switching between the two commands feels identical. The control
  // URL flag comes along for free but is ignored — axe never scans control.
  addCompareOptions(cmd, {
    experimentURL: options.experimentURLDefault ?? DEFAULT_EXPERIMENT_URL,
  });
  return cmd;
}
