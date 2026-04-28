import { Command } from 'commander';
import { addCompareOptions, type TestType } from 'shaka-shared';
import { runCompare } from '../run';

// Restricted to the test types compare actually has a harvester for.
// `TestType` itself is broader (`'accessibility'` is in the union but
// has no CategoryDef yet) — extend this list when a harvester lands.
const VALID_CATEGORIES: TestType[] = ['visreg', 'perf'];

function parseCategories(value: string): TestType[] {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (!VALID_CATEGORIES.includes(p as TestType)) {
      throw new Error(`Unknown category "${p}". Valid: ${VALID_CATEGORIES.join(', ')}`);
    }
  }
  return parts as TestType[];
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
    .option('--report-only', 'Re-harvest and re-render the HTML report from existing compare-results/ artifacts without re-running visreg or perf. Complements --skip-report for sharded CI assembly.', false)
    .option('--skip-report', 'Run the engines but do not produce the top-level report.html / report.json. Intended for CI shards; engine errors are persisted so a later --report-only run can include them.', false)
    .action(async function (this: Command) {
      const opts = this.opts();
      const result = await runCompare({
        configPath: opts.config,
        categories: opts.categories,
        testPathPattern: opts.testPathPattern,
        filter: opts.filter,
        controlURL: opts.controlURL,
        experimentURL: opts.experimentURL,
        reportOnly: opts.reportOnly === true,
        skipReport: opts.skipReport === true,
      });
      if (result.reportPath) {
        console.log(`\nReport: ${result.reportPath}`);
      } else {
        console.log('\n--skip-report set: engine artifacts written, top-level report skipped.');
      }
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
