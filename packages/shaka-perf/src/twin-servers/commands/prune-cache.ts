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

export interface PruneBuildCacheOptions {
  /** Also remove the configured control and experiment Docker images. */
  images?: boolean;
}

async function removeProjectImages(config: ResolvedConfig): Promise<void> {
  const imageNames = [...new Set([
    config.images.control,
    config.images.experiment,
  ])];
  const existingImages: string[] = [];

  for (const imageName of imageNames) {
    const inspect = await exec(
      'docker',
      ['image', 'inspect', imageName],
      { silent: true },
    );
    if (inspect.code === 0) existingImages.push(imageName);
  }

  if (existingImages.length === 0) {
    printInfo('No project Docker images found.');
    return;
  }

  console.log(`Removing project Docker images: ${existingImages.join(', ')}...`);
  const result = await exec('docker', ['image', 'rm', ...existingImages]);
  if (result.code !== 0) {
    throw new Error(
      'Failed to remove project Docker images. ' +
        'Stop containers that reference them with `shaka-perf servers stop-containers`, then retry.',
    );
  }

  printSuccess(`Removed project Docker images: ${existingImages.join(', ')}`);
}

/** Prune the BuildKit cache owned by this project and optionally its images. */
export async function pruneBuildCache(
  config: ResolvedConfig,
  options: PruneBuildCacheOptions = {},
): Promise<void> {
  requireCommand('docker', 'Install Docker from https://docs.docker.com/get-docker/');

  const builderName = projectBuildxBuilderName(config.projectSlug);
  const inspect = await exec('docker', ['buildx', 'inspect', builderName], { silent: true });
  if (inspect.code !== 0) {
    printInfo(`No project Buildx builder found: ${builderName}`);
    console.log('There is no isolated build cache to prune yet.');
  } else {
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

  if (options.images) await removeProjectImages(config);
}
