/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { MeasuredCommit } from '../../pipeline/run-metadata';
import type { ResolvedConfig } from '../types';
import { buildComposeOptions } from './docker';
import { dockerBuildDirForSide, type ServerSide } from './project-paths';
import { exec, execWithStdin } from './shell';

export const SERVER_COMMIT_LABEL = 'dev.shakaperf.commit';
const SERVER_COMMIT_FILE = '/tmp/shaka-perf-server-commit.json';
const GIT_COMMIT_ARGS = ['show', '-s', '--format=format:%H%x00%B', 'HEAD'];
const options = { timeout: 2000, maxBuffer: 128 * 1024 };

async function dockerOutput(args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)('docker', args, { ...options, encoding: 'utf8' });
  return stdout;
}

function gitCommit(output: string, source: string): MeasuredCommit | null {
  const separator = output.indexOf('\0');
  const sha = output.slice(0, separator);
  return separator >= 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)
    ? { sha, message: output.slice(separator + 1), source } : null;
}

/** Read the side's actual source checkout, only while building or reloading it. */
export function readCheckoutCommit(directory: string): MeasuredCommit | null {
  try {
    return gitCommit(execFileSync('git', GIT_COMMIT_ARGS, { ...options, cwd: directory, encoding: 'utf8', stdio: 'pipe' }), 'Git in twin-server source checkout');
  } catch { return null; }
}

function savedCommit(json: string): MeasuredCommit | null {
  const value = JSON.parse(json) as MeasuredCommit | null;
  return value && typeof value.sha === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.sha)
    && typeof value.message === 'string' && typeof value.source === 'string' ? value : null;
}

/** A reload marker overrides the immutable image identity, including null while reloading. */
export async function readContainerCommit(container: string, imageCommit?: string): Promise<MeasuredCommit | null> {
  const marker = await dockerOutput(['exec', container, 'sh', '-c',
    `if [ -f ${SERVER_COMMIT_FILE} ]; then cat ${SERVER_COMMIT_FILE}; else printf MISSING; fi`]);
  if (marker !== 'MISSING') return savedCommit(marker);
  try {
    const stdout = await dockerOutput(['exec', container, 'git', ...GIT_COMMIT_ARGS]);
    const commit = gitCommit(stdout, 'Git in the running twin-server container');
    if (commit) return commit;
  } catch { /* Images commonly exclude .git; their build label preserves that Git lookup. */ }
  return imageCommit ? savedCommit(Buffer.from(imageCommit, 'base64').toString('utf8')) : null;
}

async function composeContainer(config: ResolvedConfig, side: ServerSide): Promise<string> {
  const opts = buildComposeOptions(config);
  const result = await exec('docker', ['compose', '-f', opts.composeFile, '-p', opts.projectName, 'ps', '-q', `${side}-server`], { cwd: opts.cwd, env: opts.env, silent: true });
  const container = result.stdout.trim();
  if (result.code !== 0 || !/^[a-f0-9]{12,64}$/i.test(container)) throw new Error(`Cannot identify the ${side} server container`);
  return container;
}

function pendingCommitFile(config: ResolvedConfig, side: ServerSide): string {
  return path.join(config.volumes[side], '.shaka-perf-pending-commit.json');
}

interface PendingCommit {
  commit: MeasuredCommit | null;
  requiresRebuild: boolean;
}

function pendingCommit(json: string): PendingCommit {
  const value = JSON.parse(json) as { requiresRebuild?: boolean; commit?: MeasuredCommit | null } | null;
  if (value?.requiresRebuild === true) {
    return { commit: savedCommit(JSON.stringify(value.commit ?? null)), requiresRebuild: true };
  }
  const commit = savedCommit(json);
  return { commit, requiresRebuild: commit === null };
}

function writePendingCommit(filename: string, pending: PendingCommit): void {
  fs.writeFileSync(`${filename}.tmp`, JSON.stringify(pending.requiresRebuild ? pending : pending.commit));
  fs.renameSync(`${filename}.tmp`, filename);
}

