/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import { checkoutBranch, findMergeBaseAgainstDefault } from '../helpers/checkout';
import { printBanner, printSuccess, printError } from '../helpers/ui';

export interface CheckoutOptions {
  verbose?: boolean;
  /** After an experiment checkout, move control to the merge base with the default branch. */
  controlMergeBase?: boolean;
}

export async function checkout(
  config: ResolvedConfig,
  target: 'control' | 'experiment',
  ref: string,
  options: CheckoutOptions = {},
): Promise<void> {
  printBanner(`Checking out ${target}`);

  const dir = target === 'control' ? config.controlDir : config.experimentDir;
  const result = await checkoutBranch(dir, ref, { verbose: options.verbose });
  if (!result.ok) {
    printError(`${target} checkout failed: ${result.message}`);
    process.exit(1);
  }
  printSuccess(`${target}: ${result.message}`);

  if (!options.controlMergeBase) return;

  const mb = findMergeBaseAgainstDefault(config.experimentDir);
  if (!mb) {
    printError('cannot determine the merge base of experiment with the default branch');
    process.exit(1);
  }
  console.log(`Merge base of experiment with ${mb.defaultBranch}: ${mb.shortSha}`);
  const controlResult = await checkoutBranch(config.controlDir, mb.sha, { verbose: options.verbose });
  if (!controlResult.ok) {
    printError(`control checkout failed: ${controlResult.message}`);
    process.exit(1);
  }
  printSuccess(`control: ${controlResult.message}`);
}
