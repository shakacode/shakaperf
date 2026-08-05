/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import type { ResolvedConfig } from '../types';
import { requireCommand, confirm, exec, runInParallel } from '../helpers/shell';
import {
  getGitSha,
  getGitBranch,
  getUserId,
  getGroupId,
  getUsername,
  ensureProjectBuildxBuilder,
} from '../helpers/docker';
import { getGitRemoteUrl, getDefaultBranch } from '../helpers/git';
import { printBanner, printSuccess, printError, printInfo } from '../helpers/ui';
import { invalidateImageCreated, recordBuildAttempt, recordBuildManifest } from '../helpers/rebuild-check';
import { prepareDockerfileWithDefaults } from '../helpers/dockerignore';
import { dockerBuildDirForSide, dockerfilePathForSide } from '../helpers/project-paths';

export type BuildTarget = 'control' | 'experiment';

export interface BuildOptions {
  verbose?: boolean;
  /** Build only a single target (control or experiment). If not specified, builds both. */
  target?: BuildTarget;
  /** Disable Docker layer cache (docker buildx build --no-cache). */
  noCache?: boolean;
}

function buildDockerCmd(
  serverType: 'control' | 'experiment',
  config: ResolvedConfig,
  builderName: string,
  noCache?: boolean,
): { cmd: string; cwd: string; cleanup: () => void } {
  const isControl = serverType === 'control';
  const imageName = isControl ? config.images.control : config.images.experiment;
  const buildDir = dockerBuildDirForSide(config, serverType);
  const configuredDockerfilePath = dockerfilePathForSide(config, serverType);
  const prepared = prepareDockerfileWithDefaults(buildDir, configuredDockerfilePath);

  const args = [
    'buildx', 'build',
    '--builder', builderName,
    '--load',
    '--progress=plain',
    '-t', imageName,
    '-f', prepared.dockerfilePath,
  ];
  if (noCache) args.push('--no-cache');
  const buildArgs: Record<string, string> = {
    ...config.dockerBuildArgs,
    UID: getUserId(),
    GID: getGroupId(),
    NON_ROOT_USER: getUsername(),
  };
  for (const [key, value] of Object.entries(buildArgs)) {
    args.push('--build-arg', `${key}=${value}`);
  }
  args.push('.');

  const escaped = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  return { cmd: `docker ${escaped}`, cwd: buildDir, cleanup: prepared.cleanup };
}

async function buildServer(
  serverType: 'control' | 'experiment',
  config: ResolvedConfig,
  builderName: string,
  options: { verbose?: boolean; noCache?: boolean } = {},
): Promise<void> {
  const { cmd, cwd, cleanup } = buildDockerCmd(serverType, config, builderName, options.noCache);

  console.log(`Building ${serverType} from ${cwd}...`);
  if (options.verbose) {
    const isControl = serverType === 'control';
    const imageName = isControl ? config.images.control : config.images.experiment;
    const dockerfilePath = dockerfilePathForSide(config, serverType);
    console.log(`  Image: ${imageName}`);
    console.log(`  Buildx builder: ${builderName}`);
    console.log(`  Dockerfile: ${dockerfilePath}`);
    console.log(`  Git SHA: ${getGitSha(cwd)}`);
  }

  try {
    const result = await exec('bash', ['-c', `cd '${cwd.replace(/'/g, "'\\''")}' && ${cmd}`]);
    if (result.code !== 0) {
      throw new Error(`Docker build failed for ${serverType}`);
    }
  } finally {
    cleanup();
  }

  console.log(`Finished building ${serverType}`);
}

async function buildInParallel(config: ResolvedConfig, builderName: string, noCache?: boolean): Promise<void> {
  const preparedBuilds: Array<ReturnType<typeof buildDockerCmd>> = [];

  try {
    const experiment = buildDockerCmd('experiment', config, builderName, noCache);
    preparedBuilds.push(experiment);
    const control = buildDockerCmd('control', config, builderName, noCache);
    preparedBuilds.push(control);
    await runInParallel(
      `cd '${experiment.cwd}' && ${experiment.cmd}`,
      `cd '${control.cwd}' && ${control.cmd}`,
    );
  } finally {
    for (const prepared of preparedBuilds) prepared.cleanup();
  }
}

