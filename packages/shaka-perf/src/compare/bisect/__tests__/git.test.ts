/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  checkoutDetached,
  prepareGitRange,
  restoreCheckout,
} from '../git';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitFile(repoDir: string, filename: string, contents: string): string {
  fs.writeFileSync(path.join(repoDir, filename), contents, 'utf8');
  git(repoDir, ['add', filename]);
  git(repoDir, ['commit', '-m', contents]);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

interface RepositoryFixture {
  rootDir: string;
  sourceDir: string;
  controlDir: string;
  experimentDir: string;
  commits: string[];
  experimentBranch: string;
}

function createRepositoryFixture(): RepositoryFixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-git-'));
  const sourceDir = path.join(rootDir, 'source');
  const controlDir = path.join(rootDir, 'control');
  const experimentDir = path.join(rootDir, 'experiment');
  fs.mkdirSync(sourceDir);
  git(sourceDir, ['init', '--initial-branch=main']);
  git(sourceDir, ['config', 'user.email', 'bisect@example.com']);
  git(sourceDir, ['config', 'user.name', 'Bisect Test']);

  const commits = Array.from({ length: 5 }, (_, index) =>
    commitFile(sourceDir, 'history.txt', `commit-${index}\n`));

  git(rootDir, ['clone', sourceDir, controlDir]);
  git(rootDir, ['clone', sourceDir, experimentDir]);
  git(controlDir, ['checkout', '--detach', commits[0]]);

  return {
    rootDir,
    sourceDir,
    controlDir,
    experimentDir,
    commits,
    experimentBranch: git(experimentDir, ['branch', '--show-current']),
  };
}

