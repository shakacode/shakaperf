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
import {
  addCompareMeasurementOptions,
  type CompareMeasurementOptionDefaults,
} from './shared-options';

export function createCompareCommand(
  optionDefaults?: CompareMeasurementOptionDefaults,
): Command {
  const validCategories = comparePipelineMetadata.categories;
  const validStages = comparePipelineMetadata.stages;
  const compare = new Command('compare')
    .description(comparePipelineMetadata.description)
    .option(
      '--skip-stages <list>',
      `Comma-separated list of exact stages to skip (${validStages.join(', ')})`,
    )
    .option(
      '--restart-from-stage <stage>',
      `Restart from this stage: discard its results and all later stages' results, then re-run them; earlier stages' results are preserved (${validStages.join(', ')})`,
    )
    .option('--report-only', 'Re-render the HTML report from existing compare-results/ stage outcomes without re-running engines. Complements --skip-report for sharded CI assembly.', false)
    .option('--skip-report', 'Run the engines but do not produce the top-level report.html / report.json. Intended for CI shards; engine errors are persisted so a later --report-only run can include them.', false)
    .option('--keep-old-results', 'Do not wipe compare-results/ before running. Engines still overwrite the files they produce, but unrelated artifacts from a prior run survive instead of being cleared.', false)
    .option('--full-report-zip', 'After the run, bundle the full report and all its artifacts into full-report.zip. Off by default — the archive can be large.', false)
    .option('--burn <number>', BURN_OPTION_DESCRIPTION)
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
        });
        printReportSummary(result);
        reportPipelineFailure(result);
      });
    });
  addCompareMeasurementOptions(compare, {
    defaults: optionDefaults,
    categoriesDefault: validCategories.join(','),
  });
  return compare;
}
