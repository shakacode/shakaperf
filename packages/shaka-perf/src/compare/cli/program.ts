import { Command } from 'commander';
import { addCompareOptions } from 'shaka-shared';
import { runCompare } from '../run';
import type { Category } from '../report';

const VALID_CATEGORIES: Category[] = ['visreg', 'perf', 'axe'];

function parseCategories(value: string): Category[] {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (!VALID_CATEGORIES.includes(p as Category)) {
      throw new Error(`Unknown category "${p}". Valid: ${VALID_CATEGORIES.join(', ')}`);
    }
  }
  return parts as Category[];
}

export interface CreateCompareCommandOptions {
  controlURLDefault?: string;
  experimentURLDefault?: string;
}

export function createCompareCommand(options: CreateCompareCommandOptions = {}): Command {
  const cmd = new Command('compare')
    .description('Run visreg + perf comparison and produce a single self-contained HTML report')
    .option(
      '--categories <list>',
      `Comma-separated list of categories to run (${VALID_CATEGORIES.join(', ')})`,
      parseCategories,
      VALID_CATEGORIES,
    )
    .option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)')
    .option('--skip-engines', 'Re-harvest and re-render the HTML report from existing compare-results/ artifacts without re-running visreg or perf', false)
    .action(async function (this: Command) {
      const opts = this.opts();
      const result = await runCompare({
        configPath: opts.config,
        categories: opts.categories,
        testPathPattern: opts.testPathPattern,
        filter: opts.filter,
        controlURL: opts.controlURL,
        experimentURL: opts.experimentURL,
        skipEngines: opts.skipEngines === true,
      });
      console.log(`\nReport: ${result.reportPath}`);
      if (result.hasFailures) {
        console.error(`\nFAILED: ${result.failureSummary}`);
        process.exitCode = 1;
      }
    });
  addCompareOptions(cmd, {
    controlURL: options.controlURLDefault,
    experimentURL: options.experimentURLDefault,
  });
  return cmd;
}