describe('bisect Git helpers', () => {
  let fixture: RepositoryFixture;

  beforeEach(() => {
    fixture = createRepositoryFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  });

  it('defaults to the control and experiment heads and returns ordered commits', async () => {
    const prepared = await prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
      goodRef: undefined,
      badRef: undefined,
    });

    expect(prepared).toEqual({
      goodSha: fixture.commits[0],
      badSha: fixture.commits[4],
      commitSubjects: Object.fromEntries(
        fixture.commits.map((sha, index) => [sha, `commit-${index}`]),
      ),
      orderedCommits: fixture.commits,
      originalExperiment: {
        branch: fixture.experimentBranch,
        sha: fixture.commits[4],
      },
    });
  });

  it('resolves explicit refs to commits', async () => {
    git(fixture.controlDir, ['checkout', '--detach', fixture.commits[1]]);

    const prepared = await prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
      goodRef: fixture.commits[1].slice(0, 12),
      badRef: fixture.commits[3].slice(0, 12),
    });

    expect(prepared.goodSha).toBe(fixture.commits[1]);
    expect(prepared.badSha).toBe(fixture.commits[3]);
    expect(prepared.orderedCommits).toEqual(fixture.commits.slice(1, 4));
  });

  it('rejects a dirty experiment checkout including untracked files', async () => {
    fs.writeFileSync(path.join(fixture.experimentDir, 'untracked.txt'), 'dirty', 'utf8');

    await expect(prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
    })).rejects.toThrow(/experiment.*clean/i);
  });

  it('rejects a dirty control checkout', async () => {
    fs.writeFileSync(path.join(fixture.controlDir, 'history.txt'), 'dirty', 'utf8');

    await expect(prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
    })).rejects.toThrow(/control.*clean/i);
  });

  it('rejects a good ref that does not match the control checkout', async () => {
    await expect(prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
      goodRef: fixture.commits[1],
    })).rejects.toThrow(/control.*good/i);
  });

  it('rejects a range whose good commit is not an ancestor of bad', async () => {
    git(fixture.experimentDir, ['checkout', '-b', 'side', fixture.commits[0]]);
    const sideSha = commitFile(fixture.experimentDir, 'side.txt', 'side\n');
    git(fixture.controlDir, ['checkout', '--detach', fixture.commits[4]]);

    await expect(prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
      goodRef: fixture.commits[4],
      badRef: sideSha,
    })).rejects.toThrow(/ancestor/i);
  });

  it('rejects ranges containing merge commits', async () => {
    git(fixture.experimentDir, ['checkout', '-b', 'feature', fixture.commits[2]]);
    commitFile(fixture.experimentDir, 'feature.txt', 'feature\n');
    git(fixture.experimentDir, ['checkout', fixture.experimentBranch]);
    git(fixture.experimentDir, ['merge', '--no-ff', 'feature', '-m', 'merge feature']);
    const mergeSha = git(fixture.experimentDir, ['rev-parse', 'HEAD']);

    await expect(prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
      badRef: mergeSha,
    })).rejects.toThrow(/merge/i);
  });

  it('checks out candidates detached and restores a branch checkout', async () => {
    const original = {
      branch: fixture.experimentBranch,
      sha: fixture.commits[4],
    };

    await checkoutDetached(fixture.experimentDir, fixture.commits[2]);
    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[2]);
    expect(git(fixture.experimentDir, ['branch', '--show-current'])).toBe('');
    expect(git(fixture.experimentDir, ['status', '--porcelain', '--untracked-files=all'])).toBe('');

    await restoreCheckout(fixture.experimentDir, original);
    expect(git(fixture.experimentDir, ['branch', '--show-current'])).toBe(fixture.experimentBranch);
    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[4]);
    expect(git(fixture.experimentDir, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
  });

  it('rejects an untracked file immediately before detached checkout', async () => {
    fs.writeFileSync(path.join(fixture.experimentDir, 'untracked.txt'), 'dirty', 'utf8');

    await expect(checkoutDetached(
      fixture.experimentDir,
      fixture.commits[2],
    )).rejects.toThrow(/clean/i);
    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[4]);
    expect(fs.readFileSync(path.join(fixture.experimentDir, 'untracked.txt'), 'utf8')).toBe('dirty');
  });

  it('allows the configured results directory before detached checkout', async () => {
    const resultsDirectory = path.join(fixture.experimentDir, 'compare-bisect-results');
    fs.mkdirSync(resultsDirectory);
    fs.writeFileSync(path.join(resultsDirectory, 'session.json'), '{}', 'utf8');

    await checkoutDetached(fixture.experimentDir, fixture.commits[2], {
      allowedPaths: [resultsDirectory],
    });

    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[2]);
    expect(fs.readFileSync(path.join(resultsDirectory, 'session.json'), 'utf8')).toBe('{}');
  });

  it('allows the configured results directory when invoked from a repo subdirectory', async () => {
    const projectDir = path.join(fixture.experimentDir, 'demo-ecommerce');
    const resultsDirectory = path.join(projectDir, 'compare-bisect-results');
    fs.mkdirSync(resultsDirectory, { recursive: true });
    fs.writeFileSync(path.join(resultsDirectory, 'session.json'), '{}', 'utf8');

    await checkoutDetached(projectDir, fixture.commits[2], {
      allowedPaths: [resultsDirectory],
    });

    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[2]);
    expect(fs.readFileSync(path.join(resultsDirectory, 'session.json'), 'utf8')).toBe('{}');
  });

  it('rejects a tracked modification immediately before restoring checkout', async () => {
    const original = {
      branch: fixture.experimentBranch,
      sha: fixture.commits[4],
    };
    await checkoutDetached(fixture.experimentDir, fixture.commits[2]);
    fs.writeFileSync(path.join(fixture.experimentDir, 'history.txt'), 'dirty', 'utf8');

    await expect(restoreCheckout(fixture.experimentDir, original)).rejects.toThrow(/clean/i);
    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[2]);
    expect(fs.readFileSync(path.join(fixture.experimentDir, 'history.txt'), 'utf8')).toBe('dirty');
  });

  it('allows the configured results directory before restoring checkout', async () => {
    const original = {
      branch: fixture.experimentBranch,
      sha: fixture.commits[4],
    };
    const resultsDirectory = path.join(fixture.experimentDir, 'compare-bisect-results');

    await checkoutDetached(fixture.experimentDir, fixture.commits[2]);
    fs.mkdirSync(resultsDirectory);
    fs.writeFileSync(path.join(resultsDirectory, 'summary.json'), '{}', 'utf8');

    await restoreCheckout(fixture.experimentDir, original, {
      allowedPaths: [resultsDirectory],
    });

    expect(git(fixture.experimentDir, ['branch', '--show-current'])).toBe(fixture.experimentBranch);
    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[4]);
    expect(fs.readFileSync(path.join(resultsDirectory, 'summary.json'), 'utf8')).toBe('{}');
  });

  it('restores an originally detached checkout', async () => {
    git(fixture.experimentDir, ['checkout', '--detach', fixture.commits[3]]);
    const original = { branch: null, sha: fixture.commits[3] };

    await checkoutDetached(fixture.experimentDir, fixture.commits[1]);
    await restoreCheckout(fixture.experimentDir, original);

    expect(git(fixture.experimentDir, ['rev-parse', 'HEAD'])).toBe(fixture.commits[3]);
    expect(git(fixture.experimentDir, ['branch', '--show-current'])).toBe('');
  });
});
