import { exec, execSync_ } from './shell';

export interface DockerBuildOptions {
  imageName: string;
  dockerfile: string;
  buildContext: string;
  buildArgs?: Record<string, string>;
}

export async function dockerBuild(options: DockerBuildOptions): Promise<void> {
  const { imageName, dockerfile, buildContext, buildArgs = {} } = options;

  const args = ['build', '-t', imageName, '-f', dockerfile];

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

export interface DockerComposeOptions {
  composeFile: string;
  cwd: string;
  env?: Record<string, string>;
}

export async function dockerComposeUp(options: DockerComposeOptions): Promise<void> {
  const result = await exec('docker', ['compose', '-f', options.composeFile, 'up', '-d'], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });
  if (result.code !== 0) {
    throw new Error('Docker compose up failed');
  }
}

export async function dockerComposeDown(options: DockerComposeOptions): Promise<void> {
  await exec('docker', ['compose', '-f', options.composeFile, 'down', '--remove-orphans'], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    silent: true,
  });
}

export async function dockerComposePs(options: DockerComposeOptions): Promise<void> {
  await exec('docker', ['compose', '-f', options.composeFile, 'ps'], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });
}

export async function dockerComposeExec(
  options: DockerComposeOptions,
  containerName: string,
  command: string,
  interactive: boolean = false
): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = ['compose', '-f', options.composeFile, 'exec'];
  if (!interactive) {
    args.push('-T');
  }
  args.push(containerName, 'bash', '-c', command);

  return exec('docker', args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    silent: true,
  });
}

export async function waitForContainer(
  options: DockerComposeOptions,
  containerName: string,
  maxAttempts: number = 30
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await dockerComposeExec(options, containerName, 'echo ready');
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
