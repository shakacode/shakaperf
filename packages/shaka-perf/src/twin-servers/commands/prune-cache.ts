/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ResolvedConfig } from '../types';
import {
  assertProjectBuildxBuilderIsIsolated,
  projectBuildxBuilderName,
} from '../helpers/docker';
import { exec, requireCommand } from '../helpers/shell';
import { printInfo, printSuccess } from '../helpers/ui';

/** Prune only the BuildKit cache owned by this twin-servers project. */
export async function pruneBuildCache(config: ResolvedConfig): Promise<void> {
  requireCommand('docker', 'Install Docker from https://docs.docker.com/get-docker/');

  const builderName = projectBuildxBuilderName(config.projectSlug);
  const inspect = await exec('docker', ['buildx', 'inspect', builderName], { silent: true });
  if (inspect.code !== 0) {
    printInfo(`No project Buildx builder found: ${builderName}`);
    console.log('There is no isolated build cache to prune yet.');
    return;
  }
  assertProjectBuildxBuilderIsIsolated(builderName, inspect.stdout);

  // `buildx create` registers a docker-container builder before its BuildKit
  // container exists. Bootstrapping makes `prune-cache` work even when it is
  // the first command run after builder creation (before any image build).
  const bootstrap = await exec(
    'docker',
    ['buildx', 'inspect', '--bootstrap', builderName],
    { silent: true },
  );
  if (bootstrap.code !== 0) {
    throw new Error(`Failed to start project Buildx builder ${builderName}`);
  }

  console.log(`Pruning BuildKit cache for ${builderName}...`);
  const result = await exec(
    'docker',
    ['buildx', 'prune', '--builder', builderName, '--all', '--force'],
  );
  if (result.code !== 0) {
    throw new Error(`Failed to prune Buildx cache for ${builderName}`);
  }

  printSuccess(`Pruned project Buildx cache: ${builderName}`);
}