export async function build(config: ResolvedConfig, options: BuildOptions = {}): Promise<void> {
  const { verbose, target, noCache } = options;

  const buildingBoth = !target;
  const buildingControl = target === 'control' || buildingBoth;
  const buildingExperiment = target === 'experiment' || buildingBoth;

  if (target) {
    printBanner(`Building ${target} Docker Image`);
  } else {
    printBanner('Building Twin Servers Docker Images');
  }

  requireCommand('docker', 'Install Docker from https://docs.docker.com/get-docker/');

  // Only check controlDir if building control image
  if (buildingControl && !fs.existsSync(config.controlDir)) {
    const cloneTarget = dockerBuildDirForSide(config, 'control');
    const experimentBuildDir = dockerBuildDirForSide(config, 'experiment');
    const remoteUrl = getGitRemoteUrl(experimentBuildDir);
    const defaultBranch = getDefaultBranch(experimentBuildDir);

    console.log(`Remote:${remoteUrl} Default Branch:${defaultBranch}`)

    if (!remoteUrl) {
      printError(`Control directory not found: ${config.controlDir}`);
      console.log('The control directory should contain the baseline version of your code.');
      console.log(`Clone your repo to: ${cloneTarget}`);
      process.exit(1);
    }

    printInfo(`Control directory not found: ${config.controlDir}`);
    console.log('');
    console.log('To build the control image, we need a checkout of the baseline branch.');
    console.log(`  git clone ${remoteUrl} ${cloneTarget}`);
    console.log('');

    const yes = await confirm('Clone now?');
    if (!yes) {
      console.log('Skipping. Clone manually and re-run the build.');
      process.exit(1);
    }

    console.log('');
    console.log(`Cloning ${remoteUrl} to ${cloneTarget}...`);
    const result = await exec('git', ['clone', remoteUrl, cloneTarget]);
    if (result.code !== 0) {
      printError('Clone failed');
      process.exit(1);
    }
    printSuccess('Clone complete');
    console.log('');
  }

  console.log('Creating bind-mount directories...');
  if (buildingControl) {
    fs.mkdirSync(config.volumes.control, { recursive: true });
    console.log(`   ${config.volumes.control}`);
  }
  if (buildingExperiment) {
    fs.mkdirSync(config.volumes.experiment, { recursive: true });
    console.log(`   ${config.volumes.experiment}`);
  }
  console.log('');

  const builderName = await ensureProjectBuildxBuilder(config);
  console.log(`Using project Buildx builder: ${builderName}`);
  console.log('');

  if (target) {
    console.log(`Building ${target} Docker image...`);
    console.log('');
    await buildServer(target, config, builderName, { verbose, noCache });
    invalidateImageCreated(config.images[target]);
    recordBuildAttempt(config.volumes[target]);
    recordBuildManifest(config, target);
  } else {
    console.log('Building both Docker images in parallel...');
    console.log('');
    await buildInParallel(config, builderName, noCache);
    invalidateImageCreated(config.images.experiment);
    invalidateImageCreated(config.images.control);
    recordBuildAttempt(config.volumes.experiment);
    recordBuildAttempt(config.volumes.control);
    recordBuildManifest(config, 'experiment');
    recordBuildManifest(config, 'control');
  }

  console.log('');
  printSuccess('Docker image(s) built successfully!');
  console.log('');
  console.log('Images created:');
  if (buildingExperiment) {
    console.log(`  - ${config.images.experiment} (current branch: ${getGitBranch(dockerBuildDirForSide(config, 'experiment'))})`);
  }
  if (buildingControl) {
    console.log(`  - ${config.images.control} (baseline branch: ${getGitBranch(dockerBuildDirForSide(config, 'control'))})`);
  }
  console.log('');
  console.log('Bind-mount directories:');
  if (buildingControl) {
    console.log(`  - Control: ${config.volumes.control}`);
  }
  if (buildingExperiment) {
    console.log(`  - Experiment: ${config.volumes.experiment}`);
  }
  console.log('');
  if (buildingBoth) {
    console.log('Next steps:');
    console.log('  yarn shaka-perf servers start-containers');
    console.log('');
  }
}
