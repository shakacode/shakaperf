import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { ResolvedConfig } from '../types';
import { requireCommand } from '../helpers/shell';
import {
  dockerBuild,
  getGitSha,
  getGitBranch,
  getUserId,
  getGroupId,
  getUsername,
} from '../helpers/docker';
import { printBanner, printSuccess, printError } from '../helpers/ui';

export type BuildTarget = 'control' | 'experiment';

export interface BuildOptions {
  verbose?: boolean;
  /** Build only a single target (control or experiment). If not specified, builds both. */
  target?: BuildTarget;
}

interface BuildServerOptions {
  serverType: 'control' | 'experiment';
  config: ResolvedConfig;
  verbose?: boolean;
}

async function buildServer(options: BuildServerOptions): Promise<void> {
  const { serverType, config, verbose } = options;

  const isControl = serverType === 'control';
  const imageName = isControl ? config.images.control : config.images.experiment;
  const buildDir = isControl ? path.dirname(config.controlDir) : config.dockerBuildDir;
  const gitSha = getGitSha(buildDir);

  const projectName = path.basename(config.projectDir);
  const dockerfilePath = path.join(projectName, 'Dockerfile.production');

  console.log(`Building ${serverType} from ${buildDir}...`);
  if (verbose) {
    console.log(`  Image: ${imageName}`);
    console.log(`  Dockerfile: ${dockerfilePath}`);
    console.log(`  Git SHA: ${gitSha}`);
  }

  await dockerBuild({
    imageName,
    dockerfile: dockerfilePath,
    buildContext: buildDir,
    buildArgs: {
      ...config.dockerBuildArgs,
      UID: getUserId(),
      GID: getGroupId(),
      NON_ROOT_USER: getUsername(),
    },
  });

  console.log(`Finished building ${serverType}`);
}

async function buildInParallel(config: ResolvedConfig, verbose?: boolean): Promise<void> {
  const buildPromises = (['experiment', 'control'] as const).map((serverType) =>
    buildServer({ serverType, config, verbose })
  );

  const results = await Promise.allSettled(buildPromises);

  const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (failures.length > 0) {
    const errors = failures.map((f) => f.reason?.message || String(f.reason)).join('\n');
    throw new Error(`Build failed:\n${errors}`);
  }
}

export async function build(config: ResolvedConfig, options: BuildOptions = {}): Promise<void> {
  const { verbose, target } = options;

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
    printError(`Control directory not found: ${config.controlDir}`);
    console.log('The control directory should contain the baseline version of your code.');
    process.exit(1);
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

  if (target) {
    console.log(`Building ${target} Docker image...`);
    console.log('');
    await buildServer({ serverType: target, config, verbose });
  } else {
    console.log('Building both Docker images in parallel...');
    console.log('');
    await buildInParallel(config, verbose);
  }

  console.log('');
  printSuccess('Docker image(s) built successfully!');
  console.log('');
  console.log('Images created:');
  if (buildingExperiment) {
    console.log(`  - ${config.images.experiment} (current branch: ${getGitBranch(config.dockerBuildDir)})`);
  }
  if (buildingControl) {
    console.log(`  - ${config.images.control} (baseline branch: ${getGitBranch(path.dirname(config.controlDir))})`);
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
    console.log('  shaka-twin-servers start-containers');
    console.log('');
  }
}
