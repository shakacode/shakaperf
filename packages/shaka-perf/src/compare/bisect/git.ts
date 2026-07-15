/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';

import { exec } from '../../twin-servers/helpers/shell';

export interface CheckoutState {
  branch: string | null;
  sha: string;
}

export interface PrepareGitRangeOptions {
  experimentDir: string;
  controlDir: string;
  goodRef?: string;
  badRef?: string;
}

export interface PreparedGitRange {
  goodSha: string;
  badSha: string;
  commitSubjects: Record<string, string>;
  orderedCommits: string[];
  originalExperiment: CheckoutState;
}

export interface CleanCheckoutOptions {
  allowedPaths?: readonly string[];
}

async function git(repoDir: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd: repoDir, silent: true });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new Error(`git ${args[0]} failed in ${repoDir}: ${detail}`);
  }
  return result.stdout.trim();
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function realpathIfExists(inputPath: string): string {
  try {
    return fs.realpathSync.native(inputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path.resolve(inputPath);
    throw error;
  }
}

function allowedStatusPrefixes(repoDir: string, allowedPaths: readonly string[] = []): string[] {
  return allowedPaths
    .map((allowedPath) => path.relative(repoDir, realpathIfExists(allowedPath)))
    .filter((relativePath) => relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    .map(normalizeRelativePath)
    .map((relativePath) => relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath);
}

function statusPath(statusLine: string): string {
  return normalizeRelativePath(statusLine.slice(3));
}

function isAllowedStatusLine(statusLine: string, allowedPrefixes: readonly string[]): boolean {
  const relativePath = statusPath(statusLine);
  return allowedPrefixes.some((allowedPrefix) => (
    relativePath === allowedPrefix || relativePath.startsWith(`${allowedPrefix}/`)
  ));
}

async function requireClean(
  repoDir: string,
  label: string,
  options: CleanCheckoutOptions = {},
): Promise<void> {
  const repoRoot = realpathIfExists(await git(repoDir, ['rev-parse', '--show-toplevel']));
  const status = await git(repoDir, [
    '-c',
    'status.relativePaths=false',
    'status',
    '--porcelain',
    '--untracked-files=all',
  ]);
  const dirtyLines = status
    .split('\n')
    .filter(Boolean)
    .filter((line) => !isAllowedStatusLine(line, allowedStatusPrefixes(repoRoot, options.allowedPaths)));
  if (dirtyLines.length > 0) throw new Error(`${label} checkout must be clean before bisecting`);
}

async function resolveCommit(repoDir: string, ref: string): Promise<string> {
  return git(repoDir, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

async function checkoutState(repoDir: string): Promise<CheckoutState> {
  const sha = await git(repoDir, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const branchResult = await exec('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: repoDir,
    silent: true,
  });
  if (branchResult.code !== 0 && branchResult.code !== 1) {
    throw new Error(`Unable to determine checkout state in ${repoDir}: ${branchResult.stderr.trim()}`);
  }
  return { branch: branchResult.code === 0 ? branchResult.stdout.trim() : null, sha };
}

async function verifyCheckout(
  repoDir: string,
  expected: CheckoutState,
  operation: string,
  options: CleanCheckoutOptions = {},
): Promise<void> {
  const actual = await checkoutState(repoDir);
  if (actual.sha !== expected.sha || actual.branch !== expected.branch) {
    throw new Error(
      `${operation} produced ${actual.branch ?? 'detached'} at ${actual.sha}, `
      + `expected ${expected.branch ?? 'detached'} at ${expected.sha}`,
    );
  }
  await requireClean(repoDir, `${operation} result`, options);
}

export async function prepareGitRange(options: PrepareGitRangeOptions): Promise<PreparedGitRange> {
  await requireClean(options.experimentDir, 'Experiment');
  await requireClean(options.controlDir, 'Control');

  const originalExperiment = await checkoutState(options.experimentDir);
  const controlSha = await resolveCommit(options.controlDir, 'HEAD');
  const goodSha = await resolveCommit(options.experimentDir, options.goodRef ?? controlSha);
  const badSha = await resolveCommit(
    options.experimentDir,
    options.badRef ?? originalExperiment.sha,
  );

  if (goodSha !== controlSha) {
    throw new Error(`Control checkout ${controlSha} does not match good commit ${goodSha}`);
  }

  const ancestor = await exec('git', ['merge-base', '--is-ancestor', goodSha, badSha], {
    cwd: options.experimentDir,
    silent: true,
  });
  if (ancestor.code === 1) {
    throw new Error(`Good commit ${goodSha} is not an ancestor of bad commit ${badSha}`);
  }
  if (ancestor.code !== 0) {
    throw new Error(`Unable to validate Git ancestry: ${ancestor.stderr.trim()}`);
  }

  const orderedOutput = await git(options.experimentDir, [
    'rev-list',
    '--reverse',
    '--ancestry-path',
    `${goodSha}..${badSha}`,
  ]);
  const parentOutput = await git(options.experimentDir, [
    'rev-list',
    '--parents',
    `${goodSha}..${badSha}`,
  ]);
  const mergeLine = parentOutput.split('\n').find((line) => line.trim().split(/\s+/).length > 2);
  if (mergeLine) {
    throw new Error(`Bisect range must be linear; merge commit found at ${mergeLine.split(/\s+/)[0]}`);
  }

  const orderedCommits = [goodSha, ...orderedOutput.split('\n').filter(Boolean)];
  const subjectOutput = await git(options.experimentDir, [
    'show',
    '--no-patch',
    '--format=%H%x00%s',
    ...orderedCommits,
  ]);
  const commitSubjects = Object.fromEntries(subjectOutput.split('\n').filter(Boolean).map((line) => {
    const [sha, subject] = line.split('\0');
    return [sha, subject];
  }));

  return {
    goodSha,
    badSha,
    commitSubjects,
    orderedCommits,
    originalExperiment,
  };
}

export async function checkoutDetached(
  repoDir: string,
  sha: string,
  options: CleanCheckoutOptions = {},
): Promise<void> {
  await requireClean(repoDir, 'Experiment', options);
  await git(repoDir, ['checkout', '--detach', sha]);
  await verifyCheckout(repoDir, { branch: null, sha }, 'Detached checkout', options);
}

export async function restoreCheckout(
  repoDir: string,
  original: CheckoutState,
  options: CleanCheckoutOptions = {},
): Promise<void> {
  await requireClean(repoDir, 'Experiment', options);
  if (original.branch) {
    await git(repoDir, ['checkout', original.branch]);
    await verifyCheckout(repoDir, original, 'Restored checkout', options);
    return;
  }
  await git(repoDir, ['checkout', '--detach', original.sha]);
  await verifyCheckout(repoDir, original, 'Restored checkout', options);
}
