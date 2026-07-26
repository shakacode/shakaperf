/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { comparePipelineMetadata } from '../compare-pipeline';
import { runCompareBisectFromCli, type BisectCliOptions } from './session';

export interface BisectCliDependencies {
  run?: (
    goodRef: string | undefined,
    badRef: string | undefined,
    options: BisectCliOptions,
  ) => Promise<unknown>;
}

export function createBisectCommand(deps: BisectCliDependencies = {}): Command {
  return new Command('bisect')
    .description('Find the first commit for each compare regression')
    .argument('[good-ref]', 'Known-good commit; defaults to control HEAD')
    .argument('[bad-ref]', 'Known-bad commit; defaults to experiment HEAD')
    .option(
      '--categories <list>',
      `Comma-separated categories to bisect (${comparePipelineMetadata.categories.join(', ')})`,
    )
    .option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)')
    .option(
      '--filter <value>',
      'Regex/substring to filter tests by name (comma-separated for multiple), OR a path to a single .abtest.ts/.abtest.js file',
    )
    .option('--testPathPattern <regex>', 'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)')
    .option('--headed', 'Launch the measurement browser headed (visible window) instead of headless. Off by default.', false)
    .option('--controlURL <url>', 'Control server URL')
    .option('--experimentURL <url>', 'Experiment server URL')
    .option(
      '--reuse-current-results',
      'Use cwd/compare-results for bad-ref discovery instead of measuring the bad ref again',
      false,
    )
    .option(
      '--dry-run',
      'Discover bad-ref targets and show the next bisect action without continuing',
      false,
    )
    .option(
      '--validate-good-ref',
      'Measure the good ref on the experiment side before native Git search',
      false,
    )
    .option(
      '--report-only',
      'Re-render compare-bisect-results/bisect-report.html from saved bisect report data',
      false,
    )
    .option('--resume', 'Continue the latest compatible saved bisect session', false)
    .option(
      '--investigate-merges',
      'After primary results, inspect eligible bad merge sources',
      false,
    )
    .action(async function (goodRef?: string, badRef?: string) {
      const local = this.opts();
      const reportOnly = local.reportOnly === true;
      if (local.resume && (goodRef || badRef)) {
        throw new Error('--resume does not accept positional good-ref or bad-ref values');
      }
      if (local.resume && local.reuseCurrentResults) {
        throw new Error('--resume cannot be combined with --reuse-current-results');
      }
      if (local.resume && local.dryRun) {
        throw new Error('--resume cannot be combined with --dry-run');
      }
      if (local.resume && local.validateGoodRef) {
        throw new Error('--resume cannot be combined with --validate-good-ref');
      }
      if (reportOnly && (local.resume || local.investigateMerges)) {
        throw new Error('--report-only cannot be combined with resume or merge investigation');
      }
      await (deps.run ?? runCompareBisectFromCli)(goodRef, badRef, {
        configPath: local.config,
        categories: local.categories,
        filter: local.filter,
        testPathPattern: local.testPathPattern,
        headed: local.headed === true,
        controlURL: local.controlURL,
        experimentURL: local.experimentURL,
        reuseCurrentResults: local.reuseCurrentResults === true,
        dryRun: local.dryRun === true,
        validateGoodRef: local.validateGoodRef === true,
        reportOnly,
        resume: local.resume === true,
        investigateMerges: local.investigateMerges === true,
      });
    });
}
