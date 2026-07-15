/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
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
      'Measure the good ref on the experiment side before midpoint search',
      false,
    )
    .action(async function (goodRef?: string, badRef?: string) {
      const local = this.opts();
      const inherited = this.optsWithGlobals();
      await (deps.run ?? runCompareBisectFromCli)(goodRef, badRef, {
        configPath: inherited.config,
        categories: local.categories ?? inherited.categories,
        filter: inherited.filter,
        testPathPattern: inherited.testPathPattern,
        headed: inherited.headed === true,
        controlURL: inherited.controlURL,
        experimentURL: inherited.experimentURL,
        reuseCurrentResults: local.reuseCurrentResults === true,
        dryRun: local.dryRun === true,
        validateGoodRef: local.validateGoodRef === true,
      });
    });
}
