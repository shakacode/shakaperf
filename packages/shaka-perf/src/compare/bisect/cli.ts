/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { runCompareBisectFromCli } from './session';

export interface BisectCliDependencies {
  run?: (goodRef: string | undefined, badRef: string | undefined, command: Command) => Promise<void>;
}

export function createBisectCommand(deps: BisectCliDependencies = {}): Command {
  return new Command('bisect')
    .description('Find the first commit for each compare regression')
    .argument('[good-ref]', 'Known-good commit; defaults to control HEAD')
    .argument('[bad-ref]', 'Known-bad commit; defaults to experiment HEAD')
    .action(async function (goodRef?: string, badRef?: string) {
      const parentOptions = this.parent?.opts() ?? {};
      await (deps.run ?? ((good, bad) => runCompareBisectFromCli(good, bad, {
        configPath: parentOptions.config,
        categories: parentOptions.categories,
        filter: parentOptions.filter,
        testPathPattern: parentOptions.testPathPattern,
        headed: parentOptions.headed === true,
      })))(goodRef, badRef, this);
    });
}
