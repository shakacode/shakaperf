/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { withAbTestsConfigPath } from '../../effective-config';
import { findAbTestsConfig, loadAbTestsConfig } from '../../config-loader';
import { buildAbTestsConfig } from '../../config';
import { runPipeline } from '../../pipeline/runner';
import { BURN_OPTION_DESCRIPTION, parseBurnOption } from '../../pipeline/burn';
import { printReportSummary, reportPipelineFailure } from '../../pipeline/report-summary';
import {
  comparePipelineConfigFromAbTests,
  createComparePipeline,
  comparePipelineMetadata,
} from '../compare-pipeline';
import { getCLIDefaultsFromConfig } from '../../cli-defaults';

export async function createCompareCommand(): Promise<Command> {
  const validCategories = comparePipelineMetadata.categories;
  const validStages = comparePipelineMetadata.stages;
  const defaults = await getCLIDefaultsFromConfig(process.argv, (c) => ({
    controlURL: c.shared.controlURL,
    experimentURL: c.shared.experimentURL,
  }));
  const compare = new Command('compare')
    .description(comparePipelineMetadata.description)
    .option(
      '--categories <list>',
      `Comma-separated list of categories to run (${validCategories.join(', ')})`,
      validCategories.join(','),
    )
    .option(
      '--skip-stages <list>',
      `Comma-separated list of exact stages to skip (${validStages.join(', ')})`,
    )
    .option(
      '--restart-from-stage <stage>',
      `Restart from this stage: discard its results and all later stages' results, then re-run them; earlier stages' results are preserved (${validStages.join(', ')})`,
    )
    .option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)')
    .option('--report-only', 'Re-render the HTML report from existing compare-results/ stage outcomes without re-running engines. Complements --skip-report for sharded CI assembly.', false)
    .option('--skip-report', 'Run the engines but do not produce the top-level report.html / report.json. Intended for CI shards; engine errors are persisted so a later --report-only run can include them.', false)
    .option('--keep-old-results', 'Do not wipe compare-results/ before running. Engines still overwrite the files they produce, but unrelated artifacts from a prior run survive instead of being cleared.', false)
    .option('--full-report-zip', 'After the run, bundle the full report and all its artifacts into full-report.zip. Off by default — the archive can be large.', false)
    .option('--headed', 'Launch the measurement browser headed (visible window) instead of headless. Off by default.', false)
    .option('--burn <number>', BURN_OPTION_DESCRIPTION)
    .option('--testPathPattern <regex>', 'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)')
    .option(
      '--filter <value>',
      'Regex/substring to filter tests by name (comma-separated for multiple), OR a path to a single .abtest.ts/.abtest.js file',
    )
    .option('--controlURL <url>', 'Control server URL', defaults?.controlURL)
    .option('--experimentURL <url>', 'Experiment server URL', defaults?.experimentURL)
    .action(async function (this: Command) {
      const opts = this.opts();
      const configPath = opts.config ?? findAbTestsConfig();
      if (!configPath) {
        throw new Error(
          'No abtests.config.ts found — it is required. ' +
          'Run `shaka-perf init` to create one, or pass --config <path>.',
        );
      }
      await withAbTestsConfigPath(configPath, async () => {
        const config = buildAbTestsConfig(await loadAbTestsConfig(configPath));
        const burn = parseBurnOption(opts.burn);
        // Burn replaces retries, visreg's best-of-N included — the visreg
        // stage zeroes compareRetries off `runtime.burn`.
        const pipeline = createComparePipeline(
          comparePipelineConfigFromAbTests(config, {
            testPathPattern: opts.testPathPattern ?? config.shared.testPathPattern,
          }),
        );
        const restartFromStage = opts.restartFromStage;
        const result = await runPipeline(pipeline, {
          config,
          controlURL: opts.controlURL ?? config.shared.controlURL,
          experimentURL: opts.experimentURL ?? config.shared.experimentURL,
          testPathPattern: opts.testPathPattern ?? config.shared.testPathPattern,
          filter: opts.filter ?? config.shared.filter,
          categories: opts.categories,
          skipStages: opts.skipStages,
          restartFromStage,
          reportOnly: opts.reportOnly === true,
          skipReport: opts.skipReport === true,
          keepOldResults: opts.keepOldResults === true,
          fullReportZip: opts.fullReportZip === true,
          headed: opts.headed === true,
          burn,
          retries: config.shared.retries,
          retryDelay: config.shared.retryDelay,
          timeoutMs: config.shared.timeoutMs,
        });
        printReportSummary(result);
        reportPipelineFailure(result);
      });
    });
  return compare;
}
