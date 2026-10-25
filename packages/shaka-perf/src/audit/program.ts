/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { withAbTestsConfigPath } from '../effective-config';
import { findAbTestsConfig, loadAbTestsConfig, loadTests } from '../config-loader';
import { buildAbTestsConfig, resolvePlaywrightOptions } from '../config';
import { runPipeline } from '../pipeline/runner';
import { selectedViewportFilter, VIEWPORT_OPTION_DESCRIPTION } from '../pipeline/viewport-selection';
import { BURN_OPTION_DESCRIPTION, parseBurnOption, expandTestsForBurn } from '../pipeline/burn';
import { printReportSummary, reportPipelineFailure } from '../pipeline/report-summary';
import { testIdForTest } from '../pipeline/unit-id';
import { generateCumulativeCoverageReport } from './stages/code_coverage/cumulative-report';
import { auditPipelineMetadata, createAuditPipeline } from './pipeline';

export interface CreateAuditCommandOptions {
  urlDefault?: string;
}

export function createAuditCommand(options: CreateAuditCommandOptions = {}): Command {
  const validStages = auditPipelineMetadata.stages;
  const validCategories = auditPipelineMetadata.categories;
  const defaultCategories = auditPipelineMetadata.defaultCategories;
  return new Command('audit')
    .description(auditPipelineMetadata.description)
    .option(
      '--categories <list>',
      `Comma-separated list of categories to run (${validCategories.join(', ')}). ` +
      `Defaults to ${defaultCategories.join(',')} — code_coverage is opt-in because it ` +
      're-runs every test body in a second browser to drain instrumented JS coverage and ' +
      'map what the finished page shows inside the capture region.',
      defaultCategories.join(','),
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
    .option('--url <url>', 'Application URL to audit', options.urlDefault)
    .option('--testPathPattern <regex>', 'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)')
    .option(
      '--filter <value>',
      'Regex/substring to filter tests by name (comma-separated for multiple), OR a path to a single .abtest.ts/.abtest.js file',
    )
    .option('--viewport <label>', VIEWPORT_OPTION_DESCRIPTION + ' Cumulative coverage also filters saved records by this label during --report-only.')
    .option('--report-only', 'Re-render the HTML report from existing audit-results/ stage outcomes without re-running engines. Complements --skip-report for sharded CI assembly.', false)
    .option('--skip-report', 'Run the audit engine but do not produce the top-level report.html / report.json. Intended for CI shards; engine errors are persisted so a later --report-only run can include them.', false)
    .option('--keep-old-results', 'Do not wipe audit-results/ before running. Engines still overwrite the files they produce, but unrelated artifacts from a prior run survive instead of being cleared.', false)
    .option('--debug-show-all-frames', 'Diagnostics: also render the FULL, non-deduped screencast timeline alongside the normal (deduped) one. Every synced frame is shown, each annotated with the pixel diff vs the previous frame (the signal the dedupe uses to decide what to drop). Off by default — produces a much heavier report.', false)
    .option('--headed', 'Launch the measurement browser headed (visible window) instead of headless. Off by default.', false)
    .option('--burn <number>', BURN_OPTION_DESCRIPTION)
    .action(async function (this: Command) {
      const opts = this.opts();
      const configPath = opts.config ?? findAbTestsConfig();
      if (!configPath) {
        throw new Error(
          'No abtests.config.ts found — it is required (audit reads its viewports, ' +
          'parallelism, and launch options from it). ' +
          'Run `shaka-perf init` to create one, or pass --config <path>.',
        );
      }
      await withAbTestsConfigPath(configPath, async () => {
        const config = buildAbTestsConfig(await loadAbTestsConfig(configPath));
        const viewportsFilter = selectedViewportFilter(opts.viewport, config);
        const url = opts.url ?? config.shared.experimentURL;
        const coverageReport = String(opts.categories).split(',').map((category) => category.trim()).includes('code_coverage');
        const pipeline = createAuditPipeline({
          coverageReport,
          parallelism: config.shared.parallelism,
          lighthouseConfig: config.audit.lighthouseConfig,
          accessibility: {
            tags: config.accessibility.tags,
            disableRules: config.accessibility.disableRules,
            includeRules: config.accessibility.includeRules,
            playwrightOptions: resolvePlaywrightOptions(config, 'accessibility'),
            failOnViolation: config.accessibility.failOnViolation,
          },
          agentReadiness: {
            enabled: config.agentReadiness.enabled,
            playwrightOptions: resolvePlaywrightOptions(config, 'audit'),
          },
        });
        const restartFromStage = opts.restartFromStage;
        const result = await runPipeline(pipeline, {
          config,
          viewportsFilter: opts.reportOnly ? undefined : viewportsFilter,
          preserveOtherViewports: viewportsFilter !== undefined,
          controlURL: url,
          experimentURL: url,
          testPathPattern: opts.testPathPattern ?? config.shared.testPathPattern,
          filter: opts.filter ?? config.shared.filter,
          categories: opts.categories,
          skipStages: opts.skipStages,
          restartFromStage,
          reportOnly: opts.reportOnly === true,
          skipReport: opts.skipReport === true,
          keepOldResults: opts.keepOldResults === true,
          debugShowAllFrames: opts.debugShowAllFrames === true,
          headed: opts.headed === true,
          burn: parseBurnOption(opts.burn),
        });
        printReportSummary(result);
        if (coverageReport && !opts.skipReport) {
          const selected = await loadTests({
            filter: opts.filter ?? config.shared.filter,
            testPathPattern: opts.testPathPattern ?? config.shared.testPathPattern,
            allowEmpty: true,
          });
          const ids = new Set((opts.burn ? expandTestsForBurn(selected, parseBurnOption(opts.burn)!) : selected).map(testIdForTest));
          try {
            await generateCumulativeCoverageReport({
              resultsRoot: result.resultsRoot,
              configPath,
              config: config.audit.codeCoverage,
              tests: result.testResults.filter((test) => ids.has(test.id)),
              ...(viewportsFilter ? { viewports: viewportsFilter } : {}),
              ...(result.hasFailures ? { engineFailures: [result.failureSummary] } : {}),
            });
          } catch (error) {
            // Report failure must not hide an existing test failure or advertise old HTML.
            console.error(`Coverage report failed: ${error instanceof Error ? error.message : String(error)}`);
            process.exitCode = 1;
          }
        }
        reportPipelineFailure(result);
      });
    });
}