/** Save the copied source without clearing an unfinished rebuild's invalidity. */
export function stageSyncedServerCommit(config: ResolvedConfig, side: ServerSide, invalidating = false): void {
  const filename = pendingCommitFile(config, side);
  const previous = fs.existsSync(filename) ? pendingCommit(fs.readFileSync(filename, 'utf8')) : undefined;
  const requiresRebuild = invalidating || (previous?.requiresRebuild ?? false);
  const commit = invalidating || previous?.commit === null ? null : readCheckoutCommit(dockerBuildDirForSide(config, side));
  writePendingCommit(filename, { commit, requiresRebuild });
}

/** A failed image build must not leave copied source eligible for restart promotion. */
export function requireSyncedServerRebuild(config: ResolvedConfig, side: ServerSide): void {
  const filename = pendingCommitFile(config, side);
  if (fs.existsSync(filename)) {
    writePendingCommit(filename, { ...pendingCommit(fs.readFileSync(filename, 'utf8')), requiresRebuild: true });
  }
}

/** A successful image build owns its own identity; older copied-source state is obsolete. */
export function clearSyncedServerCommit(config: ResolvedConfig, side: ServerSide): void {
  fs.rmSync(pendingCommitFile(config, side), { force: true });
}

async function writeServerCommit(config: ResolvedConfig, side: ServerSide, commit: MeasuredCommit | null): Promise<void> {
  const container = await composeContainer(config, side);
  const result = await execWithStdin('docker', ['exec', '-i', container, 'sh', '-c',
    `cat > ${SERVER_COMMIT_FILE}.tmp && mv ${SERVER_COMMIT_FILE}.tmp ${SERVER_COMMIT_FILE}`], { stdin: JSON.stringify(commit), silent: true });
  if (result.code !== 0) throw new Error(`Cannot record the reloaded ${side} commit`);
}

/** Only applied source changes replace the active identity on an ordinary restart. */
export async function prepareSyncedServerCommits(config: ResolvedConfig): Promise<void> {
  for (const side of ['control', 'experiment'] as const) {
    const filename = pendingCommitFile(config, side);
    let json: string;
    try { json = fs.readFileSync(filename, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const pending = pendingCommit(json);
    await writeServerCommit(config, side, pending.requiresRebuild ? null : pending.commit);
    if (!pending.requiresRebuild) fs.unlinkSync(filename);
  }
}

async function activeServerCommit(config: ResolvedConfig, side: ServerSide): Promise<MeasuredCommit | null> {
  const container = await composeContainer(config, side);
  const encoded = await dockerOutput(['inspect', '--format', `{{index .Config.Labels "${SERVER_COMMIT_LABEL}"}}`, container]);
  return readContainerCommit(container, encoded.trim());
}

/** Keep the applied source snapshot immutable across asynchronous reload work. */
export async function recordReloadedExperimentCommit(config: ResolvedConfig, invalidating = false): Promise<void> {
  const filename = pendingCommitFile(config, 'experiment');
  if (invalidating) {
    // Capture the applied source before asynchronous invalidation. A failed build
    // retains this candidate for retry, but an ordinary restart cannot publish it.
    const commit = fs.existsSync(filename)
      ? pendingCommit(fs.readFileSync(filename, 'utf8')).commit
      : await activeServerCommit(config, 'experiment');
    writePendingCommit(filename, { commit, requiresRebuild: true });
    await writeServerCommit(config, 'experiment', null);
    return;
  }
  const { commit } = pendingCommit(fs.readFileSync(filename, 'utf8'));
  await writeServerCommit(config, 'experiment', commit);
  // A successful command reload cannot establish a missing source baseline.
  // Keep it unknown until a complete image build replaces the source.
  if (commit) fs.unlinkSync(filename);
}

/** The normal Procfile app launcher also runs for bisect process restarts. */
export async function logServerCommit(config: ResolvedConfig, side: ServerSide, write: (message: string) => void = console.log): Promise<void> {
  try {
    const commit = await activeServerCommit(config, side);
    write(commit ? `${side} server commit ${commit.sha}\n${commit.message}` : `${side} server commit unavailable; rebuild its image to capture Git identity.`);
  } catch {
    write(`${side} server commit unavailable`);
  }
}

export async function logServerCommits(config: ResolvedConfig, write?: (message: string) => void): Promise<void> {
  await logServerCommit(config, 'control', write);
  await logServerCommit(config, 'experiment', write);
}
