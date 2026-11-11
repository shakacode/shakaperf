/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import { dockerComposeDown, dockerComposeRunningServices } from '../helpers/docker';
import { stopProjectBuildxBuilderSafely } from '../helpers/buildx-lifecycle';
import { printBanner, printSuccess } from '../helpers/ui';

export interface StopContainersOptions {
  verbose?: boolean;
  /** Internal container recreation keeps the session builder available. */
  keepBuilderRunning?: boolean;
}

export async function stopContainers(
  config: ResolvedConfig,
  options: StopContainersOptions = {}
): Promise<void> {
  printBanner('Stopping Twin Servers');

  const runningServices = await dockerComposeRunningServices(config);
  if (runningServices.size > 0) {
    console.log('Stopping containers and removing volumes...');
  } else {
    console.log('No running containers found; removing volumes...');
  }
  await dockerComposeDown(config);
  if (!options.keepBuilderRunning) await stopProjectBuildxBuilderSafely(config);

  if (runningServices.size > 0) {
    printSuccess('Containers stopped');
  } else {
    printSuccess('No containers were running');
  }
}
