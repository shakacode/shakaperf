import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedConfig } from '../types';
import { requireCommand, confirm, exec, runInParallel } from '../helpers/shell';
import {
  getGitSha,
  getGitBranch,
  getUserId,
  getGroupId,
  getUsername,
} from '../helpers/docker';
import { getGitRemoteUrl, getDefaultBranch } from '../helpers/git';
import { printBanner, printSuccess, printError, printInfo } from '../helpers/ui';

export type BuildTarget = 'control' | 'experiment';

export interface BuildOptions {
  verbose?: boolean;
  /** Build only a single target (control or experiment). If not specified, builds both. */
  target?: BuildTarget;
  /** Disable Docker layer cache (docker build --no-cache). */
  noCache?: boolean;
}

function buildDockerCmd(serverType: 'control' | 'experiment', config: ResolvedConfig, noCache?: boolean): { cmd: string; cwd: string } {
  const isControl = serverType === 'control';
  const imageName = isControl ? config.images.control : config.images.experiment;
  const buildDir = isControl
    ? path.resolve(config.controlDir, path.relative(config.projectDir, config.dockerBuildDir))
    : config.dockerBuildDir;
  const dockerfilePath = path.join(path.relative(config.dockerBuildDir, config.projectDir), config.dockerfile);

  const args = ['build', '--progress=plain', '-t', imageName, '-f', dockerfilePath];
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
  return { cmd: `docker ${escaped}`, cwd: buildDir };
}

async function buildServer(serverType: 'control' | 'experiment', config: ResolvedConfig, options: { verbose?: boolean; noCache?: boolean } = {}): Promise<void> {
  const { cmd, cwd } = buildDockerCmd(serverType, config, options.noCache);

  console.log(`Building ${serverType} from ${cwd}...`);
  if (options.verbose) {
    const isControl = serverType === 'control';
    const imageName = isControl ? config.images.control : config.images.experiment;
    const dockerfilePath = config.dockerfile;
    console.log(`  Image: ${imageName}`);
    console.log(`  Dockerfile: ${dockerfilePath}`);
    console.log(`  Git SHA: ${getGitSha(cwd)}`);
  }

  const result = await exec('bash', ['-c', `cd '${cwd.replace(/'/g, "'\\''")}' && ${cmd}`]);
  if (result.code !== 0) {
    throw new Error(`Docker build failed for ${serverType}`);
  }

  console.log(`Finished building ${serverType}`);
}

async function buildInParallel(config: ResolvedConfig, noCache?: boolean): Promise<void> {
  const experiment = buildDockerCmd('experiment', config, noCache);
  const control = buildDockerCmd('control', config, noCache);

  await runInParallel(
    `cd '${experiment.cwd}' && ${experiment.cmd}`,
    `cd '${control.cwd}' && ${control.cmd}`,
  );
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
    const cloneTarget = config.controlDir;
    const remoteUrl = getGitRemoteUrl(config.dockerBuildDir);
    const defaultBranch = getDefaultBranch(config.dockerBuildDir);

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

  if (target) {
    console.log(`Building ${target} Docker image...`);
    console.log('');
    await buildServer(target, config, { verbose, noCache });
  } else {
    console.log('Building both Docker images in parallel...');
    console.log('');
    await buildInParallel(config, noCache);
  }

  console.log('');
  printSuccess('Docker image(s) built successfully!');
  console.log('');
  console.log('Images created:');
  if (buildingExperiment) {
    console.log(`  - ${config.images.experiment} (current branch: ${getGitBranch(config.dockerBuildDir)})`);
  }
  if (buildingControl) {
    console.log(`  - ${config.images.control} (baseline branch: ${getGitBranch(config.controlDir)})`);
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
    console.log('  yarn shaka-twin-servers start-containers');
    console.log('');
  }
}
