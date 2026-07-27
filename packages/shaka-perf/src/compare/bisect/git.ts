/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';

import { exec } from '../../twin-servers/helpers/shell';
import type { BisectRepositoryIdentity, BisectTargetGroup } from './types';

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
  commitParents: Record<string, string[]>;
  orderedCommits: string[];
  originalExperiment: CheckoutState;
}

export interface PrepareChildGitRangeOptions {
  experimentDir: string;
  firstParent: string;
  secondParent: string;
}

export interface PreparedChildGitRange {
  mergeBase: string;
  secondParent: string;
  commitSubjects: Record<string, string>;
  commitParents: Record<string, string[]>;
  orderedCommits: string[];
}

export interface CleanCheckoutOptions {
  allowedPaths?: readonly string[];
}

export interface BisectRepositorySnapshot {
  identity: BisectRepositoryIdentity;
  control: CheckoutState;
  experiment: CheckoutState;
}

export type NativeBisectVerdict = 'good' | 'bad';

export interface NativeBisectStep {
  candidateSha: string | null;
  firstBadSha: string | null;
  complete: boolean;
  output: string;
}

interface StartNativeBisectOptions {
  repoDir: string;
  goodSha: string;
  badSha: string;
  noCheckout?: boolean;
  allowedPaths?: readonly string[];
}

export interface NativeGitBisectDriverOptions {
  repoDir: string;
  allowedPaths?: readonly string[];
}

export interface ExactCheckoutOptions {
  repoDir: string;
  allowedPaths?: readonly string[];
}

/** Owns the native Git bisect lifecycle and is the only search-candidate mover. */
export class NativeGitBisectDriver {
  constructor(private readonly options: NativeGitBisectDriverOptions) {}

  start(group: BisectTargetGroup): Promise<NativeBisectStep> {
    return startNativeBisect({
      repoDir: this.options.repoDir,
      goodSha: group.goodSha,
      badSha: group.badSha,
      allowedPaths: this.options.allowedPaths,
    });
  }

  mark(verdict: NativeBisectVerdict): Promise<NativeBisectStep> {
    return markNativeBisect(this.options.repoDir, verdict);
  }

  reset(): Promise<void> {
    return resetNativeBisect(this.options.repoDir);
  }

  currentCandidate(): Promise<string> {
    return resolveCommit(this.options.repoDir, 'HEAD');
  }

  async assertAtCandidate(expectedSha: string): Promise<void> {
    const actualSha = await this.currentCandidate();
    if (actualSha !== expectedSha) {
      throw new Error(`Native Git bisect selected ${actualSha}; expected ${expectedSha}`);
    }
  }

  async preview(group: BisectTargetGroup): Promise<NativeBisectStep> {
    try {
      return await startNativeBisect({
        repoDir: this.options.repoDir,
        goodSha: group.goodSha,
        badSha: group.badSha,
        noCheckout: true,
        allowedPaths: this.options.allowedPaths,
      });
    } finally {
      await this.reset();
    }
  }
}

/**
 * Owns temporary, exact endpoint positioning. Search traversal cannot use this
 * class: only NativeGitBisectDriver is allowed to advance bisect candidates.
 */
export class ExactCheckout {
  constructor(private readonly options: ExactCheckoutOptions) {}

  current(): Promise<CheckoutState> {
    return checkoutState(this.options.repoDir);
  }

  async position(sha: string): Promise<void> {
    await requireClean(this.options.repoDir, 'Experiment', {
      allowedPaths: this.options.allowedPaths,
    });
    await git(this.options.repoDir, ['checkout', '--detach', sha]);
    await this.assertAt(sha);
  }

  async assertAt(expectedSha: string): Promise<void> {
    const actual = await checkoutState(this.options.repoDir);
    if (actual.sha !== expectedSha || actual.branch !== null) {
      throw new Error(
        `Exact checkout produced ${actual.branch ?? 'detached'} at ${actual.sha}, `
        + `expected detached at ${expectedSha}`,
      );
    }
    await requireClean(this.options.repoDir, 'Exact checkout result', {
      allowedPaths: this.options.allowedPaths,
    });
  }

  restore(original: CheckoutState): Promise<void> {
    return restoreCheckout(this.options.repoDir, original, {
      allowedPaths: this.options.allowedPaths,
    });
  }
}

async function git(repoDir: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd: repoDir, silent: true });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new Error(`git ${args[0]} failed in ${repoDir}: ${detail}`);
  }
  return result.stdout.trim();
}

const FIRST_BAD_PATTERN = /^([0-9a-f]{40,64}) is the first bad commit$/m;

async function nativeBisectStep(
  repoDir: string,
  output: string,
  noCheckout = false,
): Promise<NativeBisectStep> {
  const firstBadSha = output.match(FIRST_BAD_PATTERN)?.[1] ?? null;
  if (firstBadSha) {
    return { candidateSha: null, firstBadSha, complete: true, output };
  }
  const candidateSha = await resolveCommit(repoDir, noCheckout ? 'BISECT_HEAD' : 'HEAD');
  return { candidateSha, firstBadSha: null, complete: false, output };
}

