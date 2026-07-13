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
  prepareChildGitRange,
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
  controlDir: string;
  experimentDir: string;
  commits: string[];
  experimentBranch: string;
}

function createRepositoryTemplate(): RepositoryFixture {
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
    controlDir,
    experimentDir,
    commits,
    experimentBranch: git(experimentDir, ['branch', '--show-current']),
  };
}

function createRepositoryFixture(template: RepositoryFixture): RepositoryFixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-git-'));
  const controlDir = path.join(rootDir, 'control');
  const experimentDir = path.join(rootDir, 'experiment');
  fs.cpSync(template.controlDir, controlDir, { recursive: true });
  fs.cpSync(template.experimentDir, experimentDir, { recursive: true });
  return {
    rootDir,
    controlDir,
    experimentDir,
    commits: template.commits,
    experimentBranch: template.experimentBranch,
  };
}

describe('bisect Git helpers', () => {
  let template: RepositoryFixture;
  let fixture: RepositoryFixture;

  beforeAll(() => {
    template = createRepositoryTemplate();
  });

  afterAll(() => {
    fs.rmSync(template.rootDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fixture = createRepositoryFixture(template);
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
      commitParents: Object.fromEntries(
        fixture.commits.map((sha, index) => [sha, index === 0 ? [] : [fixture.commits[index - 1]]]),
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

  it('traverses the primary range by first parent and records merge parents', async () => {
    git(fixture.experimentDir, ['checkout', '-b', 'feature', fixture.commits[2]]);
    const featureSha = commitFile(fixture.experimentDir, 'feature.txt', 'feature\n');
    git(fixture.experimentDir, ['checkout', fixture.experimentBranch]);
    git(fixture.experimentDir, ['merge', '--no-ff', 'feature', '-m', 'merge feature']);
    const mergeSha = git(fixture.experimentDir, ['rev-parse', 'HEAD']);

    const prepared = await prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
      badRef: mergeSha,
    });

    expect(prepared.orderedCommits).toEqual([...fixture.commits, mergeSha]);
    expect(prepared.commitParents[mergeSha]).toEqual([fixture.commits[4], featureSha]);
    expect(prepared.commitSubjects[mergeSha]).toBe('merge feature');
  });

  it('prepares a first-parent child range from merge base to second parent', async () => {
    git(fixture.experimentDir, ['checkout', '-b', 'feature', fixture.commits[1]]);
    const featureOne = commitFile(fixture.experimentDir, 'feature.txt', 'feature-one\n');
    const featureTwo = commitFile(fixture.experimentDir, 'feature.txt', 'feature-two\n');

    const prepared = await prepareChildGitRange({
      experimentDir: fixture.experimentDir,
      firstParent: fixture.commits[4],
      secondParent: featureTwo,
    });

    expect(prepared).toMatchObject({
      mergeBase: fixture.commits[1],
      secondParent: featureTwo,
      orderedCommits: [fixture.commits[1], featureOne, featureTwo],
    });
    expect(prepared.commitParents[featureTwo]).toEqual([featureOne]);
  });

  it('records every parent of an octopus merge while keeping it atomic', async () => {
    git(fixture.experimentDir, ['checkout', '-b', 'topic-one', fixture.commits[2]]);
    const topicOne = commitFile(fixture.experimentDir, 'topic-one.txt', 'topic-one\n');
    git(fixture.experimentDir, ['checkout', '-b', 'topic-two', fixture.commits[2]]);
    const topicTwo = commitFile(fixture.experimentDir, 'topic-two.txt', 'topic-two\n');
    git(fixture.experimentDir, ['checkout', fixture.experimentBranch]);
    git(fixture.experimentDir, [
      'merge', '--no-ff', 'topic-one', 'topic-two', '-m', 'merge topics',
    ]);
    const mergeSha = git(fixture.experimentDir, ['rev-parse', 'HEAD']);

    const prepared = await prepareGitRange({
      experimentDir: fixture.experimentDir,
      controlDir: fixture.controlDir,
      badRef: mergeSha,
    });

    expect(prepared.orderedCommits).toEqual([...fixture.commits, mergeSha]);
    expect(prepared.commitParents[mergeSha]).toEqual([
      fixture.commits[4],
      topicOne,
      topicTwo,
    ]);
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
