/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

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
  orderedCommits: string[];
  originalExperiment: CheckoutState;
}

async function git(repoDir: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd: repoDir, silent: true });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new Error(`git ${args[0]} failed in ${repoDir}: ${detail}`);
  }
  return result.stdout.trim();
}

async function requireClean(repoDir: string, label: string): Promise<void> {
  const status = await git(repoDir, ['status', '--porcelain', '--untracked-files=all']);
  if (status) throw new Error(`${label} checkout must be clean before bisecting`);
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

  return {
    goodSha,
    badSha,
    orderedCommits: [goodSha, ...orderedOutput.split('\n').filter(Boolean)],
    originalExperiment,
  };
}

export async function checkoutDetached(repoDir: string, sha: string): Promise<void> {
  await git(repoDir, ['checkout', '--detach', sha]);
}

export async function restoreCheckout(repoDir: string, original: CheckoutState): Promise<void> {
  if (original.branch) {
    await git(repoDir, ['checkout', original.branch]);
    const restoredSha = await resolveCommit(repoDir, 'HEAD');
    if (restoredSha !== original.sha) {
      throw new Error(`Restored branch ${original.branch} at ${restoredSha}, expected ${original.sha}`);
    }
    return;
  }
  await checkoutDetached(repoDir, original.sha);
}