async function startNativeBisect(
  options: StartNativeBisectOptions,
): Promise<NativeBisectStep> {
  await requireClean(options.repoDir, 'Experiment', { allowedPaths: options.allowedPaths });
  const args = ['bisect', 'start'];
  if (options.noCheckout) args.push('--no-checkout');
  args.push('--first-parent');
  args.push(options.badSha, options.goodSha);
  const output = await git(options.repoDir, args);
  return nativeBisectStep(options.repoDir, output, options.noCheckout === true);
}

async function markNativeBisect(
  repoDir: string,
  verdict: NativeBisectVerdict,
): Promise<NativeBisectStep> {
  const output = await git(repoDir, ['bisect', verdict]);
  return nativeBisectStep(repoDir, output);
}

export async function nativeBisectLog(repoDir: string): Promise<string> {
  return git(repoDir, ['bisect', 'log']);
}

async function resetNativeBisect(repoDir: string): Promise<void> {
  try {
    await git(repoDir, ['bisect', 'reset']);
  } catch (error) {
    if (/not bisecting/i.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
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

async function repositoryIdentity(repoDir: string): Promise<{
  root: string;
  gitCommonDir: string;
  origin: string | null;
}> {
  const root = realpathIfExists(await git(repoDir, ['rev-parse', '--show-toplevel']));
  const commonDir = await git(repoDir, ['rev-parse', '--git-common-dir']);
  const originResult = await exec('git', ['config', '--get', 'remote.origin.url'], {
    cwd: repoDir,
    silent: true,
  });
  if (originResult.code !== 0 && originResult.code !== 1) {
    throw new Error(`Unable to read Git origin in ${repoDir}: ${originResult.stderr.trim()}`);
  }
  return {
    root,
    gitCommonDir: realpathIfExists(path.resolve(repoDir, commonDir)),
    origin: originResult.code === 0 ? normalizeOrigin(originResult.stdout) : null,
  };
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export async function inspectBisectRepositories(options: {
  controlDir: string;
  experimentDir: string;
  allowedPaths?: readonly string[];
}): Promise<BisectRepositorySnapshot> {
  await requireClean(options.controlDir, 'Control', { allowedPaths: options.allowedPaths });
  await requireClean(options.experimentDir, 'Experiment', { allowedPaths: options.allowedPaths });
  const [controlRepository, experimentRepository, control, experiment] = await Promise.all([
    repositoryIdentity(options.controlDir),
    repositoryIdentity(options.experimentDir),
    checkoutState(options.controlDir),
    checkoutState(options.experimentDir),
  ]);
  return {
    identity: {
      controlRoot: controlRepository.root,
      experimentRoot: experimentRepository.root,
      controlGitCommonDir: controlRepository.gitCommonDir,
      experimentGitCommonDir: experimentRepository.gitCommonDir,
      controlOrigin: controlRepository.origin,
      experimentOrigin: experimentRepository.origin,
    },
    control,
    experiment,
  };
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

async function loadFirstParentRange(
  repoDir: string,
  goodSha: string,
  badSha: string,
): Promise<Pick<PreparedGitRange, 'commitParents' | 'commitSubjects' | 'orderedCommits'>> {
  const orderedOutput = await git(repoDir, [
    'rev-list',
    '--first-parent',
    '--reverse',
    `${goodSha}..${badSha}`,
  ]);
  const orderedCommits = [goodSha, ...orderedOutput.split('\n').filter(Boolean)];
  const metadataOutput = await git(repoDir, [
    'show',
    '--no-patch',
    '--format=%H%x00%P%x00%s',
    ...orderedCommits,
  ]);
  const commitSubjects: Record<string, string> = {};
  const commitParents: Record<string, string[]> = {};
  for (const line of metadataOutput.split('\n').filter(Boolean)) {
    const [sha, parents = '', subject = ''] = line.split('\0');
    commitSubjects[sha] = subject;
    commitParents[sha] = parents.split(' ').filter(Boolean);
  }
  return { commitParents, commitSubjects, orderedCommits };
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

  const range = await loadFirstParentRange(options.experimentDir, goodSha, badSha);

  return {
    goodSha,
    badSha,
    ...range,
    originalExperiment,
  };
}

export async function prepareChildGitRange(
  options: PrepareChildGitRangeOptions,
): Promise<PreparedChildGitRange> {
  const firstParent = await resolveCommit(options.experimentDir, options.firstParent);
  const secondParent = await resolveCommit(options.experimentDir, options.secondParent);
  const mergeBase = await git(options.experimentDir, ['merge-base', firstParent, secondParent]);
  const range = await loadFirstParentRange(options.experimentDir, mergeBase, secondParent);
  for (let index = 1; index < range.orderedCommits.length; index += 1) {
    const previousSha = range.orderedCommits[index - 1];
    const currentSha = range.orderedCommits[index];
    if (range.commitParents[currentSha]?.[0] !== previousSha) {
      throw new Error(
        `Cannot investigate merge source: range from merge base ${mergeBase} `
        + `to second parent ${secondParent} is not a contiguous first-parent chain`,
      );
    }
  }
  return {
    mergeBase,
    secondParent,
    ...range,
  };
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
