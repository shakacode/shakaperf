/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command, Option } from 'commander';
import { withAbTestsConfigPath } from '../../before-navigate';
import { findAbTestsConfig, loadAbTestsConfig } from '../../config-loader';
import { parseAbTestsConfig, viewportsByStageCategory } from '../../config';
import { runPipeline } from '../../pipeline/runner';
import { BURN_OPTION_DESCRIPTION, parseBurnOption } from '../../pipeline/burn';
import { printReportSummary, reportPipelineFailure } from '../../pipeline/report-summary';
import { createComparePipeline, comparePipelineMetadata } from '../compare-pipeline';
import { pairedBenchmarkParallelism } from '../stages/shared/runtime';
import { getCLIDefaultsFromConfig } from '../../cli-defaults';

export async function createCompareCommand(): Promise<Command> {
  const validCategories = comparePipelineMetadata.categories;
  const validStages = comparePipelineMetadata.stages;
  const defaults = await getCLIDefaultsFromConfig(process.argv, (c) => ({
    controlURL: c.shared.controlURL,
    experimentURL: c.shared.experimentURL,
  }));
  return new Command('compare')
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
    .addOption(new Option(
      '--resume-from-stage <stage>',
      'Deprecated alias for --restart-from-stage',
    ).hideHelp())
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
      await withAbTestsConfigPath(configPath, async () => {
        const raw = configPath ? await loadAbTestsConfig(configPath) : {};
        const config = parseAbTestsConfig(raw);
        const burn = parseBurnOption(opts.burn);
        const pipeline = createComparePipeline({
          parallelism: pairedBenchmarkParallelism(config.shared.parallelism),
          testPathPattern: opts.testPathPattern ?? config.shared.testPathPattern,
          visregDefaultMisMatchThreshold: config.visreg.defaultMisMatchThreshold,
          visregMaxNumDiffPixels: config.visreg.maxNumDiffPixels,
          visregComparePixelmatchThreshold: config.visreg.comparePixelmatchThreshold,
          visregEngineOptions: config.visreg.engineOptions,
          visregResembleOutputOptions: config.visreg.resembleOutputOptions,
          // Burn replaces retries, visreg's best-of-N included.
          visregCompareRetries: burn == null ? config.visreg.compareRetries : 0,
          visregCompareRetryDelay: config.visreg.compareRetryDelay,
          perfNumberOfMeasurements: config.perf.numberOfMeasurements,
          perfRegressionThreshold: config.perf.regressionThreshold,
          perfPValueThreshold: config.perf.pValueThreshold,
          perfRegressionThresholdStat: config.perf.regressionThresholdStat,
          perfSamplingMode: config.perf.samplingMode,
          perfLighthouseConfig: config.perf.lighthouseConfig,
          perfPlotTitle: config.perf.plotTitle,
          accessibility: config.accessibility,
        });
        const restartFromStage = opts.restartFromStage ?? opts.resumeFromStage;
        const result = await runPipeline(pipeline, {
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
          viewports: viewportsByStageCategory(config),
        });
        printReportSummary(result);
        reportPipelineFailure(result);
      });
    });
}
