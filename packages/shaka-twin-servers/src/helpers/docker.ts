import { exec, execSync_ } from './shell';
import type { ResolvedConfig } from '../types';

export interface DockerBuildOptions {
  imageName: string;
  dockerfile: string;
  buildContext: string;
  buildArgs?: Record<string, string>;
  noCache?: boolean;
}

export async function dockerBuild(options: DockerBuildOptions): Promise<void> {
  const { imageName, dockerfile, buildContext, buildArgs = {} } = options;

  const args = ['build', '-t', imageName, '-f', dockerfile];
  if (options.noCache) args.push('--no-cache');

  for (const [key, value] of Object.entries(buildArgs)) {
    args.push('--build-arg', `${key}=${value}`);
  }

  args.push(buildContext);

  const result = await exec('docker', args, { cwd: buildContext });
  if (result.code !== 0) {
    throw new Error(`Docker build failed for ${imageName}`);
  }
}

export function dockerImageExists(imageName: string): boolean {
  const result = execSync_(`docker image inspect "${imageName}"`, { silent: true });
  return result !== '';
}

function buildComposeOptions(config: ResolvedConfig) {
  return {
    composeFile: config.composeFile,
    cwd: config.projectDir,
    env: {
      ...process.env,
      CI_IMAGE_NAME: config.images.experiment,
      CI_CONTROL_IMAGE_NAME: config.images.control,
      USER: process.env.USER || getUsername(),
    },
  };
}

export async function dockerComposeUp(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  const result = await exec('docker', ['compose', '-f', opts.composeFile, 'up', '-d'], {
    cwd: opts.cwd,
    env: opts.env,
  });
  if (result.code !== 0) {
    throw new Error('Docker compose up failed');
  }
}

export async function dockerComposeDown(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  await exec('docker', ['compose', '-f', opts.composeFile, 'down', '--remove-orphans'], {
    cwd: opts.cwd,
    env: opts.env,
    silent: true,
  });
}

export async function dockerComposePs(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  await exec('docker', ['compose', '-f', opts.composeFile, 'ps'], {
    cwd: opts.cwd,
    env: opts.env,
  });
}

export interface DockerComposeExecOptions {
  interactive?: boolean;
  stream?: boolean;
  prefix?: string;
}

export async function dockerComposeExec(
  config: ResolvedConfig,
  containerName: string,
  command: string,
  execOptions: DockerComposeExecOptions = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { interactive = false, stream = false, prefix } = execOptions;

  const opts = buildComposeOptions(config);
  const args = ['compose', '-f', opts.composeFile, 'exec'];
  if (!interactive) {
    args.push('-T');
  }
  args.push(containerName, 'bash', '-c', command);

  const result = await exec('docker', args, {
    cwd: opts.cwd,
    env: opts.env,
    silent: !stream,
  });

  if (prefix) {
    if (result.stdout) {
      for (const line of result.stdout.split('\n')) {
        if (line) console.log(`${prefix} ${line}`);
      }
    }
    if (result.stderr) {
      for (const line of result.stderr.split('\n')) {
        if (line) console.error(`${prefix} ${line}`);
      }
    }
  }

  return result;
}

export async function waitForContainer(
  config: ResolvedConfig,
  containerName: string,
  maxAttempts: number = 30
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await dockerComposeExec(config, containerName, 'echo ready');
    if (result.code === 0) {
      return true;
    }
    await sleep(2000);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGitSha(cwd: string): string {
  return execSync_('git rev-parse --short HEAD', { cwd }) || 'unknown';
}

export function getGitBranch(cwd: string): string {
  return execSync_('git branch --show-current', { cwd }) || 'unknown';
}

export function getUserId(): string {
  return execSync_('id -u') || '1000';
}

export function getGroupId(): string {
  return execSync_('id -g') || '1000';
}

export function getUsername(): string {
  return execSync_('whoami') || 'user';
}
