/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import { exec, execSync_ } from './shell';
import { colorize } from './ui';
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

export function buildComposeOptions(config: ResolvedConfig) {
  return {
    composeFile: config.composeFile,
    // The slug already encodes the local project path, so it is enough to
    // namespace container/network/volume names under docker compose.
    projectName: config.projectSlug,
    cwd: config.projectDir,
    env: {
      ...process.env,
      EXPERIMENT_IMAGE_NAME: config.images.experiment,
      CONTROL_IMAGE_NAME: config.images.control,
      CONTROL_VOLUME_DIR: config.volumes.control,
      EXPERIMENT_VOLUME_DIR: config.volumes.experiment,
      CONTROL_PORT: String(config.ports.control),
      EXPERIMENT_PORT: String(config.ports.experiment),
      USER: process.env.USER || getUsername(),
    },
  };
}

export async function recreateExperimentContainer(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  await exec(
    'docker',
    ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'rm', '-s', '-f', 'experiment-server'],
    { cwd: opts.cwd, env: opts.env },
  );
  fs.rmSync(config.volumes.experiment, { recursive: true, force: true });
  fs.mkdirSync(config.volumes.experiment, { recursive: true });
  const result = await exec(
    'docker',
    ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'up', '-d', '--force-recreate', 'experiment-server'],
    { cwd: opts.cwd, env: opts.env },
  );
  if (result.code !== 0) throw new Error('Experiment container recreation failed');
}

export async function dockerComposeUp(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  const result = await exec('docker', ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'up', '-d'], {
    cwd: opts.cwd,
    env: opts.env,
  });
  if (result.code !== 0) {
    throw new Error('Docker compose up failed');
  }
}

export async function dockerComposeDown(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  await exec('docker', ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'down', '--volumes', '--remove-orphans'], {
    cwd: opts.cwd,
    env: opts.env,
    silent: true,
  });
}

export async function containersRunning(config: ResolvedConfig): Promise<boolean> {
  const services = await dockerComposeRunningServices(config);
  return services.has('control-server') && services.has('experiment-server');
}

export async function dockerComposeRunningServices(config: ResolvedConfig): Promise<Set<string>> {
  const opts = buildComposeOptions(config);
  const result = await exec(
    'docker',
    ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'ps', '--status=running', '--services'],
    { cwd: opts.cwd, env: opts.env, silent: true },
  );
  if (result.code !== 0) return new Set();
  return new Set(result.stdout.split('\n').map(s => s.trim()).filter(Boolean));
}

export function getImageCreatedAt(imageName: string): Date | null {
  const out = execSync_(`docker image inspect "${imageName}" --format '{{.Created}}'`, { silent: true });
  if (!out) return null;
  const d = new Date(out.trim());
  return isNaN(d.getTime()) ? null : d;
}

export async function dockerComposePs(config: ResolvedConfig): Promise<void> {
  const opts = buildComposeOptions(config);
  await exec('docker', ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'ps'], {
    cwd: opts.cwd,
    env: opts.env,
  });
}

export interface DockerComposeExecOptions {
  interactive?: boolean;
  stream?: boolean;
}

export async function dockerComposeExec(
  config: ResolvedConfig,
  containerName: string,
  command: string,
  execOptions: DockerComposeExecOptions = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  console.log(` [${colorize(containerName.toUpperCase(), 'green')}]  > docker exec : ${command}`);

  const { interactive = false, stream = false } = execOptions;

  const opts = buildComposeOptions(config);
  const args = ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'exec'];
  if (!interactive) {
    args.push('-T');
  }
  if (stream) {
    args.push(
      '-e', 'FORCE_COLOR=1',
      '-e', 'CLICOLOR_FORCE=1',
      '-e', `TERM=${process.env.TERM || 'xterm-256color'}`,
    );
  }
  // Propagate the "we're already inside a running shaka-perf servers" flag
  // through `docker exec` so any in-container subprocess that shells out
  // to `shaka-perf` (Rails generators, yarn scripts, etc.) bails out of
  // the IPC proxy at the gate instead of dialling back into the parent
  // and deadlocking on its own session lock.
  if (process.env.SHAKAPERF_NO_PROXY === '1') {
    args.push('-e', 'SHAKAPERF_NO_PROXY=1');
  }
  args.push(containerName, 'bash', '-c', command);

  return exec('docker', args, {
    cwd: opts.cwd,
    env: opts.env,
    silent: !stream,
  });
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
